import { FlatBooking, RoomBooking, WifiDb } from '../../models/associations.js';
import {
  ROOM_STATUS_CHECKEDIN,
  STATUS_ACTIVE,
  STATUS_INACTIVE
} from '../../config/constants.js';
import APIError from '../../utils/ApiError.js';
import Sequelize from 'sequelize';
import database from '../../config/database.js';
import moment from 'moment';

const MAX_WIFI_PASS_LIMIT = 3;

export const generatePassword = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const isRoomCheckedin = await RoomBooking.findOne({
    where: {
      cardno: req.user.cardno,
      checkout: { [Sequelize.Op.gte]: moment().format('YYYY-MM-DD') },
      status: ROOM_STATUS_CHECKEDIN
    }
  });

  const isFlatCheckedin = await FlatBooking.findOne({
    where: {
      cardno: req.user.cardno,
      checkout: { [Sequelize.Op.gte]: moment().format('YYYY-MM-DD') },
      status: ROOM_STATUS_CHECKEDIN
    }
  });

  if (!isRoomCheckedin && !isFlatCheckedin) {
    throw new APIError(401, 'User not checkedin');
  }

  const count = await WifiDb.count({
    where: {
      cardno: req.user.cardno,
      status: STATUS_INACTIVE,
      roombookingid: isRoomCheckedin?.bookingid || isFlatCheckedin?.bookingid
    }
  });
  if (count < MAX_WIFI_PASS_LIMIT) {
    const roombookingid =
      isRoomCheckedin?.bookingid || isFlatCheckedin?.bookingid;

    const [updatedRows, updatedRowsCount] = await WifiDb.update(
      {
        status: STATUS_INACTIVE,
        roombookingid,
        cardno: req.user.cardno
      },
      {
        where: { status: STATUS_ACTIVE },
        order: [['pwd_id', 'ASC']],
        limit: 1,
        returning: true,
        transaction: t
      }
    );

    if (updatedRowsCount === 0) {
      throw new APIError(404, 'Error updating the status');
    }

    const updatedRow = await WifiDb.findOne({
      attributes: ['password'],
      where: {
        status: STATUS_INACTIVE,
        roombookingid,
        cardno: req.user.cardno
      },
      order: [['updatedAt', 'DESC']],
      transaction: t
    });

    await t.commit();

    return res.status(200).send({
      data: updatedRow?.password,
      message: 'Your wifi password has been generated'
    });
  } else {
    throw new APIError(
      400,
      `Cannot generate more than ${MAX_WIFI_PASS_LIMIT} passwords`
    );
  }
};

export const getPassword = async (req, res) => {
  const isRoomCheckedin = await RoomBooking.findOne({
    where: {
      cardno: req.user.cardno,
      checkout: { [Sequelize.Op.gte]: moment().format('YYYY-MM-DD') },
      status: ROOM_STATUS_CHECKEDIN
    }
  });

  const isFlatCheckedin = await FlatBooking.findOne({
    where: {
      cardno: req.user.cardno,
      checkout: { [Sequelize.Op.gte]: moment().format('YYYY-MM-DD') },
      status: ROOM_STATUS_CHECKEDIN
    }
  });

  if (!isRoomCheckedin && !isFlatCheckedin) {
    throw new APIError(401, 'User not checkedin');
  }

  const passwords = await WifiDb.findAll({
    attributes: ['password', 'createdAt'],
    where: {
      cardno: req.user.cardno,
      roombookingid: isRoomCheckedin?.bookingid || isFlatCheckedin?.bookingid
    },
    order: [['createdAt', 'ASC']]
  });
  return res.status(200).send({ message: 'Wifi Passwords', data: passwords });
};
