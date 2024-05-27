import {
  TravelDb,
  TravelBookingTransaction
} from '../../models/associations.js';
import database from '../../config/database.js';
import Sequelize from 'sequelize';
import sendMail from '../../utils/sendMail.js';
import {
  STATUS_CONFIRMED,
  STATUS_WAITING,
  TRAVEL_PRICE,
  STATUS_CANCELLED,
  STATUS_PAYMENT_PENDING,
  STATUS_PAYMENT_COMPLETED,
  TYPE_EXPENSE
} from '../../config/constants.js';
import moment from 'moment';
import { v4 as uuidv4 } from 'uuid';
import ApiError from '../../utils/ApiError.js';

// TODO: will add the transaction when the status is updated to confirmed
export const BookTravel = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const today = moment().format('YYYY-MM-DD');
  if (req.body.date < today) {
    throw new ApiError(400, 'Invalid Date');
  }

  const isBooked = await TravelDb.findOne({
    where: {
      cardno: req.body.cardno,
      status: { [Sequelize.Op.in]: [STATUS_CONFIRMED, STATUS_WAITING] },
      date: req.body.date
    }
  });
  if (isBooked) {
    throw new ApiError(400, 'Already booked on the selected date');
  }

  const booking = await TravelDb.create(
    {
      cardno: req.user.cardno,
      date: req.body.date,
      pickup_point: req.body.pickup_point,
      drop_point: req.body.drop_point,
      luggage: req.body.luggage,
      comments: req.body.comments,
      bookingid: uuidv4()
    },
    { transaction: t }
  );

  // const bookingTransaction = await TravelBookingTransaction.create(
  //   {
  //     cardno: req.user.cardno,
  //     bookingid: booking.dataValues.bookingid,
  //     type: TYPE_EXPENSE,
  //     amount: TRAVEL_PRICE,
  //     status: STATUS_PAYMENT_PENDING
  //   },
  //   { transaction: t }
  // );

  // if (booking == undefined || bookingTransaction == undefined) {
  //   throw new ApiError(500, 'Failed to book travel');
  // }

  sendMail({
    email: req.user.email,
    subject: 'Your Booking for RajPravas',
    template: 'rajPravas',
    context: {
      name: req.user.issuedto,
      bookingid: booking.dataValues.bookingid,
      date: req.body.date,
      pickup: req.body.pickup_point,
      dropoff: req.body.drop_point
    }
  });

  await t.commit();

  return res.status(200).send({ message: 'travel booked' });
};

export const FetchUpcoming = async (req, res) => {
  const today = moment().format('YYYY-MM-DD');
  const upcoming = await TravelDb.findAll({
    where: {
      cardno: req.params.cardno,
      date: { [Sequelize.Op.gt]: today }
    }
  });
  return res.status(200).send({ message: 'Fetched data', data: upcoming });
};

export const CancelTravel = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  await TravelDb.update(
    {
      status: STATUS_CANCELLED
    },
    {
      where: {
        cardno: req.body.cardno,
        bookingid: req.body.bookingid
      },
      transaction: t
    }
  );

  const travelBookingTransaction = await TravelBookingTransaction.findOne({
    where: {
      cardno: req.user.cardno,
      bookingid: req.body.bookingid,
      type: TYPE_EXPENSE,
      status: {
        [Sequelize.Op.in]: [STATUS_PAYMENT_PENDING, STATUS_PAYMENT_COMPLETED]
      }
    }
  });

  if (travelBookingTransaction) {
    if (travelBookingTransaction.status == STATUS_PAYMENT_PENDING) {
      travelBookingTransaction.status = STATUS_CANCELLED;
      await travelBookingTransaction.save({ transaction: t });
    } else if (travelBookingTransaction.status == STATUS_PAYMENT_PENDING) {
      travelBookingTransaction.status = STATUS_AWAITING_REFUND;
      await travelBookingTransaction.save({ transaction: t });
    }
  }

  await t.commit();

  return res.status(200).send({ message: 'Successfully cancelled booking' });
};

export const ViewAllTravel = async (req, res) => {
  const data = await TravelDb.findAll({
    where: {
      cardno: req.params.cardno
    },
    order: [['date', 'ASC']]
  });
  return res.status(200).send({ message: 'Fetched data', data: data });
};
