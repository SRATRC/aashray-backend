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

  const maintenance = await MaintenanceDb.findOne({ where: { bookingid } });

  if (!maintenance) {
    return res.status(404).json({ message: 'Maintenance request not found.' });
  }

  // Update fields if provided
  // maintenance.issuedto = issuedto || maintenance.issuedto;
  // maintenance.department = department || maintenance.department;
  maintenance.comments = comments || maintenance.comments;
  maintenance.status = status || maintenance.status;

  await maintenance.save();

  return res.status(200).json({
    message: 'Maintenance request updated successfully.',
    data: maintenance
  });
}


export const fetchAllSupportTickets = async (req, res) => {
  try {
    const tickets = await database.query(
      `SELECT 
        st.id,
        st.issued_by,
        st.service,
        st.issue,
        st.createdAt,
        cb.issuedto,
        cb.mobno,
        cb.gender,
        cb.dob,
        cb.center,
        cb.res_status
      FROM 
        support_tickets st
      LEFT JOIN 
        card_db cb ON st.issued_by = cb.cardno
      ORDER BY 
        st.createdAt DESC;`,
      {
        type: QueryTypes.SELECT
      }
    );

    return res
      .status(200)
      .send({ message: 'Fetched Support Tickets', data: tickets });
  } catch (error) {
    console.error('Error fetching support tickets:', error);
    return res
      .status(500)
      .send({ message: 'Failed to fetch support tickets', error });
  }
};
