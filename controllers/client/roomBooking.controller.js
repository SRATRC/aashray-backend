import {
  TYPE_ROOM,
  ERR_BOOKING_NOT_FOUND,
  STATUS_WAITING,
  ROOM_STATUS_PENDING_CHECKIN,
  MSG_BOOKING_SUCCESSFUL,
  TYPE_GUEST_ROOM,
  TYPE_FLAT,
  STATUS_PAYMENT_PENDING,
  BOOKING_STATUS_PENDING,
  HOLD_REASON_COPY,
  STATUS_CANCELLED,
  STATUS_ADMIN_CANCELLED
} from '../../config/constants.js';
import { sendUnifiedEmail, sendUnifiedEmailForBookedBy, getBlockedDates, formatBlockedPeriod, blockNightBounds } from '../helper.js';
import { userCancelBooking } from '../../helpers/transactions.helper.js';
import {
  RoomBooking,
  FlatBooking,
  CardDb,
  UtsavDb,
  UtsavBooking
} from '../../models/associations.js';
import { bookFlatForMumukshus } from '../../helpers/roomBooking.helper.js';
import { checkRollingWindowLimit } from '../../helpers/rollingWindow.helper.js';
import {
  getDateRangesDuringUtsav,
  findOverlappingUtsav,
  ACTIVE_UTSAV_BOOKING_STATUSES
} from '../../helpers/utsavBooking.helper.js';
import {
  getOtherBookingUser,
  notifyCardno
} from '../../helpers/notification.helper.js';
import { attachUserContext } from '../../middleware/Logger.js';
import ApiError from '../../utils/ApiError.js';
import sendMail from '../../utils/sendMail.js';
import database from '../../config/database.js';
import Sequelize from 'sequelize';
import moment from 'moment-timezone';
import { sendRoomStatusChangeWhatsApp, sendFlatStatusChangeWhatsApp, sendUnifiedWhatsApp } from '../../helpers/whatsapp.helper.js';


export const ViewAllBookings = async (req, res) => {
  attachUserContext(req);
  const { cardno } = req.user;
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;
  const offset = (page - 1) * pageSize;

  req.log.info('fetch_room_bookings_start', { cardno, page, pageSize });

  const user_bookings = await database.query(
    `
    SELECT combined.*,
       t3.issuedto AS name,
       COALESCE(t2.amount, 0) AS amount,
       t2.status AS transaction_status
FROM
  (SELECT t1.bookingid,
          t1.cardno AS bookedFor,
          t1.bookedBy AS bookedBy,
          t1.roomno,
          t1.checkin,
          CASE WHEN t1.nights = 0 THEN t1.checkin ELSE t1.checkout END AS checkout,
          t1.nights,
          t1.roomtype,
          t1.status,
          t1.gender,
          t1.hold_reason,
          t1.hold_reason_meta
   FROM room_booking t1
   WHERE t1.cardno = :cardno
     OR t1.bookedBy = :cardno
   UNION SELECT t4.bookingid,
          t4.cardno AS bookedFor,
          t4.bookedBy bookedBy,
          t4.flatno AS roomno,
          t4.checkin,
          t4.checkout,
          t4.nights,
          'flat' AS roomtype,
          t4.status,
          NULL AS gender,
          t4.hold_reason,
          t4.hold_reason_meta
   FROM flat_booking t4
   WHERE t4.cardno = :cardno
    OR t4.bookedBy = :cardno
   )
   AS combined
   LEFT JOIN transactions t2 ON combined.bookingid = t2.bookingid
   AND t2.category IN (:category)
   LEFT JOIN card_db t3 ON t3.cardno = combined.bookedFor
   ORDER BY combined.checkin DESC
   LIMIT :limit
   OFFSET :offset;
    `,
    {
      replacements: {
        cardno: req.user.cardno,
        category: [TYPE_ROOM, TYPE_GUEST_ROOM, TYPE_FLAT],
        limit: pageSize,
        offset: offset
      },
      type: Sequelize.QueryTypes.SELECT
    }
  );
  // Attach a user-facing explanation for waitlisted bookings, derived from the
  // backend-owned copy map so the app doesn't hardcode reason text.
  const enriched = user_bookings.map((b) => {
    const copy =
      b.status === STATUS_WAITING && b.hold_reason
        ? HOLD_REASON_COPY[b.hold_reason] || HOLD_REASON_COPY.UNKNOWN
        : null;
    return { ...b, hold_reason_message: copy ? copy.userMessage : null };
  });

  req.log.info('fetch_room_bookings_success', { cardno, count: enriched.length });
  return res.status(200).send(enriched);
};

export const CancelBooking = async (req, res) => {
  attachUserContext(req);
  const { bookingid } = req.body;
  req.log.info('cancel_room_booking_start', { bookingid, cardno: req.user.cardno });

  const t = await database.transaction();
  req.transaction = t;

  let booking = await RoomBooking.findOne({
    where: {
      bookingid: bookingid,
      [Sequelize.Op.or]: [
        { cardno: req.user.cardno },
        { bookedBy: req.user.cardno }
      ],
      status: [
        STATUS_WAITING,
        STATUS_PAYMENT_PENDING,
        ROOM_STATUS_PENDING_CHECKIN
      ]
    }
  });

  if (!booking) {
    booking = await FlatBooking.findOne({
      where: {
        bookingid: bookingid,
        [Sequelize.Op.or]: [
          { cardno: req.user.cardno },
          { bookedBy: req.user.cardno }
        ],
        status: [
          STATUS_WAITING,
          STATUS_PAYMENT_PENDING,
          ROOM_STATUS_PENDING_CHECKIN
        ]
      }
    });
  }

  if (!booking) {
    req.log.warn('cancel_room_booking_not_found', { bookingid, cardno: req.user.cardno });
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  req.log.info('cancel_room_booking_found', {
    bookingid,
    cardno: req.user.cardno,
    currentStatus: booking.status,
    roomno: booking.roomno || booking.flatno,
    checkin: booking.checkin,
    checkout: booking.checkout
  });

  const previousStatus = booking.status;
  await userCancelBooking(req.user, booking, t);
  req.log.info('cancel_room_booking_cancelled', { bookingid, cardno: req.user.cardno });
  await t.commit();
  req.log.info('cancel_room_booking_committed', { bookingid });

  if (booking instanceof RoomBooking) {
    try {
      await sendRoomStatusChangeWhatsApp(booking, previousStatus);
    } catch (waErr) {
      console.error("Error sending room cancellation WhatsApp:", waErr);
    }
  } else if (booking instanceof FlatBooking) {
    try {
      await sendFlatStatusChangeWhatsApp(booking, previousStatus);
    } catch (waErr) {
      console.error("Error sending flat cancellation WhatsApp:", waErr);
    }
  }

  sendMail({
    email: req.user.email,
    subject: 'Raj Sharan - Room Booking Cancelled',
    template: 'rajSharanCancellation',
    context: {
      name: req.user.issuedto,
      bookingid: booking.bookingid,
      checkin: booking.checkin,
      checkout: booking.checkout
    }
  });

  if (booking.bookedBy) {
    const other = getOtherBookingUser(booking, req.user.cardno);
    if (other) {
      const title = 'Raj Sharan Booking Cancelled';
      const body =
        req.user.cardno === booking.cardno
          ? `Room booking for ${req.user.issuedto} from ${moment(
            booking.checkin
          ).format('Do MMM, YYYY')} to ${moment(booking.checkout).format(
            'Do MMM, YYYY'
          )} has been cancelled.`
          : `Your room booking from ${moment(booking.checkin).format(
            'Do MMM, YYYY'
          )} to ${moment(booking.checkout).format(
            'Do MMM, YYYY'
          )} has been cancelled.`;
      notifyCardno(other, { title, body, screen: '/bookings' });
    }
  }

  req.log.info('cancel_room_booking_success', { bookingid, cardno: req.user.cardno });
  res.status(200).send({ message: 'Room booking cancelled' });
};

/**
 * @deprecated This endpoint is deprecated. Use the unified booking endpoint with TYPE_FLAT as primary_booking instead.
 * This endpoint is kept for backward compatibility only.
 * New implementations should use: POST /api/mumukshu-booking/booking with primary_booking.booking_type = 'flat'
 */
export const FlatBookingMumukshu = async (req, res) => {
  attachUserContext(req);
  req.log.warn('flat_booking_mumukshu_deprecated', {
    cardno: req.user.cardno,
    message: 'FlatBookingMumukshu endpoint is deprecated. Use unified booking endpoint instead.'
  });

  const { mumukshus, startDay, endDay } = req.body;
  req.log.info('flat_booking_mumukshu_start', {
    cardno: req.user.cardno,
    startDay,
    endDay,
    mumukshuCount: mumukshus?.length
  });

  const t = await database.transaction();
  req.transaction = t;

  const cardnos = mumukshus.map((mumukshu) => mumukshu['cardno']);

  const { userBookingIds, order } = await bookFlatForMumukshus(
    startDay,
    endDay,
    cardnos,
    req.user,
    t
  );

  await t.commit();
  req.log.info('flat_booking_mumukshu_committed', {
    cardno: req.user.cardno,
    orderId: order?.id,
    amount: order?.amount
  });

  const userBookingIdMap = {};
  for (const cardno in userBookingIds) {
    userBookingIdMap[cardno] = {
      [TYPE_FLAT]: userBookingIds[cardno]
    };
  }

  // --- WhatsApp notifications ---
  try {
    const bookedByCard = req.user.cardno;
    const allCardnos = Object.keys(userBookingIdMap || {});
    const jobs = [];

    for (const cardno of allCardnos) {
      const flatIds = userBookingIds[cardno] || [];
      const flatBookingDetails = flatIds.length
        ? await FlatBooking.findAll({ where: { bookingid: { [Sequelize.Op.in]: flatIds } } })
        : [];

      jobs.push(sendUnifiedWhatsApp(
        cardno,
        [],
        [],
        flatBookingDetails,
        [],
        [],
        null
      ));

      if (cardno !== bookedByCard) {
        jobs.push(sendUnifiedWhatsApp(
          bookedByCard,
          [],
          [],
          flatBookingDetails,
          [],
          [],
          cardno
        ));
      }
    }

    const results = await Promise.allSettled(jobs);
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.error(`WhatsApp job #${i} failed:`, r.reason);
      } else {
        console.log(`WhatsApp job #${i} succeeded`);
      }
    });
  } catch (waErr) {
    console.error("Unexpected error in WhatsApp notification block:", waErr);
  }

  sendUnifiedEmailForBookedBy(userBookingIdMap, req.user, BOOKING_STATUS_PENDING, false);

  Object.entries(userBookingIds)
    .filter(([cardno]) => cardno !== req.user.cardno) // Filter out the current user's cardno
    .forEach(([cardno, bookings]) => {
      sendUnifiedEmail(
        cardno,
        { [TYPE_FLAT]: bookings },
        req.user,
        BOOKING_STATUS_PENDING,
        'unifiedBookingEmail',
        false
      );
    });

  req.log.info('flat_booking_mumukshu_success', {
    cardno: req.user.cardno,
    orderId: order?.id,
    amount: order?.amount
  });
  return res.status(200).send({
    message: MSG_BOOKING_SUCCESSFUL,
    data: order
  });
};

export const CheckBlockedDates = async (req, res) => {
  const { checkin, checkout, cardno, mumukshus, guests } = req.body;
  if (!checkin || !checkout) {
    throw new ApiError(400, 'Checkin and checkout dates are required');
  }
  if (!moment(checkin, 'YYYY-MM-DD', true).isValid() || !moment(checkout, 'YYYY-MM-DD', true).isValid()) {
    throw new ApiError(400, 'Invalid checkin or checkout date format, must be YYYY-MM-DD');
  }
  if (checkout < checkin) {
    throw new ApiError(400, 'checkout date cannot be before checkin date');
  }

  const blockedDates = await getBlockedDates(checkin, checkout);
  const blockedPeriods = blockedDates.map(
    (b) => `${formatBlockedPeriod(b)}${b.comments ? ` (Reason: ${b.comments})` : ''}`
  );

  let exceedsLimit = false;
  let limitMessage = '';
  let reasonType = '';
  let totalWindowNights = 0;

  const cardsToCheck = [];
  const stayingCards = [];

  const extractCardno = async (item) => {
    if (!item) return null;
    if (typeof item === 'string' || typeof item === 'number') return String(item);
    if (typeof item === 'object') {
      if (item.cardno) return String(item.cardno);
      if (item.mobno) {
        const card = await CardDb.findOne({
          attributes: ['cardno'],
          where: { mobno: item.mobno }
        });
        return card ? String(card.cardno) : null;
      }
    }
    return null;
  };

  if (Array.isArray(mumukshus)) {
    for (const m of mumukshus) {
      const c = await extractCardno(m);
      if (c && !stayingCards.includes(c)) stayingCards.push(c);
    }
  }
  if (Array.isArray(guests)) {
    for (const g of guests) {
      const c = await extractCardno(g);
      if (c && !stayingCards.includes(c)) stayingCards.push(c);
    }
  }

  const isGuestOrMumukshuBooking =
    (Array.isArray(mumukshus) && mumukshus.length > 0) ||
    (Array.isArray(guests) && guests.length > 0);

  if (stayingCards.length > 0) {
    cardsToCheck.push(...stayingCards);
  } else if (cardno && !isGuestOrMumukshuBooking) {
    cardsToCheck.push(cardno);
  } else if (!isGuestOrMumukshuBooking && req.user?.cardno) {
    // M1: no cardno / mumukshus / guests supplied → this is a self-booking
    // preview for the authenticated card. Fall back to req.user.cardno so the
    // cap/block preview runs for that card instead of an empty occupant set
    // (which would otherwise default blockedAction to 'reject').
    cardsToCheck.push(String(req.user.cardno));
  }

  // ONE getDateRangesDuringUtsav call, shared by the cap check below and the
  // splitRanges output further down. Each range is tagged isBlocked; a blocked
  // range is waitlisted (not committed), so the cap must count only the
  // EFFECTIVE (non-blocked) ranges — the same basis the booking/validate path
  // (checkRoomAvailabilityForMumukshus) now uses, keeping preview and booking
  // consistent so the app never prompts for a cap the booking won't enforce.
  let rangesMap = {};
  if (cardsToCheck.length > 0) {
    rangesMap = await getDateRangesDuringUtsav(cardsToCheck, checkin, checkout, null);
  }

  for (const card of cardsToCheck) {
    // Rewired onto the shared cap engine (ours). The engine needs the card's
    // res_status to apply the residency exemption. B4 shapes the full contract.
    const cardObj = await CardDb.findOne({
      where: { cardno: card },
      attributes: ['cardno', 'res_status']
    });
    if (!cardObj) continue;
    // Effective bookable nights only: drop blocked (waitlisted) ranges. A fully
    // blocked stay has no effective ranges → NOT over-cap (skip the engine call).
    const effectiveRanges = (rangesMap[card] || [])
      .filter((r) => !r.isBlocked)
      .map((r) => ({ checkin: r.start, checkout: r.end }));
    if (effectiveRanges.length === 0) continue;
    const cap = await checkRollingWindowLimit({
      card: cardObj,
      ranges: effectiveRanges,
      t: null
    });
    if (cap.exceeds) {
      exceedsLimit = true;
      limitMessage =
        HOLD_REASON_COPY?.ROLLING_WINDOW_LIMIT?.userMessage ||
        'Stay duration exceeds 9-night limit.';
      reasonType = 'rolling_limit_exceeded';
      totalWindowNights = cap.windowNights;
      break;
    }
  }

  // Check if stay is split around an Utsav event (reuse the ranges computed above)
  let splitRanges = null;
  if (cardsToCheck.length > 0) {
    const primaryCardRanges = rangesMap[cardsToCheck[0]] || [];
    if (primaryCardRanges.length > 1) {
      splitRanges = primaryCardRanges.map(r => ({
        start: r.start,
        end: r.end,
        nights: moment(r.end).diff(moment(r.start), 'days'),
        isBlocked: r.isBlocked
      }));
    }
  }

  // Check if any blocked period corresponds to a Utsav event
  let isUtsavBlock = false;
  if (blockedDates.length > 0) {
    const utsav = await findOverlappingUtsav(checkin, checkout);
    if (utsav) {
      isUtsavBlock = true;
    }
  }

  // App contract (T1c): tell the client whether the block leads to a REJECT or a
  // legit SPLIT so it can branch cleanly.
  //   - null   → no block overlaps these dates.
  //   - 'split'→ the block falls entirely inside a utsav the member is ATTENDING
  //              (getDateRangesDuringUtsav split the stay pre/post; the festival
  //              gap is excluded, so no range is flagged isBlocked). This is a
  //              legit, bookable path (boundary night may still waitlist).
  //   - 'reject'→ everything else: a non-utsav centre block, an overlapping utsav
  //              the member is NOT attending, or an attended-utsav stay that ALSO
  //              hits a separate non-utsav block. Blocked = unavailable → the
  //              booking write path throws; the app must not offer a waitlist.
  // Attendance is resolved inside getDateRangesDuringUtsav (utsav=null here, so it
  // reads each card's existing utsav bookings). A blocked range surviving as
  // isBlocked on ANY card means at least one occupant would be rejected.
  let blockedAction = null;
  if (blockedDates.length > 0) {
    const isDayVisit = checkin === checkout;
    if (cardsToCheck.length === 0) {
      // No occupant context → cannot prove attendance → treat as reject.
      blockedAction = 'reject';
    } else if (isDayVisit) {
      // I1: a day visit is a single whole range — it can never be a legit
      // attended-utsav split, so any overlapping block is a hard reject (never
      // 'split'). Kept explicit so it holds regardless of range flagging.
      blockedAction = 'reject';
    } else {
      const anyBlocked = cardsToCheck.some((c) =>
        (rangesMap[c] || []).some((r) => r.isBlocked)
      );
      // anyBlocked === false only happens when an attended-utsav split absorbed
      // the block into the excluded festival gap → a legit split.
      blockedAction = anyBlocked ? 'reject' : 'split';
    }
  }

  return res.status(200).send({
    isBlocked: blockedDates.length > 0,
    isUtsavBlock,
    blockedAction,
    blockedPeriods,
    exceedsLimit,
    limitMessage,
    reasonType,
    totalWindowNights,
    splitRanges
  });
};

// Read-only, no lock: the per-date map the stay date-picker uses to answer the
// ONLY question a calendar can answer — "can these dates be booked at all?".
// It cannot answer availability, because a free bed depends on room type, floor
// and gender, which the member picks after the dates.
//
// Every date it returns is a hard no or a shape change, never a waitlist. A
// blocked date must never be offered as a waitlist: no cron promotes one, so it
// would wait forever.
//
//   { data: { "YYYY-MM-DD": { type, kind, reason, utsavName? }, ... } }
//
// `kind` is the precise cause and is what current clients read:
//   closed     - a non-utsav centre block. Nobody can stay.
//   utsav_out  - an Utsav this card is NOT attending. The centre is closed to them.
//   utsav_in   - an Utsav this card IS attending. Selectable: the stay splits
//                pre/post and the festival nights drop out.
//   own        - this card already holds a room or flat booking on that night.
//
// `type` is kept for older app builds that only understand 'block' | 'utsav'.
// Mapping it so utsav_out and own arrive as 'block' also fixes those builds:
// they previously left both selectable until the booking call rejected them.
//
// Without `cardno` the map still returns centre blocks, but it cannot resolve
// attendance or own bookings, so every Utsav day is reported as utsav_out. That
// is the safe direction: it over-blocks rather than promising a stay we reject.
export const GetBlockedDatesInRange = async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) {
    throw new ApiError(400, 'from and to dates are required');
  }
  if (
    !moment(from, 'YYYY-MM-DD', true).isValid() ||
    !moment(to, 'YYYY-MM-DD', true).isValid()
  ) {
    throw new ApiError(400, 'Invalid from or to date format, must be YYYY-MM-DD');
  }
  if (to < from) {
    throw new ApiError(400, 'to date cannot be before from date');
  }
  const rangeDays = moment(to, 'YYYY-MM-DD').diff(moment(from, 'YYYY-MM-DD'), 'days');
  if (rangeDays > 92) {
    throw new ApiError(400, 'Date range too large; max 92 days');
  }

  const cardno = req.query.cardno || req.user?.cardno || null;

  // Active centre blocks overlapping the window (reuses the booking-path helper).
  const blockedDates = await getBlockedDates(from, to);

  const utsavs = await UtsavDb.findAll({
    where: {
      start_date: { [Sequelize.Op.lte]: to },
      end_date: { [Sequelize.Op.gte]: from }
    },
    attributes: ['id', 'name', 'start_date', 'end_date']
  });

  // Which of those Utsavs this card actually holds a booking for. Attendance is
  // what separates "the centre is closed to you" from "your stay will split".
  // Reuses the same helper the booking path uses, so the calendar and the
  // booking engine cannot disagree about attendance.
  const attendedUtsavIds = new Set();
  if (cardno && utsavs.length > 0) {
    // Queried directly with explicit attributes rather than through
    // getUtsavBookings, which eager-loads the whole UtsavDb row. That include
    // selects every column the model declares, so a column that exists in the
    // model but not yet in the database (a pending migration) turns this
    // read-only lookup into a 500.
    const held = await UtsavBooking.findAll({
      attributes: ['utsavid'],
      where: {
        cardno: String(cardno),
        utsavid: utsavs.map((u) => u.id),
        status: { [Sequelize.Op.in]: ACTIVE_UTSAV_BOOKING_STATUSES }
      }
    });
    for (const row of held) {
      if (row.utsavid != null) attendedUtsavIds.add(String(row.utsavid));
    }
  }

  const dateMap = {};
  const setDay = (key, value) => {
    if (key < from || key > to) return;
    dateMap[key] = value;
  };

  const eachNight = (startDate, lastNight, fn) => {
    const cursor = moment(startDate, 'YYYY-MM-DD');
    const last = moment(lastNight, 'YYYY-MM-DD');
    for (; cursor.isSameOrBefore(last); cursor.add(1, 'days')) {
      fn(cursor.format('YYYY-MM-DD'));
    }
  };

  // 1) Utsav days. An attended Utsav stays selectable; a non-attended one closes
  //    the centre for this card exactly like a plain block.
  for (const u of utsavs) {
    const attending = attendedUtsavIds.has(String(u.id));
    const name = u.name || 'Utsav';
    eachNight(u.start_date, u.end_date, (key) =>
      setDay(
        key,
        attending
          ? {
              type: 'utsav',
              kind: 'utsav_in',
              utsavName: name,
              reason: `${name} — you are attending. These nights are part of the Utsav, not of your stay.`
            }
          : {
              type: 'block',
              kind: 'utsav_out',
              utsavName: name,
              reason: `${name} — you are not attending, so the centre is closed to you on these dates.`
            }
      )
    );
  }

  // 2) Non-utsav centre blocks. A block {checkin, checkout} closes the centre for
  //    nights checkin .. checkout-1, matching the overlap test in getBlockedDates.
  //    block_dates checkout is inconsistent: utsav auto-blocks store end+1
  //    (exclusive departure day) while manual same-day blocks store checkout ==
  //    checkin. blockNightBounds resolves both. An attended Utsav day is left
  //    alone, because its own auto-block would otherwise close a span the
  //    attendee is entitled to book across.
  for (const b of blockedDates) {
    const { lastNight } = blockNightBounds(b.checkin, b.checkout);
    eachNight(b.checkin, lastNight, (key) => {
      // An Utsav already explains itself better than "the centre is closed",
      // whether or not the member attends. Utsavs auto-create a block row, so
      // without this the same festival reports two different reasons across its
      // own days.
      const existing = dateMap[key]?.kind;
      if (existing === 'utsav_in' || existing === 'utsav_out') return;
      setDay(key, {
        type: 'block',
        kind: 'closed',
        reason: b.comments
          ? `The centre is closed on these dates: ${b.comments}`
          : 'The centre is closed on these dates.'
      });
    });
  }

  // 3) Nights this card already holds. An overlapping booking is a hard no for
  //    both rooms and flats, and it is the one blocked case the old map missed —
  //    the endpoint accepted `cardno` and never used it, so a member could pick
  //    dates they already held and only learn at submit.
  if (cardno) {
    const overlapWhere = {
      cardno: String(cardno),
      checkin: { [Sequelize.Op.lte]: to },
      checkout: { [Sequelize.Op.gte]: from },
      status: {
        [Sequelize.Op.notIn]: [STATUS_CANCELLED, STATUS_ADMIN_CANCELLED]
      }
    };

    const [ownRooms, ownFlats] = await Promise.all([
      RoomBooking.findAll({
        attributes: ['checkin', 'checkout', 'nights'],
        where: overlapWhere
      }),
      FlatBooking.findAll({
        attributes: ['checkin', 'checkout'],
        where: overlapWhere
      })
    ]);

    const markOwn = (booking, label) => {
      // checkout is the departure day, so the last night held is checkout-1. A
      // day visit (nights === 0) holds the checkin day itself.
      const isDayVisit = booking.nights === 0 || booking.checkout <= booking.checkin;
      const lastNight = isDayVisit
        ? booking.checkin
        : moment(booking.checkout, 'YYYY-MM-DD')
            .subtract(1, 'days')
            .format('YYYY-MM-DD');
      const span = isDayVisit
        ? moment(booking.checkin).format('D MMM')
        : `${moment(booking.checkin).format('D MMM')} to ${moment(
            booking.checkout
          ).format('D MMM')}`;
      eachNight(booking.checkin, lastNight, (key) => {
        if (dateMap[key]?.kind === 'closed' || dateMap[key]?.kind === 'utsav_out') return;
        setDay(key, {
          type: 'block',
          kind: 'own',
          reason: `You already have a ${label} booked from ${span}.`
        });
      });
    };

    for (const booking of ownRooms) markOwn(booking, 'stay');
    for (const booking of ownFlats) markOwn(booking, 'flat stay');
  }

  return res.status(200).send({ data: dateMap });
};
