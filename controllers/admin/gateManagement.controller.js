import { GateRecord, CardDb, FlatBooking } from '../../models/associations.js';
import {
  STATUS_MUMUKSHU,
  STATUS_ONPREM,
  STATUS_RESIDENT,
  STATUS_SEVA_KUTIR,
  STATUS_OFFPREM,
  ROOM_STATUS_CHECKEDIN,
  ROOM_STATUS_CHECKEDOUT
} from '../../config/constants.js';
import Sequelize from 'sequelize';
import moment from 'moment';
import database from '../../config/database.js';
import ApiError from '../../utils/ApiError.js';

export const fetchTotal = async (req, res) => {
  const result = await CardDb.findAll({
    attributes: [
      'res_status',
      [Sequelize.fn('COUNT', Sequelize.literal('*')), 'count']
    ],
    where: { status: STATUS_ONPREM },
    group: ['res_status']
  });

  return res.status(200).send({ message: 'Success', data: result });
};

export const fetchPR = async (req, res) => {
  
  const total_pr = await CardDb.findAll({
    where: {
      status: STATUS_ONPREM,
      res_status: STATUS_RESIDENT
    },
  });

  return res.status(200).send({ message: 'Success', data: total_pr });
};

export const fetchMumukshu = async (req, res) => {
  
  const total_mumukshu = await CardDb.findAll({
    where: {
      status: STATUS_ONPREM,
      res_status: STATUS_MUMUKSHU
    },
  });

  return res.status(200).send({ message: 'Success', data: total_mumukshu });
};

export const fetchSevaKutir = async (req, res) => {
  
  const total_seva = await CardDb.findAll({
    where: {
      status: STATUS_ONPREM,
      res_status: STATUS_SEVA_KUTIR
    },
  });

  return res.status(200).send({ message: 'Success', data: total_seva });
};

// export const gateEntry = async (req, res) => {
//   const t = await database.transaction();
//   req.transaction = t;

//   try {
//     const user = await CardDb.findOne({
//       where: { cardno: req.params.cardno }
//     });

//     if (!user) {
//       await t.rollback();
//       return res.status(404).json({ success: false, message: 'Card not found in the system.' });
//     }

//     await user.update(
//       { status: STATUS_ONPREM, updatedBy: req.user.username },
//       { transaction: t }
//     );

//     await GateRecord.create(
//       {
//         cardno: req.params.cardno,
//         status: STATUS_ONPREM,
//         updatedBy: req.user.username
//       },
//       { transaction: t }
//     );

//     const today = moment().format('YYYY-MM-DD');

//     const booking = await FlatBooking.findOne({
//       where: {
//         cardno: req.params.cardno,
//         status: ROOM_STATUS_PENDING_CHECKIN,
//         checkin: { [Sequelize.Op.lte]: today },
//         checkout: { [Sequelize.Op.gte]: today }
//       }
//     });

//     if (booking) {
//       booking.status = ROOM_STATUS_CHECKEDIN;
//       await booking.save({ transaction: t });
//     }

//     await t.commit();
//     return res.status(200).json({ success: true, message: 'Success' });
//   } catch (err) {
//     console.error('Gate entry error:', err);
//     await t.rollback();
//     return res.status(500).json({ success: false, message: 'Internal server error.' });
//   }
// };

export const gateEntry = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const { cardno } = req.body;

  // Check if user exists based on the cardno
  const user = await CardDb.findOne({
    where: { cardno }
  });

  // If user not found, return a 404 error
  if (!user) {
    return res.status(404).send({ message: 'User not found.' });
  }

  // Update the user status (assuming the card exists)
  await user.update(
    { status: STATUS_ONPREM, updatedBy: req.user.username },
    { transaction: t }
  );

  // Create a GateRecord entry for the check-in
  await GateRecord.create(
    {
      cardno,
      status: STATUS_ONPREM,
      updatedBy: req.user.username
    },
    { transaction: t }
  );

  // Commit the transaction
  await t.commit();
  return res.status(200).send({ message: 'Success' });
};


export const gateExit = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const user = await CardDb.findOne({
    where: { cardno: req.params.cardno }
  });

  user.update(
    { status: STATUS_OFFPREM, updatedBy: req.user.username },
    { transaction: t }
  );

  await GateRecord.create(
    {
      cardno: req.params.cardno,
      status: STATUS_OFFPREM,
      updatedBy: req.user.username
    },
    { transaction: t }
  );

  const today = moment().format('YYYY-MM-DD');

  const booking = await FlatBooking.findOne({
    where: {
      cardno: req.params.cardno,
      status: ROOM_STATUS_CHECKEDIN,
      checkout: { [Sequelize.Op.lte]: today }
    }
  });

  if (booking) {
    booking.status = ROOM_STATUS_CHECKEDOUT;
    await booking.save({ transaction: t });
  }

  await t.commit();
  return res.status(200).send({ message: 'Success' });
};

export const gateRecord = async (req, res) => {
  const result = await GateRecord.findAll();
  return res.status(200).send({ message: 'Success', data: result });
};