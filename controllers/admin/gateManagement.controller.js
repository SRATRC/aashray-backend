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
import {
  isLegacyListRequest,
  escapeLike,
  MAX_UNPAGED_ROWS
} from '../../utils/listRequest.js';

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

// Query keys only the paginated screens send. A request with none of them is
// the old staff panel, which expects a plain array in `data`.
const LIST_QUERY_KEYS = [
  'page',
  'page_size',
  'search',
  'sort_by',
  'sort_order',
  'status',
  'res_status',
  'start_date',
  'end_date'
];

// Reply for a non-legacy request with no page. Flags a cut-off list.
const unpagedData = (records, totalCount) => {
  const data = { records, pagination: null };
  if (totalCount > records.length) {
    data.truncated = true;
    data.totalCount = totalCount;
  }
  return data;
};

// Same alias values for /residents and /record: 'pr', 'mumukshu', 'guest',
// 'seva' (or 'seva_kutir'), 'all'. Anything else means no filter.
const resolveResStatus = (value) => {
  const upper = String(value || '').toUpperCase();
  if (upper === 'PR') return STATUS_RESIDENT;
  if (upper === 'MUMUKSHU') return STATUS_MUMUKSHU;
  if (upper === 'GUEST') return STATUS_GUEST;
  if (upper === 'SEVA' || upper === 'SEVA_KUTIR' || upper === 'SEVA KUTIR')
    return STATUS_SEVA_KUTIR;
  return 'all';
};

// onPremiseDefault: the old per-group report pages (totalPR etc.) list only
// people on premises when no status is sent.
const fetchResidentsByStatus = async (
  req,
  res,
  resStatus,
  onPremiseDefault = false
) => {
  const legacy = isLegacyListRequest(req.query, LIST_QUERY_KEYS);
  const search = req.query.search || '';

  // Validate sort parameters against allow-list and sanitize inputs
  const rawSortBy = req.query.sort_by;
  const ALLOWED_SORT_COLUMNS = ['cardno', 'issuedto', 'mobno', 'status', 'last_checkin', 'last_checkout', 'createdAt', 'res_status'];
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

  const whereClause = {};
  if (resStatus && resStatus !== 'all') {
    whereClause.res_status = resStatus;
  }

  const statusFilter = req.query.status;
  if (statusFilter === 'onprem') {
    whereClause.status = STATUS_ONPREM;
  } else if (statusFilter === 'offprem') {
    whereClause.status = STATUS_OFFPREM;
  } else if (statusFilter === undefined && onPremiseDefault) {
    whereClause.status = STATUS_ONPREM;
  }

  const likeTerm = escapeLike(search);
  if (search) {
    whereClause[Sequelize.Op.or] = [
      { cardno: { [Sequelize.Op.like]: `%${likeTerm}%` } },
      { issuedto: { [Sequelize.Op.like]: `%${likeTerm}%` } },
      { mobno: { [Sequelize.Op.like]: `%${likeTerm}%` } }
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
    if (legacy) {
      const records = await CardDb.findAll(queryOptions);
      return res.status(200).send({ message: 'Success', data: records });
    }
    queryOptions.limit = MAX_UNPAGED_ROWS;
    const { count, rows } = await CardDb.findAndCountAll(queryOptions);
    return res.status(200).send({
      message: 'Success',
      data: unpagedData(rows, count)
    });
  }
};

export const fetchPR = async (req, res) => {
  return fetchResidentsByStatus(req, res, STATUS_RESIDENT, true);
};

export const fetchGuest = async (req, res) => {
  return fetchResidentsByStatus(req, res, STATUS_GUEST, true);
};

export const fetchMumukshu = async (req, res) => {
  return fetchResidentsByStatus(req, res, STATUS_MUMUKSHU, true);
};

export const fetchSevaKutir = async (req, res) => {
  return fetchResidentsByStatus(req, res, STATUS_SEVA_KUTIR, true);
};

export const fetchResidents = async (req, res) => {
  return fetchResidentsByStatus(req, res, resolveResStatus(req.query.res_status));
};

export const gateEntry = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const { cardno, scannedAt } = req.body;
  if (scannedAt && !moment(scannedAt).isValid()) {
    throw new ApiError(400, 'Invalid scannedAt timestamp');
  }
  const createdAt = scannedAt ? new Date(scannedAt) : undefined;

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
      updatedBy: req.user.username,
      ...(createdAt && { createdAt })
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

  const { cardno, scannedAt } = req.body;
  if (scannedAt && !moment(scannedAt).isValid()) {
    throw new ApiError(400, 'Invalid scannedAt timestamp');
  }
  const createdAt = scannedAt ? new Date(scannedAt) : undefined;

  const user = await CardDb.findOne({
    where: { cardno }
  });

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  if (user.status == STATUS_ONPREM)
    await user.update(
      { status: STATUS_OFFPREM, updatedBy: req.user.username },
      { transaction: t }
    );

  await GateRecord.create(
    {
      cardno,
      status: STATUS_OFFPREM,
      updatedBy: req.user.username,
      ...(createdAt && { createdAt })
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
  // The old staff panel sends no list parameters and expects a flat array.
  if (isLegacyListRequest(req.query, LIST_QUERY_KEYS)) {
    const result = await database.query(
      `SELECT gr.*, cd.issuedto, cd.mobno
       FROM gate_record AS gr
       LEFT JOIN card_db AS cd ON gr.cardno = cd.cardno
       ORDER BY gr.createdAt DESC`,
      { type: Sequelize.QueryTypes.SELECT }
    );
    return res.status(200).send({ message: 'Success', data: result });
  }

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

  const likeTerm = escapeLike(search);
  if (search) {
    whereClause[Sequelize.Op.or] = [
      { cardno: { [Sequelize.Op.like]: `%${likeTerm}%` } },
      { status: { [Sequelize.Op.like]: `%${likeTerm}%` } },
      { '$CardDb.issuedto$': { [Sequelize.Op.like]: `%${likeTerm}%` } },
      { '$CardDb.mobno$': { [Sequelize.Op.like]: `%${likeTerm}%` } }
    ];
  }

  const startDate = req.query.start_date;
  const endDate = req.query.end_date;

  if (startDate || endDate) {
    const parse = (d) => moment(String(d), 'YYYY-MM-DD', true);
    if (
      (startDate && !parse(startDate).isValid()) ||
      (endDate && !parse(endDate).isValid())
    ) {
      throw new ApiError(400, 'start_date and end_date must be YYYY-MM-DD');
    }
    whereClause.createdAt = {};
    if (startDate) {
      whereClause.createdAt[Sequelize.Op.gte] = parse(startDate).startOf('day').toDate();
    }
    if (endDate) {
      whereClause.createdAt[Sequelize.Op.lte] = parse(endDate).endOf('day').toDate();
    }
  }

  const resStatus = resolveResStatus(req.query.res_status);
  if (resStatus !== 'all') {
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
    queryOptions.limit = MAX_UNPAGED_ROWS;
    const { count, rows } = await GateRecord.findAndCountAll(queryOptions);
    return res.status(200).send({
      message: 'Success',
      data: unpagedData(rows, count)
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
