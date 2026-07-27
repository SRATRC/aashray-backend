import Sequelize from 'sequelize';
import {
  RoomBooking,
  FlatBooking,
  CardDb,
  RoomBookingExemption
} from '../models/associations.js';
import {
  STATUS_CANCELLED,
  STATUS_ADMIN_CANCELLED,
  STATUS_REJECTED,
  STATUS_WAITING,
  ROLLING_WINDOW_DAYS,
  ROLLING_WINDOW_NIGHT_LIMIT,
  MSG_ROLLING_WINDOW_EXCEEDED,
  HOLD_REASON,
  EXEMPT_RES_STATUSES
} from '../config/constants.js';
import {
  expandNights,
  peakWindowNightsTouching,
  DAY_MS
} from './rollingWindow.core.js';
import { validateCard } from './card.helper.js';

const toISO = (ms) => new Date(ms).toISOString().slice(0, 10);

// Pure predicate: is a card exempt from the cap by a per-card `room_booking_exemptions`
// row? `rows` are that card's exemption rows; `lastNightISO` is the card's LAST
// requested night as `YYYY-MM-DD` (= checkout − 1 day, because checkout is exclusive).
// A permanent row always exempts. A temporary row exempts when its inclusive
// [valid_from, valid_to] range covers the last night — compared on calendar date,
// NOT against the exclusive checkout (fixes the off-by-one). `YYYY-MM-DD` strings
// sort lexicographically == chronologically. A row whose valid_to EQUALS the last
// night still matches. Temporary rows missing either bound cannot cover anything.
export function isExemptByExemptionRow(rows, lastNightISO) {
  if (!rows || rows.length === 0) return false;
  for (const r of rows) {
    if (r.is_permanent) return true;
    if (r.valid_from == null || r.valid_to == null) continue;
    const from = String(r.valid_from).slice(0, 10);
    const to = String(r.valid_to).slice(0, 10);
    if (from <= lastNightISO && lastNightISO <= to) return true;
  }
  return false;
}

// Only committed stays count. `waiting` is excluded: it is unconfirmed (no
// room, no payment, may never be approved), and the cap itself creates waiting
// bookings — counting them would cascade-waitlist a user off their own
// speculative bookings.
export const COMMITTED_ONLY = {
  [Sequelize.Op.notIn]: [
    STATUS_CANCELLED,
    STATUS_ADMIN_CANCELLED,
    STATUS_REJECTED,
    STATUS_WAITING
  ]
};

// Overlap predicate for bookings intersecting the padded date range.
// `nights > 0` EXCLUDES day visits from the count. A day visit stores
// `checkout = checkin + 1 day` with `nights = 0`; these projected reads select
// only cardno/checkin/checkout (NOT nights), so the room_booking.checkout getter
// (which returns checkin only when nights===0) cannot fire — it would see
// `nights === undefined` and return the raw `checkin + 1`, making `expandNights`
// wrongly count the day visit as 1 committed night and inflate the cap. Filtering
// at the query is the robust fix and never depends on the getter. Safe for flats:
// flat nights = checkout − checkin, so a 0-night flat has checkout === checkin and
// already contributes 0 nights via expandNights — excluding it removes nothing.
function overlapWhere(cardnoClause, rangeStart, rangeEndExclusive) {
  return {
    cardno: cardnoClause,
    status: COMMITTED_ONLY,
    nights: { [Sequelize.Op.gt]: 0 },
    checkin: { [Sequelize.Op.lt]: rangeEndExclusive },
    checkout: { [Sequelize.Op.gt]: rangeStart }
  };
}

// The padded fetch window [firstNight - 29d, lastNight + 29d] around a set of
// requested nights — any booking touching it could combine into a violating
// 30-day window. Returns { rangeStart, rangeEndExclusive } as YYYY-MM-DD.
function paddedRange(requestedNights) {
  const padMs = (ROLLING_WINDOW_DAYS - 1) * DAY_MS;
  return {
    rangeStart: toISO(requestedNights[0] - padMs),
    rangeEndExclusive: toISO(requestedNights[requestedNights.length - 1] + padMs + DAY_MS)
  };
}

// Determine if adding `ranges` for `card` would breach the rolling window.
// Locks the occupant's card row (within t) to serialize concurrent bookings
// for the same person. Returns { exceeds, windowNights } where windowNights is
// the peak nights in any 30-day window containing a requested night (the "N of
// 9"). Thin wrapper over the batched implementation (batch-of-one) so the
// single- and group-occupant paths share exactly one code path.
// PRECONDITION: `card` MUST include `res_status`.
export async function checkRollingWindowLimit({ card, ranges, t = null }) {
  const byCard = await checkRollingWindowLimitBatch({
    cards: [card],
    rangesByCard: { [card.cardno]: ranges },
    t
  });
  return byCard.get(card.cardno);
}

// Rolling-window cap check for one or many occupants (used by group bookings and,
// via the wrapper above, single bookings). READS are constant — 1 room read + 1
// flat read for the whole set (`cardno IN (...)`), grouped in memory — instead of
// ~2 per occupant. Per-person card-row locks are taken one at a time in sorted
// order: provably deadlock-free (all transactions lock shared rows in the same
// order; no dependence on multi-row-statement lock ordering), bounded by the
// number of people in the request. Exempt-status cards (PR / SEVA KUTIR / Staff)
// and cards with an active per-card exemption row are exempt; occupants with no
// requested nights are skipped.
//   cards         — card_db rows (MUST include `cardno` and `res_status`)
//   rangesByCard  — { cardno: [{ checkin, checkout }, ...] }
// Returns Map<cardno, { exceeds, windowNights }> covering every input card.
export async function checkRollingWindowLimitBatch({ cards, rangesByCard, t = null }) {
  const result = new Map();
  for (const c of cards) {
    // Fail loud rather than silently mis-classify: the residency exemption reads
    // res_status, so a caller that projected it away must be fixed, not fail open
    // (which would wrongly waitlist a resident).
    if (c.res_status === undefined) {
      throw new Error(
        `checkRollingWindowLimit: card ${c.cardno} is missing res_status`
      );
    }
    result.set(c.cardno, { exceeds: false, windowNights: 0 });
  }

  // Expand each occupant's requested nights ONCE; keep only non-exempt-status
  // occupants who actually request nights. Residency exemption is now the WIDENED
  // set (PR + SEVA KUTIR + Staff), not PR-only — exempt statuses are skipped here
  // and keep their default {exceeds:false, windowNights:0}.
  const nightsByCard = new Map();
  for (const c of cards) {
    if (EXEMPT_RES_STATUSES.has(c.res_status)) continue;
    const nights = expandNights(rangesByCard[c.cardno]);
    if (nights.length) nightsByCard.set(c.cardno, nights);
  }
  if (nightsByCard.size === 0) return result;

  // Per-card exemption fold (vvshk's `room_booking_exemptions`): batch-load ONCE
  // for exactly the non-status-exempt cards that reach the cap check, then drop
  // any card covered by a permanent exemption or a temporary one covering its
  // last requested night. Dropped cards keep the default {exceeds:false}.
  const candidateCardnos = [...nightsByCard.keys()];
  const exemptionRows = await RoomBookingExemption.findAll({
    where: { cardno: { [Sequelize.Op.in]: candidateCardnos } },
    transaction: t
  });
  const exemptionsByCard = {};
  for (const r of exemptionRows) {
    (exemptionsByCard[r.cardno] = exemptionsByCard[r.cardno] || []).push(r);
  }
  const exemptByCard = new Set();
  for (const [cardno, nights] of nightsByCard) {
    const lastNightISO = toISO(nights[nights.length - 1]); // checkout − 1 day
    if (isExemptByExemptionRow(exemptionsByCard[cardno], lastNightISO)) {
      exemptByCard.add(cardno);
    }
  }
  for (const cardno of exemptByCard) nightsByCard.delete(cardno);
  if (nightsByCard.size === 0) return result;

  const cardnos = [...nightsByCard.keys()].sort();

  // Sorted per-person row locks — deadlock-free by ordering (see header).
  if (t) {
    for (const cardno of cardnos) {
      await CardDb.findOne({
        where: { cardno },
        attributes: ['cardno'],
        transaction: t,
        lock: t.LOCK.UPDATE
      });
    }
  }

  // Padded fetch window from the min/max requested night across the group.
  let min = Infinity;
  let max = -Infinity;
  for (const nights of nightsByCard.values()) {
    if (nights[0] < min) min = nights[0];
    if (nights[nights.length - 1] > max) max = nights[nights.length - 1];
  }
  const { rangeStart, rangeEndExclusive } = paddedRange([min, max]);
  const where = overlapWhere(
    { [Sequelize.Op.in]: cardnos },
    rangeStart,
    rangeEndExclusive
  );

  // Two batched reads (sequential — shared transaction). Non-resident flat nights
  // share the same budget as room nights.
  const rooms = await RoomBooking.findAll({
    where,
    attributes: ['cardno', 'checkin', 'checkout'],
    transaction: t
  });
  const flats = await FlatBooking.findAll({
    where,
    attributes: ['cardno', 'checkin', 'checkout'],
    transaction: t
  });

  const existingByCard = {};
  for (const b of [...rooms, ...flats]) {
    (existingByCard[b.cardno] = existingByCard[b.cardno] || []).push({
      checkin: b.checkin,
      checkout: b.checkout
    });
  }

  for (const cardno of cardnos) {
    const requested = nightsByCard.get(cardno);
    const existingNights = expandNights(existingByCard[cardno] || []);
    // Merge two sorted-unique night lists into one sorted-unique set.
    const combined = [...new Set([...existingNights, ...requested])].sort(
      (a, b) => a - b
    );
    const windowNights = peakWindowNightsTouching(combined, requested);
    result.set(cardno, {
      exceeds: windowNights > ROLLING_WINDOW_NIGHT_LIMIT,
      windowNights
    });
  }
  return result;
}

// Admin actions are NOT hard-stopped by the cap: the booking/promotion proceeds
// and this warning is attached to the success response so staff are informed
// (and can cancel if they didn't intend it). Returns a warning payload when the
// stay would exceed the cap, else null. Does NOT block or roll back.
export async function getRollingWindowWarning({ card, checkin, checkout, t }) {
  const cap = await checkRollingWindowLimit({
    card,
    ranges: [{ checkin, checkout }],
    t
  });
  if (!cap.exceeds) return null;
  return { message: MSG_ROLLING_WINDOW_EXCEEDED, windowNights: cap.windowNights };
}

// Warning for an admin promoting a waiting booking. The cap applies to the
// OCCUPANT (booking.cardno), not the payer; reuse the already-fetched payer card
// when they're the same person to avoid a duplicate lookup.
export async function getPromotionCapWarning({ booking, payerCardno, payerCard, t }) {
  const occupantCard =
    payerCardno === booking.cardno
      ? payerCard
      : await validateCard(booking.cardno);
  return getRollingWindowWarning({
    card: occupantCard,
    checkin: booking.checkin,
    checkout: booking.checkout,
    t
  });
}

// Attach a `warning` to a response body only when one is present.
export function withWarning(body, warning) {
  return warning ? { ...body, warning } : body;
}

// Convenience wrapper for the common "same single date range for a list of
// cards" shape (flat previews + flat booking). Returns Map<cardno, {exceeds, windowNights}>.
export async function checkRollingWindowLimitForCards(cards, checkin, checkout, t = null) {
  const rangesByCard = {};
  for (const c of cards) rangesByCard[c.cardno] = [{ checkin, checkout }];
  return checkRollingWindowLimitBatch({ cards, rangesByCard, t });
}

// The preview/detail fields for a stay forced to waiting by the rolling cap —
// one source of truth so previews and the actual booking can't drift. When the
// user supplied an extra-stay reason it is folded into `holdReasonMeta.userReason`
// (key OMITTED when no reason was given — a reason is always optional).
export function rollingWaitlistFields(cap, userReason = null) {
  return {
    charge: 0,
    status: STATUS_WAITING,
    holdReason: HOLD_REASON.ROLLING_WINDOW_LIMIT,
    holdReasonMeta: {
      windowNights: cap.windowNights,
      limit: ROLLING_WINDOW_NIGHT_LIMIT,
      ...(userReason ? { userReason } : {})
    }
  };
}
