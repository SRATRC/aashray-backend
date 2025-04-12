import {
  STATUS_INPROGRESS,
  STATUS_OPEN,
  STATUS_CLOSED
} from '../../config/constants.js';
import { QueryTypes } from 'sequelize';
import database from '../../config/database.js';
import Sequelize, { QueryTypes } from 'sequelize';
import moment from 'moment';
import ApiError from '../../utils/ApiError.js';
import Transactions from '../../models/transactions.model.js';


import { Maintenance } from '../../models/maintenance_db.js';
import { Card } from '../../models/card.js';

export const fetchMaintenanceReport = async (req, res) => {
  const { department } = req.params;

  const requests = await Maintenance.findAll({
    where: { department },
    include: [
      {
        model: Card,
        as: 'card', // must match association alias
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

export const getMaintenanceById = async (req, res) => {
  const { id } = req.params;

  const request = await Maintenance.findOne({
    where: { bookingid: id },
    include: [{ model: Card, as: 'card', attributes: ['issuedto'] }]
  });

  if (!request) return res.status(404).send({ message: 'Not found' });

  return res.status(200).send({ data: request });
};


export const updateMaintenanceStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const request = await Maintenance.findOne({ where: { bookingid: id } });

  if (!request) return res.status(404).send({ message: 'Not found' });

  request.status = status;
  await request.save();

  return res.status(200).send({ message: 'Status updated successfully', data: request });
};
