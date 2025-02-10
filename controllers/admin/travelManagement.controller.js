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
  ERR_BOOKING_ALREADY_CANCELLED,
  ERR_BOOKING_NOT_FOUND,
  MSG_UPDATE_SUCCESSFUL,
  STATUS_ADMIN_CANCELLED,
  STATUS_AWAITING_REFUND,
  STATUS_CANCELLED,
  STATUS_CASH_COMPLETED,
  STATUS_CONFIRMED,
  STATUS_PAYMENT_COMPLETED,
  STATUS_PAYMENT_PENDING,
  STATUS_WAITING,
  TRAVEL_PRICE,
  TYPE_EXPENSE,
  TYPE_REFUND,
  TYPE_TRAVEL
} from '../../config/constants.js';
import { adminCancelTransaction, createPendingTransaction } from '../../helpers/transactions.helper.js';

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

// valid statuses:
// 1. waiting to payment pending
// 2. waiting to admin cancelled
// 3. confirmed to admin cancelled
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

  if (
    booking.status == STATUS_ADMIN_CANCELLED ||
    booking.status == STATUS_CANCELLED
  ) {
    throw new ApiError(400, ERR_BOOKING_ALREADY_CANCELLED);
  }

  var transaction = await Transactions.findOne({
    where: { bookingid: bookingid }
  });

  switch(status) {
    case STATUS_CONFIRMED:
    // Transaction must be payment completed at this point
    // because Virag Bhai only confirms once the payment is made
      // if (!transaction) {
      //   transaction = await createPendingTransaction(
      //     booking.cardno,
      //     bookingid,
      //     TYPE_TRAVEL,
      //     TRAVEL_PRICE,
      //     req.user.username,
      //     t
      //   );
      // }

    // await useCredit(
    //   transaction.cardno,
    //   booking,
    //   transaction,
    //   TRAVEL_PRICE,
    //   req.user.username,
    //   t
    // );

    // // After applying credits, if the status is still payment pending
    // // then accept the UPI or cash payment and mark is complete.
    // if (transaction.status == STATUS_PAYMENT_PENDING) {
    //   await transaction.update(
    //     {
    //       upi_ref: upi_ref || 'NA',
    //       status: upi_ref ? STATUS_PAYMENT_COMPLETED : STATUS_CASH_COMPLETED,
    //       updatedBy: req.user.username
    //     },
    //     { transaction: t }
    //   );
    // }
    
    break;

    case STATUS_ADMIN_CANCELLED:
      if (transaction) {
        await adminCancelTransaction(req.user, transaction, t);
      }
      break;

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
