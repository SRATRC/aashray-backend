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
    where: { department },
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
    ]
  });

  return res.status(200).send({
    message: 'Fetched requests for department',
    data: requests
  });
};

// export const getMaintenanceById = async (req, res) => {
//   const {bookingid} = req.params;

//   const request = await Maintenance.findOne({
//     where: { bookingid },
//     include: [{ model: Card, as: 'card', attributes: ['issuedto'] }]
//   });

//   if (!request) return res.status(404).send({ message: 'Not found' });

//   return res.status(200).send({ data: request });
// };


// export const updateMaintenanceStatus = async (req, res) => {
//   const { id } = req.params;
//   const { status } = req.body;

//   const request = await Maintenance.findOne({ where: { bookingid: id } });

//   if (!request) return res.status(404).send({ message: 'Not found' });

//   request.status = status;
//   await request.save();

//   return res.status(200).send({ message: 'Status updated successfully', data: request });
// };


// export const updateMaintenanceRequest = async (req, res) => {
//   const { bookingid } = req.params;
//   const { status, comments } = req.body;

//   try {
//     const request = await Maintenance.findOne({ where: { bookingid: String(bookingid).trim() } });
//     if (!request) {
//       return res.status(404).send({ message: 'Maintenance request not found' });
//     }

//     request.status = status;
//     request.comments = comments;
//     await request.save();

//     return res.status(200).send({
//       message: 'Request updated',
//       updatedAt: new Date().toISOString()
//     });
//   } catch (err) {
//     return res.status(500).send({ message: 'Update failed', error: err.message });
//   }
// };


export const updateMaintenanceRequest = async (req, res) => {
  try {
    const { bookingid, issuedto, department, comments, status } = req.body;

    if (!bookingid) {
      return res.status(400).json({ message: 'Booking ID is required.' });
    }

    const maintenance = await MaintenanceDb.findOne({ where: { bookingid } });

    if (!maintenance) {
      return res.status(404).json({ message: 'Maintenance request not found.' });
    }

    // Update fields if provided
    maintenance.issuedto = issuedto || maintenance.issuedto;
    maintenance.department = department || maintenance.department;
    maintenance.comments = comments || maintenance.comments;
    maintenance.status = status || maintenance.status;

    await maintenance.save();

    return res.status(200).json({
      message: 'Maintenance request updated successfully.',
      data: maintenance
    });

  } catch (error) {
    console.error('Error updating maintenance request:', error);
    return res.status(500).json({
      message: 'An error occurred while updating the request.',
      error: error.message
    });
  }
};
