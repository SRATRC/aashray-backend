import {
  TravelDb,
  CardDb,
  Transactions
} from '../../models/associations.js';
import database from '../../config/database.js';
import Sequelize, { Transaction } from 'sequelize';
import sendMail from '../../utils/sendMail.js';
import moment from 'moment';
import ApiError from '../../utils/ApiError.js';
import {
  ERR_BOOKING_ALREADY_CANCELLED,
  ERR_BOOKING_NOT_FOUND,
  ERR_TRANSACTION_NOT_FOUND,
  FULL_TRAVEL_PRICE,
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
  TRAVEL_TYPE_FULL,
  TYPE_EXPENSE,
  TYPE_REFUND,
  TYPE_TRAVEL
} from '../../config/constants.js';
import { adminCancelTransaction, createPendingTransaction } from '../../helpers/transactions.helper.js';
import { travelCharge } from '../../helpers/travelBooking.helper.js';

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
// TODO: Confirm with Harshit on valid statuses
export const updateBookingStatus = async (req, res) => {
  const { bookingid, status } = req.body;

  var newBookingStatus = status;

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
    case STATUS_PAYMENT_PENDING:
      if (!transaction) {
        transaction = await createPendingTransaction(
          booking.cardno,
          booking,
          TYPE_TRAVEL,
          travelCharge(booking.type),
          req.user.username,
          t
        );
      }
      
      // After applying credits, if the transaction is complete
      // then confirm the booking.
      if (transaction.status == STATUS_PAYMENT_COMPLETED) {
        newBookingStatus = STATUS_CONFIRMED;
      }
      break;

    case STATUS_ADMIN_CANCELLED:
      if (transaction) {
        await adminCancelTransaction(req.user, transaction, t);
      }
      break;

    case STATUS_CONFIRMED:
    default:
      throw new ApiError(400, 'Invalid status provided');
  }

  await booking.update(
    {
      status: newBookingStatus,
      updatedBy: req.user.username
    },
    { transaction: t }
  );

  const card = CardDb.findOne(
    { where: { cardno: booking.cardno } }
  );

  // TODO: fix email template
  sendMail({
    email: card.email,
    subject: 'Status changed for your Raj Pravas Booking',
    template: 'rajPravasStatusUpdate',
    context: {
      name: card.issuedto,
      bookingid: booking.bookingid,
      date: booking.date,
      pickup: booking.pickup_point,
      drop: booking.drop_point,
      status: newBookingStatus
    }
  });

  await t.commit();
  return res
    .status(200)
    .send({ message: MSG_UPDATE_SUCCESSFUL });
};

// TODO: Deprecate? where is this used?
export const updateTransactionStatus = async (req, res) => {
  const { cardno, bookingid, type } = req.body;

  const t = await database.transaction();
  req.transaction = t;

  const transaction = await Transactions.findOne({
    where: {
      cardno,
      bookingid,
      type
    }
  });

  if (!transaction) {
    throw new ApiError(404, ERR_TRANSACTION_NOT_FOUND);
  }

  await adminCancelTransaction(req.user, transaction, t);

  await t.commit();
  return res.status(200).send({ message: MSG_UPDATE_SUCCESSFUL });
};
