import { ShibirDb, ShibirBookingDb } from '../../models/associations.js';
import database from '../../config/database.js';
import Sequelize from 'sequelize';
import moment from 'moment';
import {
  STATUS_WAITING,
  STATUS_CONFIRMED,
  STATUS_CANCELLED
} from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';
import APIError from '../../utils/ApiError.js';
import sendMail from '../../utils/sendMail.js';

export const FetchAllShibir = CatchAsync(async (req, res) => {
  const today = moment().format('YYYY-MM-DD');

  const page = req.body.page || 1;
  const pageSize = req.body.page_size || 10;
  const offset = (page - 1) * pageSize;

  const shibirs = await ShibirDb.findAll({
    where: {
      start_date: {
        [Sequelize.Op.gt]: today
      }
    },
    offset,
    limit: pageSize,
    order: [['start_date', 'ASC']]
  });
  return res.status(200).send({ message: 'fetched results', data: shibirs });
});

export const RegisterShibir = CatchAsync(async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const isBooked = await ShibirBookingDb.findOne({
    where: {
      shibir_id: req.body.shibir_id,
      cardno: req.body.cardno,
      status: { [Sequelize.Op.in]: [STATUS_CONFIRMED, STATUS_WAITING] }
    }
  });

  if (isBooked) {
    throw new APIError(200, 'Shibir already booked');
  }

  const shibir = await ShibirDb.findOne({
    where: {
      id: req.body.shibir_id
    },
    transaction: t,
    lock: t.LOCK.UPDATE
  });
  if (!shibir) {
    throw new APIError(404, 'Shibir not found');
  }

  if (shibir.available_seats > 0) {
    shibir.available_seats -= 1;
    await shibir.save({ transaction: t });
    const booking = await ShibirBookingDb.create(
      {
        shibir_id: req.body.shibir_id,
        cardno: req.body.cardno,
        status: STATUS_CONFIRMED
      },
      { transaction: t }
    );
    if (!booking) {
      await t.rollback();
      throw new APIError(400, 'Shibir booking failed');
    }
  } else {
    const booking = await ShibirBookingDb.create(
      {
        shibir_id: req.body.shibir_id,
        cardno: req.body.cardno,
        status: STATUS_WAITING
      },
      { transaction: t }
    );
    if (!booking) {
      throw new APIError(400, 'Shibir booking failed');
    }
  }

  await t.commit();

  const message = `Dear ${req.user.issuedto},<br><br>

  We are pleased to confirm your booking for ".$shibir_name." adhyayan as per the following details:<br><br>
  
  Adhyayan name: ${shibir.dataValues.name}<br>
  Adhyayan start Date: ${shibir.dataValues.start_date}<br>
  Adhyayan end Date: ${shibir.dataValues.end_date}<br><br>

  You have to register for Raj sharan separately. <a href='http://datachef.in/sratrc/rajsharan/' target='_blank'>Click Here</a> to book your stay if not booked yet.<br>

  * Please note that the shibir committee has right to cancel your booking within 7 days if you do not qualify as per the shibir criteria.<br><br>

  <a href='http://datachef.in/sratrc/rajsharan/guidelines/rc_guidelines.pdf' target='_blank'>Please Click Here to Read</a> the guidelines for your stay at Research Centre
  We hope you have a spiritually blissful stay. <br><br>
  
  Research Centre Admin office, <br>
  7875432613 / 9004273512`;
  sendMail({
    email: req.user.email,
    subject: 'Shibir Booking Confirmation',
    message
  });

  return res.status(201).send({ message: 'Shibir booking successful' });
});

export const FetchBookedShibir = CatchAsync(async (req, res) => {
  const today = moment().format('YYYY-MM-DD');

  const shibirs = await ShibirDb.findAll({
    attributes: ['name', 'speaker', 'start_date', 'end_date'],
    include: [
      {
        model: ShibirBookingDb,
        attributes: ['status'],
        where: {
          cardno: req.params.cardno
        }
      }
    ],
    where: {
      start_date: {
        [Sequelize.Op.gt]: today
      }
    },
    order: [['start_date', 'ASC']]
  });

  return res.status(200).send({ message: 'fetched results', data: shibirs });
});

export const CancelShibir = CatchAsync(async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const isBooked = await ShibirBookingDb.findOne({
    where: {
      shibir_id: req.body.shibir_id,
      cardno: req.body.cardno,
      status: { [Sequelize.Op.in]: [STATUS_CONFIRMED, STATUS_WAITING] }
    }
  });

  if (!isBooked) {
    throw new APIError(404, 'Shibir booking not found');
  }

  isBooked.status = STATUS_CANCELLED;
  await isBooked.save({ transaction: t });

  const update_shibir = await ShibirDb.findOne({
    where: {
      id: req.body.shibir_id
    },
    transaction: t,
    lock: t.LOCK.UPDATE
  });

  if (
    update_shibir &&
    update_shibir.available_seats < update_shibir.total_seats
  ) {
    update_shibir.available_seats += 1;
    await update_shibir.save({ transaction: t });
  }

  await t.commit();

  const message = `Dear Mumukshu,<br><br>

  This is a confirmation email for Adhyayan cancellation. Your booking for shibir - <b>${update_shibir.dataValues.name}</b> is now cancelled.<br><br>
  
  Research Centre Admin office, <br>
  7875432613 / 9004273512`;
  sendMail({
    email: req.user.email,
    subject: 'Shibir Booking Cancellation',
    message
  });

  return res.status(200).send({ message: 'Shibir booking cancelled' });
});
