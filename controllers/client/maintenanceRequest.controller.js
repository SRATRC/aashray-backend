import {
  RoomBooking,
  MaintenanceDb,
  Departments
} from '../../models/associations.js';
import {
  ROOM_STATUS_CHECKEDIN,
  STATUS_RESIDENT,
  STATUS_SEVA_KUTIR
} from '../../config/constants.js';
import { v4 as uuidv4 } from 'uuid';
import { attachUserContext } from '../../middleware/Logger.js';
import database from '../../config/database.js';
import CatchAsync from '../../utils/CatchAsync.js';
import APIError from '../../utils/ApiError.js';
import sendMail from '../../utils/sendMail.js';
import { sendWhatsAppMessage } from '../../utils/sendWhatsAppMessage.js';


export const CreateRequest = CatchAsync(async (req, res) => {
  attachUserContext(req);
  req.log.info('create_maintenance_request_start', {
    cardno: req.user.cardno,
    department: req.body.department,
    resStatus: req.user.res_status
  });

  const t = await database.transaction();
  req.transaction = t;

  if (![STATUS_RESIDENT, STATUS_SEVA_KUTIR].includes(req.user.res_status)) {
    const isCheckedin = await RoomBooking.findOne({
      where: {
        cardno: req.user.cardno,
        status: ROOM_STATUS_CHECKEDIN
      }
    });

    if (!isCheckedin) {
      req.log.warn('create_maintenance_request_not_checked_in', { cardno: req.user.cardno, resStatus: req.user.res_status });
      throw new APIError(400, 'You are not checked in');
    }
  }

  const request = await MaintenanceDb.create(
    {
      bookingid: uuidv4(),
      requested_by: req.user.cardno,
      department: req.body.department,
      work_detail: req.body.work_detail,
      area_of_work: req.body.area_of_work || null,
      updatedBy: 'USER'
    },
    { transaction: t }
  );
  if (!request) {
    req.log.error('create_maintenance_request_db_failed', { cardno: req.user.cardno });
    throw new APIError(400, 'Unable to create request');
  }

  req.log.info('create_maintenance_request_created', {
    cardno: req.user.cardno,
    requestId: request.bookingid,
    department: req.body.department
  });

  const dept_email = await Departments.findOne({
    attributes: ['dept_email'],
    where: {
      dept_name: req.body.department
    },
    transaction: t
  });
  if (!dept_email) {
    req.log.error('create_maintenance_request_dept_not_found', { cardno: req.user.cardno, department: req.body.department });
    throw new APIError(400, 'Department not found');
  }

  sendMail({
    email: req.user.email,
    cc: dept_email.dataValues.dept_email,
    subject: 'Vitraag Vigyaan Aashray: Maintenance Request Received',
    template: 'maintainanceRequest',
    context: {
      name: req.user.issuedto,
      mobno: req.user.mobno,
      detail: req.body.work_detail,
      work: req.body.area_of_work
    }
  });

  await t.commit();
  req.log.info('create_maintenance_request_success', {
    cardno: req.user.cardno,
    requestId: request.bookingid,
    department: req.body.department
  });

  const phone = req.user.mobno;
  if (phone) {
    try {
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
              text: req.user.issuedto || 'Mumukshu'
            },
            {
              type: 'text',
              text: req.body.department || ' '
            },
            {
              type: 'text',
              text: req.body.area_of_work || ' '
            },
            {
              type: 'text',
              text: req.body.work_detail || ' '
            }
          ]
        }
      ];

      await sendWhatsAppMessage(formattedPhone, 'maintenance_request_received', components);
    } catch (err) {
      console.error('Error sending WhatsApp message in CreateRequest:', err.message || err);
    }
  }

  return res.status(201).send({
    message: 'successfully created request'
  });
});


export const ViewRequest = CatchAsync(async (req, res) => {
  attachUserContext(req);
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;
  const offset = (page - 1) * pageSize;
  const status = req.query.status?.toLowerCase() || 'all';
  req.log.info('view_maintenance_requests_start', { cardno: req.user.cardno, status, page, pageSize });

  const whereClause = {
    requested_by: req.user.cardno
  };

  if (status != 'all') {
    whereClause.status = status;
  }

  const data = await MaintenanceDb.findAll({
    where: whereClause,
    attributes: {
      exclude: ['updatedAt', 'updatedBy']
    },
    order: [['createdAt', 'DESC']],
    offset,
    limit: pageSize
  });

  req.log.info('view_maintenance_requests_success', { cardno: req.user.cardno, count: data.length });
  return res
    .status(200)
    .send({ message: 'fetched maintenance data', data: data });
});

export const FetchDepartments = CatchAsync(async (req, res) => {
  req.log.info('fetch_departments_start');
  const departments = await Departments.findAll();
  req.log.info('fetch_departments_success', { count: departments.length });
  return res
    .status(200)
    .send({ message: 'found departments', data: departments });
});
