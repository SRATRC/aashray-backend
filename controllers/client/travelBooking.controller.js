import { TravelDb } from '../../models/associations.js';
import {
  STATUS_CONFIRMED,
  STATUS_WAITING,
  MSG_CANCEL_SUCCESSFUL
} from '../../config/constants.js';
import { userCancelBooking } from '../../helpers/transactions.helper.js';
import database from '../../config/database.js';
import Sequelize from 'sequelize';
import ApiError from '../../utils/ApiError.js';
import sendMail from '../../utils/sendMail.js';
import { updateWaitingTravelBooking } from '../../helpers/travelBooking.helper.js';
import { STATUS_AWAITING_CONFIRMATION } from '../../config/constants.js';

export const FetchUpcoming = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;
  const offset = (page - 1) * pageSize;

  const data = await database.query(
    `SELECT t1.bookingid,
       t1.cardno,
       t1.bookedBy,
       t3.issuedto AS user_name,
       t1.date,
       t1.pickup_point,
       t1.drop_point,
       t1.type,
       t1.luggage,
       t1.comments,
       t1.status,
       t2.amount,
       t2.status AS transaction_status
    FROM travel_db t1
    LEFT JOIN transactions t2 ON t1.bookingid = t2.bookingid
    LEFT JOIN card_db t3 ON t1.cardno = t3.cardno
    WHERE t1.cardno = :cardno
      OR t1.bookedBy = :cardno
    ORDER BY t1.date DESC
    LIMIT :limit
    OFFSET :offset;`,
    {
      replacements: {
        cardno: req.user.cardno,
        limit: pageSize,
        offset: offset
      },
      type: Sequelize.QueryTypes.SELECT
    }
  );

  return res.status(200).send({ message: 'Fetched data', data: data });
};

export const CancelTravel = async (req, res) => {
  const { bookingid } = req.body;

  const t = await database.transaction();
  req.transaction = t;

  const booking = await TravelDb.findOne({
    where: {
      bookingid: bookingid,
      status: [STATUS_AWAITING_CONFIRMATION, STATUS_CONFIRMED]
    }
  });

  if (!booking) {
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  await userCancelBooking(req.user, booking, t);
  await t.commit();

  sendMail({
    email: req.user.email,
    subject: 'Vitraag Vigyaan Aashray: Raj Pravas - Travel Booking Cancelled',
    template: 'rajPravasCancellation',
    context: {
      name: req.user.issuedto,
      bookingid: bookingid,
      date: booking.date,
      pickup: booking.pickup_point,
      drop: booking.drop_point
    }
  });
  //bring people from the waiting to awaiting confrimation.
  updateWaitingTravelBooking(booking.date);

  return res.status(200).send({ message: MSG_CANCEL_SUCCESSFUL });
};
