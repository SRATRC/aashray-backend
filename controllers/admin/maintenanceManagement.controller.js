import {
  STATUS_INPROGRESS,
  STATUS_OPEN,
  STATUS_CLOSED
} from '../../config/constants.js';
import { QueryTypes } from 'sequelize';
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
      'status'
    ],
    where: { 
      department,
      status: [STATUS_OPEN, STATUS_INPROGRESS]
    },
    order: [['createdAt', 'ASC']]
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
