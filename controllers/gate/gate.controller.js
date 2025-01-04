import {
  GateRecord,
  CardDb,
  FlatBooking,
  GuestRoomBooking,
  GuestDb
} from '../../models/associations.js';
import {
  STATUS_ONPREM,
  STATUS_OFFPREM,
  ROOM_STATUS_CHECKEDIN,
  ROOM_STATUS_CHECKEDOUT,
  ROOM_STATUS_PENDING_CHECKIN
} from '../../config/constants.js';
import moment from 'moment';
import Sequelize from 'sequelize';
import database from '../../config/database.js';
import ApiError from '../../utils/ApiError.js';

export const gateEntry = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const [updatedRowsCount] = await CardDb.update(
    { status: STATUS_ONPREM },
    { where: { cardno: req.user.cardno } },
    { transaction: t }
  );

  const gatein = await GateRecord.create(
    {
      cardno: req.user.cardno,
      status: STATUS_ONPREM
    },
    { transaction: t }
  );

  const today = moment().format('YYYY-MM-DD');

  const booking = await FlatBooking.findOne({
    where: {
      cardno: req.user.cardno,
      status: ROOM_STATUS_PENDING_CHECKIN,
      checkin: { [Sequelize.Op.lte]: today },
      checkout: { [Sequelize.Op.gte]: today }
    }
  });

  if (booking) {
    booking.status = ROOM_STATUS_CHECKEDIN;
    await booking.save({ transaction: t });
  }

  if (updatedRowsCount != 1 || gatein == undefined) {
    throw new ApiError(500, 'Error occured while updating the status');
  }

  await t.commit();
  return res.status(200).send({ message: 'Success', data: gatein.dataValues });
};

export const gateExit = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const [updatedRowsCount] = await CardDb.update(
    { status: STATUS_OFFPREM },
    { where: { cardno: req.user.cardno } },
    { transaction: t }
  );

  const gatein = await GateRecord.create(
    {
      cardno: req.user.cardno,
      status: STATUS_OFFPREM
    },
    { transaction: t }
  );

  const today = moment().format('YYYY-MM-DD');

  const booking = await FlatBooking.findOne({
    where: {
      cardno: req.user.cardno,
      status: ROOM_STATUS_CHECKEDIN,
      checkout: { [Sequelize.Op.lte]: today }
    }
  });

  if (booking) {
    booking.status = ROOM_STATUS_CHECKEDOUT;
    await booking.save({ transaction: t });
  }

  if (updatedRowsCount === 0 || gatein.dataValues === undefined) {
    throw new ApiError(404, 'Error updating the status');
  }

  await t.commit();
  return res.status(200).send({ message: 'Success', data: gatein.dataValues });
};

export const guestList = async (req, res) => {
  const today = moment().format('YYYY-MM-DD');
  const guestBookings = await GuestRoomBooking.findAll({
    attributes: ['cardno', 'guest'],
    include: [
      {
        model: CardDb,
        attributes: ['mobno', 'issuedto'],
        where: { cardno: Sequelize.col('GuestRoomBooking.cardno') }
      },
      {
        model: GuestDb,
        attributes: ['name'],
        where: { id: Sequelize.col('GuestRoomBooking.guest') }
      }
    ],
    where: {
      checkin: { [Sequelize.Op.eq]: today },
      status: {
        [Sequelize.Op.in]: [ROOM_STATUS_PENDING_CHECKIN, ROOM_STATUS_CHECKEDIN]
      }
    }
  });

  return res.status(200).send({ message: 'Success', data: guestBookings });
};
