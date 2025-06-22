import {
  GateRecord,
  CardDb,
  FlatBooking,
  RoomBooking
} from '../../models/associations.js';
import {
  STATUS_MUMUKSHU,
  STATUS_ONPREM,
  STATUS_RESIDENT,
  STATUS_SEVA_KUTIR,
  STATUS_OFFPREM,
  ROOM_STATUS_CHECKEDIN,
  ROOM_STATUS_CHECKEDOUT,
  ROOM_STATUS_PENDING_CHECKIN
} from '../../config/constants.js';
import logger from '../../config/logger.js';
import database from '../../config/database.js';
import Sequelize from 'sequelize';
import moment from 'moment';

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
    }
  });

  return res.status(200).send({ message: 'Success', data: total_pr });
};

export const fetchMumukshu = async (req, res) => {
  const total_mumukshu = await CardDb.findAll({
    where: {
      status: STATUS_ONPREM,
      res_status: STATUS_MUMUKSHU
    }
  });

  return res.status(200).send({ message: 'Success', data: total_mumukshu });
};

export const fetchSevaKutir = async (req, res) => {
  const total_seva = await CardDb.findAll({
    where: {
      status: STATUS_ONPREM,
      res_status: STATUS_SEVA_KUTIR
    }
  });

  return res.status(200).send({ message: 'Success', data: total_seva });
};

export const gateEntry = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const { cardno } = req.body;

  const user = await CardDb.findOne({
    where: { cardno }
  });

  if (!user) {
    return res.status(404).send({ message: 'User not found.' });
  }

  if (user.status == STATUS_OFFPREM)
    await user.update(
      { status: STATUS_ONPREM, updatedBy: req.user.username },
      { transaction: t }
    );

  await GateRecord.create(
    {
      cardno,
      status: STATUS_ONPREM,
      updatedBy: req.user.username
    },
    { transaction: t }
  );

  res.on('finish', async () => {
    try {
      const flatBooking = await FlatBooking.findOne({
        where: {
          cardno,
          status: ROOM_STATUS_PENDING_CHECKIN,
          checkin: { [Sequelize.Op.eq]: moment().format('YYYY-MM-DD') }
        }
      });

      if (flatBooking) {
        flatBooking.status = ROOM_STATUS_CHECKEDIN;
        await flatBooking.save();
      }

      const roomBooking = await RoomBooking.findOne({
        where: {
          cardno,
          status: ROOM_STATUS_PENDING_CHECKIN,
          checkin: { [Sequelize.Op.eq]: moment().format('YYYY-MM-DD') }
        }
      });

      if (roomBooking) {
        roomBooking.status = ROOM_STATUS_CHECKEDIN;
        await roomBooking.save();
      }
    } catch (error) {
      logger.error(error);
    }
  });

  await t.commit();
  return res.status(200).send({ message: 'Success' });
};

export const gateExit = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const user = await CardDb.findOne({
    where: { cardno: req.body.cardno }
  });

  user.update(
    { status: STATUS_OFFPREM, updatedBy: req.user.username },
    { transaction: t }
  );

  await GateRecord.create(
    {
      cardno: req.body.cardno,
      status: STATUS_OFFPREM,
      updatedBy: req.user.username
    },
    { transaction: t }
  );

  const today = moment().format('YYYY-MM-DD');

  const booking = await FlatBooking.findOne({
    where: {
      cardno: req.body.cardno,
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
  const result = await database.query(
    `
  SELECT 
    gr.*, 
    cd.issuedto, 
    cd.mobno
  FROM 
    gate_record AS gr
  LEFT JOIN 
    card_db AS cd 
  ON 
    gr.cardno = cd.cardno
`,
    {
      type: Sequelize.QueryTypes.SELECT
    }
  );

  return res.status(200).send({ message: 'Success', data: result });
};
