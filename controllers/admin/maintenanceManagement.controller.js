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

