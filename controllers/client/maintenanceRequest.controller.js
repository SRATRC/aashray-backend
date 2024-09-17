import {
  RoomBooking,
  MaintenanceDb,
  Departments
} from '../../models/associations.js';
import database from '../../config/database.js';
import { ROOM_STATUS_CHECKEDIN } from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';
import APIError from '../../utils/ApiError.js';
import sendMail from '../../utils/sendMail.js';

export const CreateRequest = CatchAsync(async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const isCheckedin = await RoomBooking.findOne({
    where: {
      cardno: req.user.cardno,
      status: ROOM_STATUS_CHECKEDIN
    }
  });
  if (!isCheckedin) {
    throw new APIError(400, 'You are not checked in');
  }

  const request = await MaintenanceDb.create(
    {
      requested_by: req.user.cardno,
      department: req.body.department,
      work_detail: req.body.work_detail,
      area_of_work: req.body.area_of_work || null,
      updatedBy: 'USER'
    },
    { transaction: t }
  );
  if (!request) {
    throw new APIError(400, 'Unable to create request');
  }

  const dept_email = await Departments.findOne({
    attributes: ['dept_email'],
    where: {
      dept_name: req.body.department
    },
    transaction: t
  });
  if (!dept_email) {
    throw new APIError(400, 'Department not found');
  }

  sendMail({
    email: req.user.email,
    cc: dept_email.dataValues.dept_email,
    subject: 'New Maintenance Request Received',
    template: 'maintainanceRequest',
    context: {
      name: req.user.issuedto,
      mobno: req.user.mobno,
      detail: req.body.work_detail,
      work: req.body.area_of_work
    }
  });

  await t.commit();

  return res.status(201).send({
    message: 'successfully created request'
  });
});

export const ViewRequest = CatchAsync(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;
  const offset = (page - 1) * pageSize;
  const status = req.query.status.toLowerCase() || 'all';

  const whereClause = {
    requested_by: req.user.cardno
  };

  if (status != 'all') {
    whereClause.status = status;
  }

  const data = await MaintenanceDb.findAll({
    where: whereClause,
    attributes: {
      exclude: ['id', 'createdAt', 'updatedAt', 'updatedBy']
    },
    order: [['createdAt', 'DESC']],
    offset,
    limit: pageSize
  });

  return res
    .status(200)
    .send({ message: 'fetched maintenance data', data: data });
});

export const FetchDepartments = CatchAsync(async (req, res) => {
  const departments = await Departments.findAll();
  return res
    .status(200)
    .send({ message: 'found departments', data: departments });
});
