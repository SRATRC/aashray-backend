import { CardDb } from '../models/associations.js';
import BlockDates from '../models/block_dates.model.js';
import Sequelize from 'sequelize';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/CatchAsync.js';

import {
  ERR_CARD_NOT_FOUND,
  ERR_CARD_NOT_PROVIDED,
  ERR_BLOCKED_DATES
} from '../config/constants.js';
import { getBlockedDates } from '../controllers/helper.js';

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

export const CheckDatesBlocked = catchAsync(async (req, res, next) => {
  const { checkin_date, checkout_date } =
    req.body.primary_booking ? req.body.primary_booking.details : req.body;

  if (!checkin_date || !checkout_date) return next();

  const blockedDates = await getBlockedDates(checkin_date, checkout_date);

  if (blockedDates.length > 0) {
    throw new ApiError(400, ERR_BLOCKED_DATES, blockedDates);
  }

  next();
});
