import {
  FlatBooking,
  RoomBooking,
  WifiDb,
  PermanentWifiCodes,
  UtsavBooking,
  UtsavPackagesDb
} from '../../models/associations.js';
import {
  ROOM_STATUS_CHECKEDIN,
  STATUS_ACTIVE,
  STATUS_INACTIVE,
  STATUS_PENDING,
  STATUS_APPROVED,
  STATUS_MUMUKSHU,
  STATUS_RESIDENT,
  STATUS_RESET,
  STATUS_DELETED
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
  if (!booking) {
    throw new APIError(404, 'user not checked in yet.');
  }

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
  if (!booking) {
    return res.status(200).send({
      message: 'No active bookings found',
      data: []
    });
  }

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

  const [isRoomCheckedin, isFlatCheckedin, isUtsavCheckedin] =
    await Promise.all([
      RoomBooking.findOne({ where: commonWhereClause }),
      FlatBooking.findOne({ where: commonWhereClause }),
      UtsavBooking.findOne({
        include: [
          {
            model: UtsavPackagesDb,
            attributes: ['start_date', 'end_date'],
            where: {
              end_date: { [Sequelize.Op.gte]: today }
            },
            required: true
          }
        ],
        where: {
          cardno: cardno,
          status: ROOM_STATUS_CHECKEDIN
        }
      })
    ]);

  if (!isRoomCheckedin && !isFlatCheckedin && !isUtsavCheckedin) {
    return null;
  }

  return isRoomCheckedin || isFlatCheckedin || isUtsavCheckedin;
};

export const requestPermanentCode = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  if (![STATUS_MUMUKSHU, STATUS_RESIDENT].includes(req.user.res_status)) {
    throw new APIError(
      403,
      'You are not eligible to request a permanent WiFi code'
    );
  }

  // Check if user already has a pending or approved request
  const existingRequest = await PermanentWifiCodes.findOne({
    where: {
      cardno: req.user.cardno,
      status: [STATUS_PENDING, STATUS_APPROVED]
    },
    transaction: t
  });

  if (existingRequest && req.user.res_status !== STATUS_RESIDENT) {
    let message = 'You have already requested a permanent WiFi code';
    if (existingRequest.status === STATUS_APPROVED) {
      message = 'You already have an approved permanent WiFi code';
    } else if (existingRequest.status === STATUS_PENDING) {
      message =
        'You have a pending permanent WiFi code request. Please wait for admin approval.';
    }

    throw new APIError(400, message);
  }

  await PermanentWifiCodes.create(
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
      'Permanent WiFi code request submitted successfully. It will be reviewed by the admin.'
  });
};

export const fetchPermanentCodes = async (req, res) => {
  const permanentCodeRequest = await PermanentWifiCodes.findAll({
    where: {
      cardno: req.user.cardno,
      status: { [Sequelize.Op.notIn]: [STATUS_RESET, STATUS_DELETED] }
    },
    attributes: [
      'id',
      'code',
      'status',
      'requested_at',
      'reviewed_at',
      'admin_comments'
    ]
  });

  return res.status(200).send({
    message: 'Permanent WiFi code status',
    data: permanentCodeRequest
  });
};

export const resetPermanentCode = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const { id } = req.body;

  if (!id) {
    throw new APIError(400, 'Permanent WiFi code ID is required for reset');
  }

  if (![STATUS_MUMUKSHU, STATUS_RESIDENT].includes(req.user.res_status)) {
    throw new APIError(
      403,
      'You are not eligible to request a permanent WiFi code reset'
    );
  }

  const existingCode = await PermanentWifiCodes.findOne({
    where: {
      id,
      cardno: req.user.cardno,
      status: STATUS_APPROVED
    },
    transaction: t
  });

  if (!existingCode) {
    throw new APIError(404, 'No approved permanent WiFi code found to reset');
  }

  await existingCode.update(
    {
      status: STATUS_RESET
    },
    { transaction: t }
  );

  await PermanentWifiCodes.create(
    {
      cardno: req.user.cardno,
      status: STATUS_PENDING,
      requested_at: new Date()
    },
    { transaction: t }
  );

  await t.commit();

  return res.status(200).send({
    message:
      'Your permanent WiFi code reset request has been submitted successfully'
  });
};

export const deletePermanentCode = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const { id } = req.body;

  if (!id) {
    throw new APIError(400, 'Permanent WiFi code ID is required for deletion');
  }

  const existingCode = await PermanentWifiCodes.findOne({
    where: {
      id,
      cardno: req.user.cardno
    },
    transaction: t
  });

  if (!existingCode) {
    throw new APIError(404, 'WiFi code not found');
  }

  if (existingCode.status === STATUS_DELETED) {
    throw new APIError(400, 'WiFi code is already deleted');
  }

  await existingCode.update(
    {
      status: STATUS_DELETED
    },
    { transaction: t }
  );

  await t.commit();

  return res.status(200).send({
    message: 'WiFi code deleted successfully'
  });
};
