import { ERR_CARD_NOT_FOUND, STATUS_RESIDENT } from '../config/constants.js';
import { CardDb } from '../models/associations.js';
import ApiError from '../utils/ApiError.js';

export async function userIsPR(cardno) {
  const card = await CardDb.findOne({
    attributes: ['cardno', 'status'],
    where: { cardno }
  });

  if (!card) {
    throw new ApiError(404, ERR_CARD_NOT_FOUND);
  }

  return card.res_status == STATUS_RESIDENT;
}

export async function validateCards(cardnos) {
  const cardDb = await CardDb.findAll({
    where: { cardno: cardnos },
    attributes: ['id', 'cardno', 'gender']
  });

  if (cardDb.length != cardnos.length) {
    throw new ApiError(404, ERR_CARD_NOT_FOUND);
  }

  return cardDb;
}
