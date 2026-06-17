import {
  GateRecord,
  CardDb,
  FlatBooking,
  RoomBooking
} from '../../models/associations.js';
import {
  STATUS_MUMUKSHU,
  STATUS_GUEST,
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
import ApiError from '../../utils/ApiError.js';
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

const fetchResidentsByStatus = async (req, res, resStatus) => {
  const search = req.query.search || '';

  // Validate sort parameters against allow-list and sanitize inputs
  const rawSortBy = req.query.sort_by;
  const ALLOWED_SORT_COLUMNS = ['cardno', 'issuedto', 'mobno', 'last_checkin', 'last_checkout', 'createdAt'];
  const sortBy = ALLOWED_SORT_COLUMNS.includes(rawSortBy) ? rawSortBy : 'cardno';

  const rawSortOrder = String(req.query.sort_order || '').toUpperCase();
  const ALLOWED_SORT_ORDERS = ['ASC', 'DESC'];
  const sortOrder = ALLOWED_SORT_ORDERS.includes(rawSortOrder) ? rawSortOrder : 'ASC';

  const isPaged = req.query.page !== undefined;
  let page = null;
  let pageSize = 20;

  if (isPaged) {
    const parsedPage = parseInt(req.query.page, 10);
    page = (!isNaN(parsedPage) && parsedPage > 0) ? parsedPage : 1;

    const parsedPageSize = parseInt(req.query.page_size, 10);
    const rawPageSize = !isNaN(parsedPageSize) ? parsedPageSize : 20;
    pageSize = Math.min(Math.max(1, rawPageSize), 100);
  }

  const whereClause = {
    status: STATUS_ONPREM,
    res_status: resStatus
  };

  if (search) {
    whereClause[Sequelize.Op.or] = [
      { cardno: { [Sequelize.Op.like]: `%${search}%` } },
      { issuedto: { [Sequelize.Op.like]: `%${search}%` } },
      { mobno: { [Sequelize.Op.like]: `%${search}%` } }
    ];
  }

  let orderClause = [];
  if (sortBy === 'last_checkin') {
    orderClause = [
      [
        Sequelize.literal(`(
          SELECT MAX(createdAt)
          FROM gate_record AS gr
          WHERE gr.cardno = CardDb.cardno AND gr.status = '${STATUS_ONPREM}'
        )`),
        sortOrder
      ]
    ];
  } else if (sortBy === 'last_checkout') {
    orderClause = [
      [
        Sequelize.literal(`(
          SELECT MAX(createdAt)
          FROM gate_record AS gr
          WHERE gr.cardno = CardDb.cardno AND gr.status = '${STATUS_OFFPREM}'
        )`),
        sortOrder
      ]
    ];
  } else {
    orderClause = [[sortBy, sortOrder]];
  }

  const queryOptions = {
    where: whereClause,
    attributes: {
      include: [
        // Last check-in time
        [
          Sequelize.literal(`(
            SELECT MAX(createdAt)
            FROM gate_record AS gr
            WHERE gr.cardno = CardDb.cardno AND gr.status = '${STATUS_ONPREM}'
          )`),
          'last_checkin'
        ],
        // Last check-out time
        [
          Sequelize.literal(`(
            SELECT MAX(createdAt)
            FROM gate_record AS gr
            WHERE gr.cardno = CardDb.cardno AND gr.status = '${STATUS_OFFPREM}'
          )`),
          'last_checkout'
        ]
      ]
    },
    order: orderClause,
    subQuery: false
  };

  if (page) {
    queryOptions.limit = pageSize;
    queryOptions.offset = (page - 1) * pageSize;

    const { count, rows } = await CardDb.findAndCountAll(queryOptions);

    return res.status(200).send({
      message: 'Success',
      data: {
        records: rows,
        pagination: {
          page,
          page_size: pageSize,
          totalCount: count,
          totalPages: Math.ceil(count / pageSize)
        }
      }
    });
  } else {
    const records = await CardDb.findAll(queryOptions);
    return res.status(200).send({
      message: 'Success',
      data: {
        records,
        pagination: null
      }
    });
  }
};

export const fetchPR = async (req, res) => {
  return fetchResidentsByStatus(req, res, STATUS_RESIDENT);
};

export const fetchGuest = async (req, res) => {
  return fetchResidentsByStatus(req, res, STATUS_GUEST);
};

export const fetchMumukshu = async (req, res) => {
  return fetchResidentsByStatus(req, res, STATUS_MUMUKSHU);
};

export const fetchSevaKutir = async (req, res) => {
  return fetchResidentsByStatus(req, res, STATUS_SEVA_KUTIR);
};

export const gateEntry = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const { cardno } = req.body;

  const user = await CardDb.findOne({
    where: { cardno }
  });

  if (!user) {
    throw new ApiError(404, 'User not found');
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
  return res.status(200).send({
    message: 'Success',
    cardno: user.cardno,
    issuedto: user.issuedto
  });
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

  return res.status(200).send({
    message: 'Success',
    cardno: user.cardno,
    issuedto: user.issuedto
  });
};

export const gateRecord = async (req, res) => {
  const search = req.query.search || '';

  // Validate sort parameters against allow-list and sanitize inputs
  const rawSortBy = req.query.sort_by;
  const ALLOWED_SORT_COLUMNS = ['cardno', 'issuedto', 'mobno', 'status', 'createdAt'];
  const sortBy = ALLOWED_SORT_COLUMNS.includes(rawSortBy) ? rawSortBy : 'createdAt';

  const rawSortOrder = String(req.query.sort_order || '').toUpperCase();
  const ALLOWED_SORT_ORDERS = ['ASC', 'DESC'];
  const sortOrder = ALLOWED_SORT_ORDERS.includes(rawSortOrder) ? rawSortOrder : 'DESC';

  const isPaged = req.query.page !== undefined;
  let page = null;
  let pageSize = 20;

  if (isPaged) {
    const parsedPage = parseInt(req.query.page, 10);
    page = (!isNaN(parsedPage) && parsedPage > 0) ? parsedPage : 1;

    const parsedPageSize = parseInt(req.query.page_size, 10);
    const rawPageSize = !isNaN(parsedPageSize) ? parsedPageSize : 20;
    pageSize = Math.min(Math.max(1, rawPageSize), 100);
  }

  const whereClause = {};

  if (search) {
    whereClause[Sequelize.Op.or] = [
      { cardno: { [Sequelize.Op.like]: `%${search}%` } },
      { status: { [Sequelize.Op.like]: `%${search}%` } },
      { '$CardDb.issuedto$': { [Sequelize.Op.like]: `%${search}%` } },
      { '$CardDb.mobno$': { [Sequelize.Op.like]: `%${search}%` } }
    ];
  }

  const startDate = req.query.start_date;
  const endDate = req.query.end_date;

  if (startDate || endDate) {
    whereClause.createdAt = {};
    if (startDate) {
      whereClause.createdAt[Sequelize.Op.gte] = moment(startDate).startOf('day').toDate();
    }
    if (endDate) {
      whereClause.createdAt[Sequelize.Op.lte] = moment(endDate).endOf('day').toDate();
    }
  }

  const resStatus = req.query.res_status;
  if (resStatus) {
    whereClause['$CardDb.res_status$'] = resStatus;
  }

  let orderClause = [];
  if (sortBy === 'issuedto') {
    orderClause = [[{ model: CardDb }, 'issuedto', sortOrder]];
  } else if (sortBy === 'mobno') {
    orderClause = [[{ model: CardDb }, 'mobno', sortOrder]];
  } else {
    orderClause = [[sortBy, sortOrder]];
  }

  const queryOptions = {
    include: [
      {
        model: CardDb,
        attributes: ['issuedto', 'mobno', 'res_status']
      }
    ],
    where: whereClause,
    order: orderClause,
    subQuery: false
  };

  if (page) {
    queryOptions.limit = pageSize;
    queryOptions.offset = (page - 1) * pageSize;

    const { count, rows } = await GateRecord.findAndCountAll(queryOptions);

    return res.status(200).send({
      message: 'Success',
      data: {
        records: rows,
        pagination: {
          page,
          page_size: pageSize,
          totalCount: count,
          totalPages: Math.ceil(count / pageSize)
        }
      }
    });
  } else {
    const records = await GateRecord.findAll(queryOptions);
    return res.status(200).send({
      message: 'Success',
      data: {
        records,
        pagination: null
      }
    });
  }
};

export const fetchGateHistoryByCard = async (req, res) => {
  const { cardno } = req.params;

  const history = await GateRecord.findAll({
    where: { cardno },
    order: [['createdAt', 'DESC']]
  });

  return res.status(200).send({
    message: 'Fetched gate history',
    data: history
  });
};
