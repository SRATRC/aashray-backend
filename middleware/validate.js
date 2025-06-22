import { CardDb, UtsavBooking, UtsavDb } from '../models/associations.js';
import {
  ERR_CARD_NOT_FOUND,
  ERR_CARD_NOT_PROVIDED,
  STATUS_CANCELLED,
  STATUS_ADMIN_CANCELLED,
  TYPE_UTSAV,
  TYPE_ROOM,
  TYPE_TRAVEL
} from '../config/constants.js';
import { getBlockedDates } from '../controllers/helper.js';
import { Sequelize } from 'sequelize';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/CatchAsync.js';
import moment from 'moment';

export const validateCard = catchAsync(async (req, res, next) => {
  const cardno = req.params.cardno || req.body.cardno || req.query.cardno;
  if (cardno === undefined) throw new ApiError(404, ERR_CARD_NOT_PROVIDED);
  const cardData = await CardDb.findOne({
    where: { cardno: cardno }
  });
  if (!cardData) throw new ApiError(404, ERR_CARD_NOT_FOUND);
  req.user = cardData;
  next();
});

async function hasOverlappingUtsavBooking(cardno, checkin_date, checkout_date) {
  const utsavBookings = await UtsavBooking.findAll({
    where: {
      cardno,
      status: {
        [Sequelize.Op.notIn]: [STATUS_CANCELLED, STATUS_ADMIN_CANCELLED]
      }
    },
    include: [
      {
        model: UtsavDb,
        where: {
          [Sequelize.Op.or]: [
            {
              [Sequelize.Op.and]: [
                { start_date: { [Sequelize.Op.lte]: checkout_date } },
                { end_date: { [Sequelize.Op.gte]: checkin_date } }
              ]
            }
          ]
        }
      }
    ]
  });

  return utsavBookings.length > 0;
}

export const CheckDatesBlocked = catchAsync(async (req, res, next) => {
  /*
    This middleware now supports validation for all booking types (room, utsav, travel)
    present in both primary_booking and addons array. It scans every relevant date
    range and throws an error if the range clashes with blocked dates.
  */

  // 1. Collect all booking objects from the request
  const bookings = [];
  if (req.body.primary_booking) bookings.push(req.body.primary_booking);
  if (Array.isArray(req.body.addons)) bookings.push(...req.body.addons);

  // Fallback for legacy formats where primary_booking is not sent
  if (bookings.length === 0 && req.body) {
    bookings.push({ booking_type: null, details: req.body });
  }

  // 2. Extract date ranges of interest from each booking
  const dateRanges = [];
  for (const booking of bookings) {
    if (!booking || !booking.details) continue;
    const { booking_type, details } = booking;
    let checkin = null;
    let checkout = null;

    switch (booking_type) {
      case TYPE_ROOM:
      case TYPE_UTSAV:
        checkin = details.checkin_date;
        checkout = details.checkout_date;
        break;
      case TYPE_TRAVEL:
        // Travel bookings have a single date field
        checkin = details.date;
        checkout = details.date;
        break;
      default:
        // Skip booking types that don’t block accommodation dates
        break;
    }

    if (checkin && checkout) {
      dateRanges.push({
        checkin,
        checkout,
        isUtsav: booking_type === TYPE_UTSAV,
        isTravel: booking_type === TYPE_TRAVEL
      });
    }
  }

  if (dateRanges.length === 0) return next();

  // Extract Utsav ranges for comparison with travel bookings in this request
  const utsavRanges = dateRanges.filter((dr) => dr.isUtsav);

  // 3. Validate every extracted date range against blocked dates
  const conflictingBlocks = [];
  for (const { checkin, checkout, isUtsav, isTravel } of dateRanges) {
    const blockedDates = await getBlockedDates(checkin, checkout);
    if (blockedDates.length === 0) continue;

    const hasUtsavBooking = await hasOverlappingUtsavBooking(
      req.user.cardno,
      checkin,
      checkout
    );

    let allowBoundaryTouch = false;

    // Allow boundary touch for Utsav and Room bookings unconditionally.
    if (isUtsav) {
      allowBoundaryTouch = true;
    } else if (isTravel) {
      // For travel bookings we still need either an existing Utsav booking
      // or an Utsav range within the current request to allow boundary touch.
      const overlapsRequestUtsav = utsavRanges.some(
        (ur) =>
          moment(checkin).isSameOrAfter(ur.checkin) &&
          moment(checkin).isSameOrBefore(ur.checkout)
      );
      allowBoundaryTouch = hasUtsavBooking || overlapsRequestUtsav;
    } else {
      // Room bookings (or any other non-Utsav / non-Travel booking) can now
      // touch the boundary of blocked or Utsav dates without additional checks.
      allowBoundaryTouch = true;
    }
    if (allowBoundaryTouch) {
      const hasOverlapBeyondBoundary = blockedDates.some((block) => {
        const touchesOnlyBoundary =
          checkout === block.checkin || checkin === block.checkout;
        return !touchesOnlyBoundary;
      });
      if (!hasOverlapBeyondBoundary) continue;
    }

    // Aggregate blocking information
    conflictingBlocks.push(
      ...blockedDates.map(
        (block) =>
          `${moment(block.checkin).format('Do MMMM, YYYY')} to ${moment(
            block.checkout
          ).format('Do MMMM, YYYY')} for ${block.comments}`
      )
    );
  }

  if (conflictingBlocks.length > 0) {
    const blockingInfo = conflictingBlocks.join(', ');
    throw new ApiError(
      400,
      `Dates are blocked during following periods: ${blockingInfo}`
    );
  }

  next();
});
