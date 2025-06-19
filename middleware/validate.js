import { CardDb, UtsavBooking, UtsavDb } from '../models/associations.js';
import {
  ERR_CARD_NOT_FOUND,
  ERR_CARD_NOT_PROVIDED,
  STATUS_CANCELLED,
  STATUS_ADMIN_CANCELLED
} from '../config/constants.js';
import { getBlockedDates } from '../controllers/helper.js';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/CatchAsync.js';
import moment from 'moment';
import { Sequelize } from 'sequelize';

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
  const { checkin_date, checkout_date } = req.body.primary_booking
    ? req.body.primary_booking.details
    : req.body;

  if (!checkin_date || !checkout_date) return next();

  const blockedDates = await getBlockedDates(checkin_date, checkout_date);

  if (blockedDates.length > 0) {
    const isUtsavBooking =
      req.body.primary_booking &&
      req.body.primary_booking.booking_type === 'UTSAV';

    const hasUtsavBooking = await hasOverlappingUtsavBooking(
      req.user.cardno,
      checkin_date,
      checkout_date
    );

    if (isUtsavBooking || hasUtsavBooking) {
      const hasOverlappingMiddleDates = blockedDates.some((block) => {
        const isOnlyTouchingBoundaries =
          checkout_date === block.checkin || checkin_date === block.checkout;

        return !isOnlyTouchingBoundaries;
      });

      if (!hasOverlappingMiddleDates) {
        return next();
      }
    }

    const blockingInfo = blockedDates
      .map(
        (block) =>
          `${moment(block.checkin).format('Do MMMM, YYYY')} to ${moment(
            block.checkout
          ).format('Do MMMM, YYYY')} for ${block.comments}`
      )
      .join(', ');

    throw new ApiError(
      400,
      `Dates are blocked during following periods: ${blockingInfo}`
    );
  }

  next();
});
