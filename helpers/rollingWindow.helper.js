import Sequelize from 'sequelize';
import { RoomBooking, FlatBooking, CardDb } from '../models/associations.js';
import {
  STATUS_CANCELLED,
  STATUS_ADMIN_CANCELLED,
  STATUS_REJECTED,
  STATUS_WAITING,
  STATUS_RESIDENT,
  ROLLING_WINDOW_DAYS,
  ROLLING_WINDOW_NIGHT_LIMIT,
  MSG_ROLLING_WINDOW_EXCEEDED
} from '../config/constants.js';
import {
  expandNights,
  peakWindowNightsTouching,
  DAY_MS
} from './rollingWindow.core.js';
import { validateCard } from './card.helper.js';

const toISO = (ms) => new Date(ms).toISOString().slice(0, 10);

// Only committed stays count. `waiting` is excluded: it is unconfirmed (no
// room, no payment, may never be approved), and the cap itself creates waiting
// bookings — counting them would cascade-waitlist a user off their own
// speculative bookings.
const COMMITTED_ONLY = {
  [Sequelize.Op.notIn]: [
    STATUS_CANCELLED,
    STATUS_ADMIN_CANCELLED,
    STATUS_REJECTED,
    STATUS_WAITING
  ]
};

// Overlap predicate for bookings intersecting the padded date range.
function overlapWhere(cardnoClause, rangeStart, rangeEndExclusive) {
  return {
    cardno: cardnoClause,
    status: COMMITTED_ONLY,
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
// number of people in the request. Residents are exempt; occupants with no
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

  // Expand each occupant's requested nights ONCE; keep only non-residents who
  // actually request nights.
  const nightsByCard = new Map();
  for (const c of cards) {
    if (c.res_status === STATUS_RESIDENT) continue;
    const nights = expandNights(rangesByCard[c.cardno]);
    if (nights.length) nightsByCard.set(c.cardno, nights);
  }
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
