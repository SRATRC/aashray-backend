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



export const fetchMaintenanceReport = async (req, res) => {
  const { department } = req.params;

  const requests = await MaintenanceDb.findAll({
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
  where: { 
    department,
    status: [STATUS_OPEN, STATUS_INPROGRESS, STATUS_CLOSED]
  },
  order: [
    [Sequelize.literal(`
      CASE 
        WHEN \`MaintenanceDb\`.\`status\` = '${STATUS_OPEN}' THEN 0
        WHEN \`MaintenanceDb\`.\`status\` = '${STATUS_INPROGRESS}' THEN 1
        WHEN \`MaintenanceDb\`.\`status\` = '${STATUS_CLOSED}' THEN 2
        ELSE 3
      END
    `), 'ASC'],
    ['createdAt', 'DESC']
  ]
});

  return res.status(200).send({
    message: 'Fetched requests for department',
    data: requests
  });
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
      const cleanPhone = String(phone).replace(/\D/g, '');
      const formattedPhone = cleanPhone.startsWith('91')
        ? cleanPhone
        : `91${cleanPhone}`;

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

