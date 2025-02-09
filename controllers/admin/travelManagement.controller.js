import {
  TravelDb,
  TravelBookingTransaction,
  CardDb,
  Transactions
} from '../../models/associations.js';
import database from '../../config/database.js';
import Sequelize from 'sequelize';
import sendMail from '../../utils/sendMail.js';
import moment from 'moment';
import ApiError from '../../utils/ApiError.js';
import {
  ERR_BOOKING_NOT_FOUND,
  MSG_UPDATE_SUCCESSFUL,
  STATUS_ADMIN_CANCELLED,
  STATUS_AWAITING_REFUND,
  STATUS_CANCELLED,
  STATUS_CONFIRMED,
  STATUS_PAYMENT_COMPLETED,
  STATUS_PAYMENT_PENDING,
  STATUS_WAITING,
  TRAVEL_PRICE,
  TYPE_EXPENSE,
  TYPE_REFUND
} from '../../config/constants.js';

//TODO: send mail

export const fetchUpcomingBookings = async (req, res) => {
  const today = moment().format('YYYY-MM-DD');

  const page = parseInt(req.query.page) || req.body.page || 1;
  const pageSize = parseInt(req.query.page_size) || req.body.page_size || 10;
  const offset = (page - 1) * pageSize;

  // TODO: add guest info
  const data = await TravelDb.findAll({
    include: [{
      model: CardDb
    }],
    where: {
      date: {
        [Sequelize.Op.gt]: today
      },
      status: {
        [Sequelize.Op.notIn]: [
          STATUS_CANCELLED, 
          STATUS_ADMIN_CANCELLED
        ]
      }
    },
    offset,
    limit: pageSize,
    order: [['date', 'ASC']]
  });

  return res.status(200).send({ message: 'Fetched data', data: data });
};

export const updateBookingStatus = async (req, res) => {
  const { bookingid, status } = req.body;

  const t = await database.transaction();
  req.transaction = t;

  const booking = await TravelDb.findOne({
    where: {
      bookingid: bookingid,
      status: [
        STATUS_WAITING,
        STATUS_CONFIRMED
      ]
    }
  });

  if (!booking) {
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  if (status == booking.status) {
    throw new ApiError(400, 'Status is same as before');
  }

  var transaction = await Transactions.findOne({
    where: { bookingid: bookingid }
  });

  switch(status) {
    case STATUS_CONFIRMED:
    

    case STATUS_ADMIN_CANCELLED:


  }

  if (
    booking.status === STATUS_WAITING &&
    req.body.status === STATUS_CONFIRMED
  ) {
    await TravelBookingTransaction.create(
      {
        cardno: booking.dataValues.cardno,
        bookingid: booking.dataValues.bookingid,
        type: TYPE_EXPENSE,
        amount: TRAVEL_PRICE,
        status: STATUS_PAYMENT_PENDING,
        updatedBy: req.user.username
      },
      { transaction: t }
    );
  } else {
    const travelBookingTransaction = await TravelBookingTransaction.findOne({
      where: {
        cardno: booking.dataValues.cardno,
        bookingid: booking.dataValues.bookingid,
        type: TYPE_EXPENSE
      }
    });

    if (
      booking.status === STATUS_CONFIRMED &&
      req.body.status === STATUS_ADMIN_CANCELLED
    ) {
      await travelBookingTransaction.update(
        {
          status: req.body.status,
          updatedBy: req.user.username
        },
        { transaction: t }
      );

      await TravelBookingTransaction.create(
        {
          cardno: booking.dataValues.cardno,
          bookingid: booking.dataValues.bookingid,
          type: TYPE_REFUND,
          amount: travelBookingTransaction.dataValues.amount,
          status: STATUS_AWAITING_REFUND,
          updatedBy: req.user.username
        },
        { transaction: t }
      );
    } else if (
      booking.status === STATUS_ADMIN_CANCELLED ||
      booking.status === STATUS_CANCELLED
    ) {
      throw new ApiError(400, 'cannot modify cancelled booking');
    }
  }

  await booking.update(
    {
      status: req.body.status
    },
    { transaction: t }
  );

  await t.commit();

  sendMail({
    email: booking.dataValues.CardDb.email,
    subject: 'Status changed for your Raj Pravas Booking',

    // TODO: fix email template
    template: 'rajPravasStatusUpdate',
    context: {
      name: booking.dataValues.CardDb.issuedto,
      bookingid: booking.dataValues.bookingid,
      date: booking.dataValues.date,
      pickup: booking.dataValues.pickup_point,
      drop: booking.dataValues.drop_point,
      status: req.body.status
    }
  });

  return res
    .status(200)
    .send({ message: MSG_UPDATE_SUCCESSFUL });
};

export const updateTransactionStatus = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const travelBookingTransaction = await TravelBookingTransaction.findOne({
    where: {
      cardno: req.body.cardno,
      bookingid: req.body.bookingid,
      type: req.body.type
    }
  });

  if (!travelBookingTransaction) {
    throw new ApiError(404, 'invalid bookingid');
  }

  if (
    travelBookingTransaction.dataValues.status === STATUS_PAYMENT_COMPLETED &&
    req.body.status === STATUS_ADMIN_CANCELLED
  ) {
    await TravelBookingTransaction.create(
      {
        cardno: travelBookingTransaction.dataValues.cardno,
        bookingid: travelBookingTransaction.dataValues.bookingid,
        type: TYPE_REFUND,
        amount: travelBookingTransaction.dataValues.amount,
        status: STATUS_AWAITING_REFUND,
        updatedBy: req.user.username
      },
      { transaction: t }
    );
  } else if (
    travelBookingTransaction.dataValues.status === STATUS_CANCELLED ||
    travelBookingTransaction.dataValues.status === STATUS_ADMIN_CANCELLED
  ) {
    throw new ApiError(400, 'cannot modify cancelled transaction');
  }

  await travelBookingTransaction.update(
    {
      status: req.body.status,
      updatedBy: req.user.username
    },
    { transaction: t }
  );

  await t.commit();
  return res.status(200).send({ message: MSG_UPDATE_SUCCESSFUL });
};
