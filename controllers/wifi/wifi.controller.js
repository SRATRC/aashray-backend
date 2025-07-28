import {
  FlatBooking,
  RoomBooking,
  WifiDb,
  PermanentWifiCodes
} from '../../models/associations.js';
import {
  ROOM_STATUS_CHECKEDIN,
  STATUS_ACTIVE,
  STATUS_INACTIVE,
  STATUS_PENDING,
  STATUS_APPROVED,
  STATUS_REJECTED
} from '../../config/constants.js';
import APIError from '../../utils/ApiError.js';
import Sequelize from 'sequelize';
import database from '../../config/database.js';
import moment from 'moment';

const MAX_WIFI_PASS_LIMIT = 3;

export const generatePassword = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const booking = await fetchBookings(req.user.cardno);

  const count = await WifiDb.count({
    where: {
      cardno: req.user.cardno,
      status: STATUS_INACTIVE,
      roombookingid: booking?.bookingid
    }
  });
  if (count < MAX_WIFI_PASS_LIMIT) {
    const roombookingid = booking?.bookingid;

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
  const booking = await fetchBookings(req.user.cardno);

  const passwords = await WifiDb.findAll({
    attributes: ['password', 'createdAt'],
    where: {
      cardno: req.user.cardno,
      roombookingid: booking?.bookingid
    },
    order: [['createdAt', 'ASC']]
  });
  return res.status(200).send({ message: 'Wifi Passwords', data: passwords });
};

const fetchBookings = async (cardno) => {
  const today = moment().format('YYYY-MM-DD');
  const commonWhereClause = {
    cardno,
    checkout: { [Sequelize.Op.gte]: today },
    status: ROOM_STATUS_CHECKEDIN
  };

  const [isRoomCheckedin, isFlatCheckedin] = await Promise.all([
    RoomBooking.findOne({ where: commonWhereClause }),
    FlatBooking.findOne({ where: commonWhereClause })
  ]);

  if (!isRoomCheckedin && !isFlatCheckedin) {
    throw new APIError(401, 'User not checkedin');
  }

  return isRoomCheckedin || isFlatCheckedin;
};

export const requestPermanentCode = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  // Check if user already has a pending or approved request
  const existingRequest = await PermanentWifiCodes.findOne({
    where: {
      cardno: req.user.cardno,
      status: [STATUS_PENDING, STATUS_APPROVED]
    },
    transaction: t
  });

  if (existingRequest) {
    let message = 'You have already requested a permanent WiFi code';
    if (existingRequest.status === STATUS_APPROVED) {
      message = 'You already have an approved permanent WiFi code';
    } else if (existingRequest.status === STATUS_PENDING) {
      message =
        'You have a pending permanent WiFi code request. Please wait for admin approval.';
    }

    throw new APIError(400, message);
  }

  const newRequest = await PermanentWifiCodes.create(
    {
      cardno: req.user.cardno,
      status: STATUS_PENDING,
      requested_at: new Date()
    },
    { transaction: t }
  );

  await t.commit();

  return res.status(201).send({
    message:
      'Permanent WiFi code request submitted successfully. It will be reviewed by the admin.',
    data: {
      id: newRequest.id,
      status: newRequest.status,
      requested_at: newRequest.requested_at
    }
  });
};

export const getPermanentCodeStatus = async (req, res) => {
  const permanentCodeRequest = await PermanentWifiCodes.findOne({
    where: { cardno: req.user.cardno },
    attributes: [
      'id',
      'code',
      'status',
      'requested_at',
      'reviewed_at',
      'admin_comments'
    ]
  });

  if (!permanentCodeRequest) {
    throw new APIError(404, 'No permanent WiFi code request found');
  }

  return res.status(200).send({
    message: 'Permanent WiFi code status',
    data: permanentCodeRequest
  });
};
