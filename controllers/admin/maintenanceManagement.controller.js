import {
  STATUS_INPROGRESS,
  STATUS_OPEN,
  STATUS_CLOSED
} from '../../config/constants.js';
import { QueryTypes,Sequelize } from 'sequelize';
import database from '../../config/database.js';
// import Sequelize, { QueryTypes } from 'sequelize';
import moment from 'moment';
import ApiError from '../../utils/ApiError.js';

import {
  CardDb,
  MaintenanceDb
} from '../../models/associations.js';
import { sendWhatsAppMessage } from '../../utils/sendWhatsAppMessage.js';
import { formatWhatsAppPhone } from '../../utils/phoneFormatter.js';



export const fetchMaintenanceReport = async (req, res) => {
  const { department } = req.params;
  const page = req.query.page ? parseInt(req.query.page, 10) : null;
  const pageSize = req.query.page_size ? parseInt(req.query.page_size, 10) : 20;
  const search = req.query.search || '';
  const sortBy = req.query.sort_by || 'priority';
  const sortOrder = req.query.sort_order || 'ASC';
  const statusFilter = req.query.status || '';

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
    open: 0,
    'in progress': 0,
    closed: 0
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
      data: requests,
      statusCounts
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

