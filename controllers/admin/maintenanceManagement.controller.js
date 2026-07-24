import {
  STATUS_INPROGRESS,
  STATUS_OPEN,
  STATUS_CLOSED,
  DEEP_CLEANING_WA_RECIPIENTS
} from '../../config/constants.js';
import { QueryTypes,Sequelize } from 'sequelize';
import database from '../../config/database.js';
// import Sequelize, { QueryTypes } from 'sequelize';
import moment from 'moment';
import ApiError from '../../utils/ApiError.js';

import {
  CardDb,
  MaintenanceDb,
  FlatDb
} from '../../models/associations.js';
import { sendWhatsAppMessage } from '../../utils/sendWhatsAppMessage.js';
import { formatWhatsAppPhone } from '../../utils/phoneFormatter.js';



const ALLOWED_SORT_COLUMNS = [
  'priority',
  'requested_by',
  'mobno',
  'createdAt',
  'closedAt',
  'department',
  'area_of_work',
  'work_detail',
  'status',
  'bookingid'
];
const ALLOWED_SORT_ORDERS = ['ASC', 'DESC'];

export const fetchMaintenanceReport = async (req, res) => {
  const { department } = req.params;
  const search = req.query.search || '';
  
  // Validate sort parameters against allow-list and sanitize inputs
  const rawSortBy = req.query.sort_by;
  const sortBy = ALLOWED_SORT_COLUMNS.includes(rawSortBy) ? rawSortBy : 'priority';
  
  const rawSortOrder = String(req.query.sort_order || '').toUpperCase();
  const sortOrder = ALLOWED_SORT_ORDERS.includes(rawSortOrder) ? rawSortOrder : 'ASC';

  const statusFilter = req.query.status || '';

  // Validate, sanitize, and clamp pagination parameters
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
    department
  };

  if (statusFilter && [STATUS_OPEN, STATUS_INPROGRESS, STATUS_CLOSED].includes(statusFilter)) {
    whereClause.status = statusFilter;
  } else {
    whereClause.status = [STATUS_OPEN, STATUS_INPROGRESS, STATUS_CLOSED];
  }

  if (search) {
    whereClause[Sequelize.Op.or] = [
      { work_detail: { [Sequelize.Op.like]: `%${search}%` } },
      { area_of_work: { [Sequelize.Op.like]: `%${search}%` } },
      { comments: { [Sequelize.Op.like]: `%${search}%` } },
      { '$CardDb.issuedto$': { [Sequelize.Op.like]: `%${search}%` } },
      { '$CardDb.mobno$': { [Sequelize.Op.like]: `%${search}%` } }
    ];
  }

  // Get status counts for the department
  const statusCountsData = await MaintenanceDb.findAll({
    attributes: [
      'status',
      [Sequelize.fn('COUNT', Sequelize.col('bookingid')), 'count']
    ],
    where: {
      department,
      status: [STATUS_OPEN, STATUS_INPROGRESS, STATUS_CLOSED]
    },
    group: ['status']
  });

  const statusCounts = {
    all: 0,
    [STATUS_OPEN]: 0,
    [STATUS_INPROGRESS]: 0,
    [STATUS_CLOSED]: 0
  };

  let totalCountAll = 0;
  statusCountsData.forEach(item => {
    const status = item.getDataValue('status');
    const count = parseInt(item.getDataValue('count'), 10) || 0;
    if (statusCounts.hasOwnProperty(status)) {
      statusCounts[status] = count;
    }
    totalCountAll += count;
  });
  statusCounts.all = totalCountAll;

  let orderClause = [];
  if (sortBy === 'requested_by') {
    orderClause = [[{ model: CardDb }, 'issuedto', sortOrder]];
  } else if (sortBy === 'mobno') {
    orderClause = [[{ model: CardDb }, 'mobno', sortOrder]];
  } else if (sortBy === 'closedAt') {
    orderClause = [
      [
        Sequelize.literal(`
          CASE 
            WHEN \`MaintenanceDb\`.\`status\` = '${STATUS_CLOSED}' THEN \`MaintenanceDb\`.\`updatedAt\`
            ELSE NULL
          END
        `),
        sortOrder
      ]
    ];
  } else if (sortBy === 'priority') {
    orderClause = [
      [
        Sequelize.literal(`
          CASE 
            WHEN \`MaintenanceDb\`.\`status\` = '${STATUS_OPEN}' THEN 0
            WHEN \`MaintenanceDb\`.\`status\` = '${STATUS_INPROGRESS}' THEN 1
            WHEN \`MaintenanceDb\`.\`status\` = '${STATUS_CLOSED}' THEN 2
            ELSE 3
          END
        `),
        sortOrder
      ],
      ['createdAt', 'DESC']
    ];
  } else {
    // Basic columns: 'createdAt', 'area_of_work', 'work_detail', 'status'
    orderClause = [[sortBy, sortOrder]];
  }

  const queryOptions = {
    include: [
      {
        model: CardDb,
        attributes: ['issuedto', 'mobno']
      }
    ],
    attributes: [
      'bookingid',
      'requested_by',
      'createdAt',
      'department',
      'work_detail',
      'area_of_work',
      'comments',
      'status',
      [Sequelize.literal(`
        CASE 
          WHEN \`MaintenanceDb\`.\`status\` = '${STATUS_CLOSED}' THEN \`MaintenanceDb\`.\`updatedAt\`
          ELSE NULL
        END
      `), 'closedAt'],
      [Sequelize.literal(`
          CASE 
            WHEN \`MaintenanceDb\`.\`status\` = '${STATUS_OPEN}' THEN 0
            WHEN \`MaintenanceDb\`.\`status\` = '${STATUS_INPROGRESS}' THEN 1
            WHEN \`MaintenanceDb\`.\`status\` = '${STATUS_CLOSED}' THEN 2
            ELSE 3
          END
        `), 'priority']
    ],
    where: whereClause,
    order: orderClause,
    subQuery: false // Required when limit/offset are used alongside joined where clauses
  };

  if (page) {
    queryOptions.limit = pageSize;
    queryOptions.offset = (page - 1) * pageSize;

    const { count, rows } = await MaintenanceDb.findAndCountAll(queryOptions);

    return res.status(200).send({
      message: 'Fetched requests for department',
      data: {
        requests: rows,
        pagination: {
          page,
          page_size: pageSize,
          totalCount: count,
          totalPages: Math.ceil(count / pageSize)
        },
        statusCounts
      }
    });
  } else {
    const requests = await MaintenanceDb.findAll(queryOptions);

    return res.status(200).send({
      message: 'Fetched requests for department',
      data: {
        requests,
        pagination: null,
        statusCounts
      }
    });
  }
};

export const updateMaintenanceRequest = async (req, res) => {

  const { bookingid, department, comments, status } = req.body;

  if (!bookingid) {
    return res.status(400).json({ message: 'Booking ID is required.' });
  }

  const maintenance = await MaintenanceDb.findOne({
    where: { bookingid },
    include: [
      {
        model: CardDb,
        as: 'card'
      }
    ]
  });

  if (!maintenance) {
    return res.status(404).json({ message: 'Maintenance request not found.' });
  }

  const wasClosed = maintenance.status === STATUS_CLOSED;

  // Update fields if provided
  // maintenance.issuedto = issuedto || maintenance.issuedto;
  // maintenance.department = department || maintenance.department;
  maintenance.comments = comments || maintenance.comments;
  maintenance.status = status || maintenance.status;

  await maintenance.save();

  if (status === STATUS_CLOSED && !wasClosed && maintenance.card) {
    const phone = maintenance.card.mobno;
    if (phone) {
      const formattedPhone = formatWhatsAppPhone(phone, maintenance.card.country);

      const components = [
        {
          type: 'body',
          parameters: [
            {
              type: 'text',
              text: maintenance.card.issuedto || 'Mumukshu'
            },
            {
              type: 'text',
              text: maintenance.area_of_work || ' '
            },
            {
              type: 'text',
              text: maintenance.work_detail || ' '
            }
          ]
        }
      ];

      sendWhatsAppMessage(formattedPhone, 'maintenance_request_closed', components).catch((err) => {
        console.error('Error sending WhatsApp message in updateMaintenanceRequest:', err.message || err);
      });
    }
  }

  return res.status(200).json({
    message: 'Maintenance request updated successfully.',
    data: maintenance
  });
}

export const fetchHousekeepingStatus = async (req, res) => {
  req.log.info('fetch_housekeeping_status_start');

  const flats = await FlatDb.findAll({
    include: [{
      model: CardDb,
      attributes: ['cardno', 'issuedto', 'mobno', 'country']
    }]
  });

  const groupedFlatsMap = {};
  flats.forEach(f => {
    const flatno = f.flatno;
    if (!groupedFlatsMap[flatno]) {
      groupedFlatsMap[flatno] = {
        flatno: flatno,
        last_deep_cleaning: f.last_deep_cleaning,
        deep_cleaning_interval: f.deep_cleaning_interval,
        deep_cleaning_history: f.deep_cleaning_history,
        owners: []
      };
    }
    if (f.CardDb && DEEP_CLEANING_WA_RECIPIENTS.includes(f.CardDb.cardno)) {
      groupedFlatsMap[flatno].owners.push({
        cardno: f.CardDb.cardno,
        issuedto: f.CardDb.issuedto,
        mobno: f.CardDb.mobno,
        country: f.CardDb.country
      });
    }
  });

  const groupedFlats = Object.values(groupedFlatsMap).sort((a, b) => a.flatno - b.flatno);

  req.log.info('fetch_housekeeping_status_success', { count: groupedFlats.length });
  return res.status(200).json({
    message: 'Success',
    data: groupedFlats
  });
};

export const markDeepCleaningDone = async (req, res) => {
  const { flatno, flatnos, cleaningDate } = req.body;
  
  req.log.info('mark_deep_cleaning_done_start', { flatno, flatnos, cleaningDate });

  let targetFlatnos = [];
  if (flatnos && Array.isArray(flatnos)) {
    targetFlatnos = flatnos.map(Number);
  } else if (flatno) {
    targetFlatnos = [Number(flatno)];
  }

  if (targetFlatnos.length === 0) {
    throw new ApiError(400, 'flatno or flatnos is required');
  }

  const dateValue = cleaningDate ? moment(cleaningDate).toDate() : new Date();

  // Find all flats to update
  const flats = await FlatDb.findAll({ where: { flatno: targetFlatnos } });
  if (flats.length === 0) {
    throw new ApiError(404, `No flats found for target numbers`);
  }

  // Update last_deep_cleaning and deep_cleaning_history for each flat
  for (const flat of flats) {
    let history = [];
    if (flat.deep_cleaning_history) {
      try {
        history = typeof flat.deep_cleaning_history === 'string'
          ? JSON.parse(flat.deep_cleaning_history)
          : flat.deep_cleaning_history;
      } catch (e) {
        history = [];
      }
    }
    if (!Array.isArray(history)) {
      history = [];
    }

    history.unshift({
      cleaned_at: dateValue,
      cleaned_by: req.user?.username || 'ADMIN'
    });

    if (history.length > 50) {
      history = history.slice(0, 50);
    }

    await FlatDb.update(
      { 
        last_deep_cleaning: dateValue, 
        deep_cleaning_history: history, 
        updatedBy: req.user?.username || 'ADMIN' 
      },
      { where: { flatno: flat.flatno } }
    );
  }

  // Fetch the owners of these flats to send WhatsApp messages
  const owners = await FlatDb.findAll({
    where: { flatno: targetFlatnos },
    include: [{
      model: CardDb,
      attributes: ['cardno', 'issuedto', 'mobno', 'country']
    }]
  });

  const whatsappLogs = [];

  // Loop through owners and check if whitelisted
  for (const ownerRecord of owners) {
    const card = ownerRecord.CardDb;
    if (card && card.mobno && DEEP_CLEANING_WA_RECIPIENTS.includes(card.cardno)) {
      const formattedPhone = formatWhatsAppPhone(card.mobno, card.country);
      const components = [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: card.issuedto || 'Owner' },
            { type: 'text', text: `Flat ${ownerRecord.flatno}` },
            { type: 'text', text: 'Deep Cleaning' }
          ]
        }
      ];

      try {
        await sendWhatsAppMessage(formattedPhone, 'maintenance_request_closed', components);
        whatsappLogs.push({ cardno: card.cardno, phone: formattedPhone, status: 'sent', flatno: ownerRecord.flatno });
        req.log.info('deep_cleaning_whatsapp_sent', { cardno: card.cardno, flatno: ownerRecord.flatno });
      } catch (err) {
        whatsappLogs.push({ cardno: card.cardno, phone: formattedPhone, status: 'failed', error: err.message, flatno: ownerRecord.flatno });
        req.log.error('deep_cleaning_whatsapp_failed', { cardno: card.cardno, error: err.message, flatno: ownerRecord.flatno });
      }
    }
  }

  req.log.info('mark_deep_cleaning_done_success', { targetFlatnos, whatsappLogs });

  return res.status(200).json({
    message: 'Deep cleaning status updated successfully.',
    data: {
      flatnos: targetFlatnos,
      last_deep_cleaning: dateValue,
      whatsappLogs
    }
  });
};

export const updateDeepCleaningInterval = async (req, res) => {
  const { flatno, interval } = req.body;

  req.log.info('update_deep_cleaning_interval_start', { flatno, interval });

  if (!flatno || !interval) {
    throw new ApiError(400, 'flatno and interval are required');
  }

  const intervalInt = parseInt(interval, 10);
  if (isNaN(intervalInt) || intervalInt <= 0) {
    throw new ApiError(400, 'interval must be a positive integer');
  }

  const flatExists = await FlatDb.findOne({ where: { flatno } });
  if (!flatExists) {
    throw new ApiError(404, `Flat number ${flatno} not found`);
  }

  await FlatDb.update(
    { deep_cleaning_interval: intervalInt, updatedBy: req.user?.username || 'ADMIN' },
    { where: { flatno } }
  );

  req.log.info('update_deep_cleaning_interval_success', { flatno, interval: intervalInt });

  return res.status(200).json({
    message: 'Cleaning interval updated successfully.',
    data: {
      flatno,
      deep_cleaning_interval: intervalInt
    }
  });
};

