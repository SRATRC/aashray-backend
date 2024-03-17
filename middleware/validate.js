import { CardDb } from '../models/associations.js';
import BlockDates from '../models/block_dates.model.js';
import Sequelize from 'sequelize';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/CatchAsync.js';

export const validateCard = catchAsync(async (req, res, next) => {
  const cardno = req.params.cardno || req.body.cardno;
  if (cardno === undefined) throw new ApiError(404, 'cardno not provided');
  const cardData = await CardDb.findOne({
    where: { cardno: cardno }
  });
  if (!cardData) throw new ApiError(404, 'card does not exist');
  req.user = cardData;
  next();
});

export const CheckDatesBlocked = catchAsync(async (req, res, next) => {
  const startDate = new Date(req.body.checkin_date);
  const endDate = new Date(req.body.checkout_date);

  const blockdates = await BlockDates.findAll({
    where: {
      [Sequelize.Op.or]: [
        {
          [Sequelize.Op.and]: [
            { checkin: { [Sequelize.Op.lte]: startDate } },
            { checkout: { [Sequelize.Op.gte]: startDate } }
          ]
        },
        {
          [Sequelize.Op.and]: [
            { checkin: { [Sequelize.Op.lte]: endDate } },
            { checkout: { [Sequelize.Op.gte]: endDate } }
          ]
        }
      ]
    }
  });
  if (blockdates.length > 0) {
    throw new ApiError(400, 'dates are blocked', blockdates);
  }
  next();
});
