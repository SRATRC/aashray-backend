import {
  TravelDb,
  TravelBookingTransaction,
  CardDb
} from '../../models/associations.js';
import database from '../../config/database.js';
import Sequelize from 'sequelize';
import sendMail from '../../utils/sendMail.js';
import moment from 'moment';
import ApiError from '../../utils/ApiError.js';
import {
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

  const page = req.body.page || 1;
  const pageSize = req.body.page_size || 10;
  const offset = (page - 1) * pageSize;

  const data = await TravelDb.findAll({
    include: [
      {
        model: CardDb
      }
    ],
    where: {
      date: {
        [Sequelize.Op.gt]: today
      },
      status: {
        [Sequelize.Op.notIn]: [STATUS_CANCELLED, STATUS_ADMIN_CANCELLED]
      }
    },
    offset,
    limit: pageSize,
    order: [['date', 'ASC']]
  });
  return res.status(200).send({ message: 'Fetched data', data: data });
};

export const updateBookingStatus = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const passanger = await TravelDb.findOne({
    include: [
      {
        model: CardDb
      }
    ],
    where: {
      bookingid: req.body.bookingid
    },
    transaction: t
  });

  if (!passanger) {
    throw new ApiError(404, 'invalid bookingid');
  }

  if (
    passanger.dataValues.status === STATUS_WAITING &&
    req.body.status === STATUS_CONFIRMED
  ) {
    await TravelBookingTransaction.create(
      {
        cardno: passanger.dataValues.cardno,
        bookingid: passanger.dataValues.bookingid,
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
        cardno: passanger.dataValues.cardno,
        bookingid: passanger.dataValues.bookingid,
        type: TYPE_EXPENSE
      }
    });

    if (
      passanger.status === STATUS_CONFIRMED &&
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
          cardno: passanger.dataValues.cardno,
          bookingid: passanger.dataValues.bookingid,
          type: TYPE_REFUND,
          amount: travelBookingTransaction.dataValues.amount,
          status: STATUS_AWAITING_REFUND,
          updatedBy: req.user.username
        },
        { transaction: t }
      );
    } else if (
      passanger.status === STATUS_ADMIN_CANCELLED ||
      passanger.status === STATUS_CANCELLED
    ) {
      throw new ApiError(400, 'cannot modify cancelled booking');
    }
  }

  await passanger.update(
    {
      status: req.body.status
    },
    { transaction: t }
  );

  await t.commit();

  sendMail({
    email: passanger.dataValues.CardDb.email,
    subject: 'Status changed for your Raj Pravas Booking',
    template: 'rajPravasStatusUpdate',
    context: {
      name: passanger.dataValues.CardDb.issuedto,
      bookingid: passanger.dataValues.bookingid,
      date: passanger.dataValues.date,
      pickup: passanger.dataValues.pickup_point,
      drop: passanger.dataValues.drop_point,
      status: req.body.status
    }
  });

  return res
    .status(200)
    .send({ message: 'Successfully updated booking status' });
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
  return res.status(200).send({ message: 'Successfully updated transaction' });
};
