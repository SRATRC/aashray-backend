import { CardDb } from '../models/associations.js';
import BlockDates from '../models/block_dates.model.js';
import Sequelize from 'sequelize';

export const validateCard = async (req, res, next) => {
  try {
    const cardno = req.params.cardno || req.body.cardno;
    if (cardno === undefined)
      return res.status(404).send({ error: 'cardno not provided' });
    const cardData = await CardDb.findOne({
      where: { cardno: cardno }
    });
    if (!cardData)
      return res.status(404).send({ error: 'card does not exist' });
    req.user = cardData;
    next();
  } catch (err) {
    return res
      .status(500)
      .send({ error: err.message, message: 'an error occurred' });
  }
};

export const CheckDatesBlocked = async (req, res, next) => {
  try {
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
      return res.status(400).send({
        message: `dates are blocked`,
        dates: blockdates
      });
    }
    next();
  } catch (err) {
    return res
      .status(500)
      .send({ error: err.message, message: 'an error occurred' });
  }
};
