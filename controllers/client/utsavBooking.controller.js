import database from '../../config/database.js';
import Sequelize from 'sequelize';
import moment from 'moment';
import {
  STATUS_WAITING,
  STATUS_CONFIRMED,
  STATUS_CANCELLED
} from '../../config/constants.js';
import APIError from '../../utils/ApiError.js';
import SendMail from '../../utils/sendMail.js';
import UtsavDb from '../../models/utsav_db.model.js';
import UtsavBooking from '../../models/utsav_boking.model.js';
import ApiError from '../../utils/ApiError.js';

export const FetchUpcoming = async (req, res) => {
  const utsav_bookings = await UtsavDb.findAll({
    where: {
      start_date: {
        [Sequelize.Op.gte]: moment().format('YYYY-MM-DD')
      }
    }
  });
  return res
    .status(200)
    .send({ message: 'Fetched data', data: utsav_bookings });
};

export const BookUtsav = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const isBooked = await UtsavBooking.findOne({
    where: {
      cardno: req.body.cardno,
      utsavid: req.body.utsavid
    }
  });
  if (isBooked) {
    throw new ApiError(200, 'Already booked');
  }

  const utsav_booking = await UtsavBooking.create({
    cardno: req.user.cardno,
    utsavid: req.body.utsavid,
    status: STATUS_WAITING
  });
};

export const BookGuestUtsav = async (req, res) => {};

export const ViewUtsavBookings = async (req, res) => {};

export const CancelUtsavBooking = async (req, res) => {};
