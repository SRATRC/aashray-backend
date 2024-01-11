import {
  RoomBooking,
  MaintenanceDb,
  Departments
} from '../../models/associations.js';
import database from '../../config/database.js';
import { ROOM_STATUS_CHECKEDIN } from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';
import APIError from '../../utils/ApiError.js';
import SendMail from '../../utils/sendMail.js';

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
      area_of_work: req.body.area_of_work || null
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

  const message = `Dear ${req.user.issuedto},<br><br>

  Jai Sadguru Dev Vandan! We have received your request for maintenance as per following details:<br><br>

  Requestor phone number: ${req.user.mobno}<br>
  Request detail:<br><br> ${req.body.work_detail}<br>
  Place of work: ${req.body.area_of_work}<br><br>
  
  We will review your request and update the status on the portal. <br><br>
  
  Regards,<br>
  Mainenance department,`;

  SendMail({
    email: req.user.email,
    cc: dept_email.dataValues.dept_email,
    subject: `Your Booking Confirmation for Stay at SRATRC`,
    message
  });

  return res.status(201).send({
    message: 'successfully created request',
    data: request
  });
});

export const ViewRequest = CatchAsync(async (req, res) => {
  const page = req.body.page || 1;
  const pageSize = req.body.page_size || 10;
  const offset = (page - 1) * pageSize;

  const data = await MaintenanceDb.findAll({
    where: {
      requested_by: req.user.cardno
    },
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
