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
  STATUS_RESET,
  STATUS_DELETED,
  STATUS_GUEST
} from '../../config/constants.js';
import APIError from '../../utils/ApiError.js';
import Sequelize from 'sequelize';
import database from '../../config/database.js';
import moment from 'moment';

const MAX_WIFI_PASS_LIMIT = 3;

export const generateTempCode = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  if (
    !validateResStatus(req.user.res_status, [STATUS_MUMUKSHU, STATUS_GUEST])
  ) {
    throw new APIError(
      403,
      'You are not eligible to generate a temporary WiFi code'
    );
  }

  const booking = await fetchBookings(req.user.cardno);
  if (!booking) {
    throw new APIError(404, 'user not checked in yet.');
  }
  const roombookingid = booking?.bookingid;

  const count = await WifiDb.count({
    where: {
      cardno: req.user.cardno,
      status: STATUS_INACTIVE,
      roombookingid
    }
  });
  if (count >= MAX_WIFI_PASS_LIMIT) {
    throw new APIError(
      400,
      `Cannot generate more than ${MAX_WIFI_PASS_LIMIT} passwords`
    );
  }

  const [updatedCount] = await WifiDb.update(
    {
      cardno: req.user.cardno,
      status: STATUS_INACTIVE,
      roombookingid
    },
    {
      where: { status: STATUS_ACTIVE },
      order: [['pwd_id', 'ASC']],
      limit: 1,
      transaction: t
    }
  );
  if (updatedCount === 0)
    throw new APIError(
      404,
      'No available WiFi codes to assign. Please try again later.'
    );

  const updatedRow = await WifiDb.findOne({
    attributes: ['password'],
    where: {
      cardno: req.user.cardno,
      status: STATUS_INACTIVE,
      roombookingid
    },
    order: [['updatedAt', 'DESC']],
    transaction: t
  });

  await t.commit();

  return res.status(200).send({
    data: updatedRow?.password,
    message: 'Your wifi password has been generated'
  });
};

export const fetchTempCodes = async (req, res) => {
  if (
    !validateResStatus(req.user.res_status, [STATUS_MUMUKSHU, STATUS_GUEST])
  ) {
    return res.status(200).send({
      message: 'You are not eligible to fetch temporary WiFi codes',
      data: []
    });
  }

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

export const requestPermanentCode = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const { deviceType } = req.body;

  if (!deviceType) {
    throw new APIError(400, 'Device type is required');
  }

  // Check if "Mumukshu" or "Guest" already has a pending or approved request
  if (validateResStatus(req.user.res_status, [STATUS_MUMUKSHU, STATUS_GUEST])) {
    const existingRequest = await PermanentWifiCodes.findOne({
      where: {
        cardno: req.user.cardno,
        status: [STATUS_PENDING, STATUS_APPROVED]
      },
      transaction: t
    });

    if (existingRequest) {
      const WIFI_STATUS_MESSAGES = {
        [STATUS_APPROVED]: 'You already have an approved permanent WiFi code',
        [STATUS_PENDING]:
          'You have a pending permanent WiFi code request. Please wait for admin approval.'
      };

      const message =
        WIFI_STATUS_MESSAGES[existingRequest.status] ||
        'You have already requested a permanent WiFi code';

      throw new APIError(400, message);
    }
  }

  /* ================= UPDATED USERNAME LOGIC ================= */

  // Device short codes
  const DEVICE_SUFFIX_MAP = {
    mobile: 'ph',
    laptop: 'pc',
    tablet: 'tb'
  };

  const deviceSuffix =
    DEVICE_SUFFIX_MAP[deviceType.toLowerCase()] || 'ot';

  // Prefixes to ignore as first name
  const IGNORE_FIRST_NAMES = [
    'rcof',
    'rchk',
    'cons',
    'chak',
    'divi',
    'paon',
    'guest'
  ];

  // Normalize and split name
  const rawNameParts = req.user.issuedto
    .trim()
    .toLowerCase()
    .replace(/^guest-/, '')
    .split(/\s+/);

  // Remove ignored prefixes from the start
  while (
    rawNameParts.length > 1 &&
    IGNORE_FIRST_NAMES.includes(rawNameParts[0])
  ) {
    rawNameParts.shift();
  }

  const firstName = rawNameParts[0];
  const lastName =
    rawNameParts.length > 1
      ? rawNameParts[rawNameParts.length - 1]
      : '';

  // Last 4 digits of card number (keeps leading zeros)
  const cardLast4 = req.user.cardno.slice(-4);

  // <first><last><cardLast4><deviceSuffix>
  const baseUsername = `${firstName}${lastName}${cardLast4}${deviceSuffix}`;

  const similarUsernames = await PermanentWifiCodes.findAll({
  attributes: ['username', 'status'],
  where: {
    username: {
      [Sequelize.Op.like]: `${baseUsername}%`
    },
    status: [STATUS_APPROVED, STATUS_RESET, STATUS_PENDING] // ✅ ONLY THESE
  },
  transaction: t
});

  let maxCounter = 0;

  if (similarUsernames.length > 0) {
    similarUsernames.forEach((user) => {
      const currentUsername = user.username;

      if (currentUsername === baseUsername) {
        maxCounter = Math.max(maxCounter, 1);
      } else {
        const suffix = currentUsername.substring(baseUsername.length);
        if (/^\d+$/.test(suffix)) {
          maxCounter = Math.max(maxCounter, parseInt(suffix, 10));
        }
      }
    });
  }

  const uniqueUsername =
    maxCounter === 0 ? baseUsername : `${baseUsername}${maxCounter + 1}`;

  /* ========================================================== */

  await PermanentWifiCodes.create(
    {
      cardno: req.user.cardno,
      username: uniqueUsername.toLowerCase(),
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
      status: { [Sequelize.Op.notIn]: [STATUS_DELETED] }
    },
    attributes: [
      'id',
      'username',
      'code',
      'ssid',
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
    throw new APIError(400, 'WiFi code ID is required for reset');
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
    throw new APIError(404, 'No approved WiFi code found to reset');
  }

  await existingCode.update(
    {
      status: STATUS_RESET
    },
    { transaction: t }
  );

  await t.commit();

  return res.status(200).send({
    message:
      'Your permanent WiFi code reset request has been submitted successfully'
  });
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

const validateResStatus = (resStatus, validStatuses) => {
  if (!validStatuses.includes(resStatus)) {
    return false;
  }

  return true;
};
