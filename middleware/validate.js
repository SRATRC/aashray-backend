import {
  ERR_CARD_NOT_FOUND,
  ERR_CARD_NOT_PROVIDED
} from '../config/constants.js';
import { CardDb } from '../models/associations.js';
import { attachUserContext } from './Logger.js';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/CatchAsync.js';

export const validateCard = catchAsync(async (req, res, next) => {
  const cardno = req.params.cardno || req.body.cardno || req.query.cardno;
  if (cardno === undefined) throw new ApiError(404, ERR_CARD_NOT_PROVIDED);
  const cardData = await CardDb.findOne({
    where: { cardno: cardno }
  });
  if (!cardData) throw new ApiError(404, ERR_CARD_NOT_FOUND);
  req.user = cardData;
  attachUserContext(req);
  next();
});
