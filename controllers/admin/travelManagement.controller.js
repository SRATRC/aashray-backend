import { TravelDb, CardDb, Transactions } from '../../models/associations.js';
import database from '../../config/database.js';
import Sequelize, { Transaction } from 'sequelize';
import sendMail from '../../utils/sendMail.js';
import moment from 'moment';
import ApiError from '../../utils/ApiError.js';
import {
  ERR_BOOKING_ALREADY_CANCELLED,
  ERR_BOOKING_NOT_FOUND,
  ERR_TRANSACTION_NOT_FOUND,
  MSG_UPDATE_SUCCESSFUL,
  STATUS_ADMIN_CANCELLED,
  STATUS_CANCELLED,
  STATUS_CONFIRMED,
  STATUS_PAYMENT_COMPLETED,
  STATUS_PAYMENT_PENDING,
  STATUS_WAITING,
  TYPE_TRAVEL,
  STATUS_CASH_COMPLETED
} from '../../config/constants.js';
import {
  adminCancelTransaction,
  createPendingTransaction
} from '../../helpers/transactions.helper.js';
import { travelCharge } from '../../helpers/travelBooking.helper.js';


function getAdditionalConditions(statuses, pickup,replacementMap) {
  let additionalWhereClause="";
  if (statuses && Array.isArray(statuses) && statuses.length != 0) {
    additionalWhereClause = "AND t1.status in (:status)";
    console.log(replacementMap);
    replacementMap.status=statuses;
  }
  if (pickup && pickup.trim() != '') {
    additionalWhereClause += " AND pickup_point = :pickup";
    replacementMap.pickup=pickup;
  }
  return additionalWhereClause;
}

export const fectchSummary = async (req, res) => {
  const { start_date, end_date, statuses,pickup } = req.query;
  const replacementMap = {
    startDate : start_date,
    endDate : end_date, 
  };

  let additionalWhereClause=getAdditionalConditions(statuses, pickup,replacementMap);
  
  const data = await database.query(`SELECT t1.status,count(*) as count
  from travel_db t1
  WHERE date >= :startDate AND date <= :endDate ${additionalWhereClause} 
  group by t1.status ` , {
  replacements: replacementMap,
  type: Sequelize.QueryTypes.SELECT
}); 
  return res.status(200).send({ message: 'Fetched data', data: data });
};

export const fetchUpcomingBookings = async (req, res) => {
  
  const { start_date, end_date, statuses,pickup } = req.query;
  
  const replacementMap = {
    startDate : start_date,
    endDate : end_date, 
    category: TYPE_TRAVEL
  };

  let additionalWhereClause=getAdditionalConditions(statuses, pickup,replacementMap);
  const data = await database.query(
    `SELECT t1.bookingid, t1.bookedBy, t1.date, t1.pickup_point, t1.drop_point, t1.type, t1.luggage, 
    t1.comments, t1.admin_comments, t1.status, t3.issuedto, t3.mobno, t3.center, t2.amount, t2.upi_ref, t2.status as paymentStatus,t3.res_status
    FROM travel_db t1
    LEFT JOIN transactions t2 ON t2.bookingid = t1.bookingId AND t2.category = :category
    LEFT JOIN card_db t3 ON t1.cardno = t3.cardno
    WHERE  t1.date >= :startDate AND t1.date <= :endDate  ${additionalWhereClause}
    ORDER BY date ASC;`,
    {
      replacements: replacementMap,
      type: Sequelize.QueryTypes.SELECT
    }
  );
  return res.status(200).send({ message: 'Fetched data', data: data });
};

// valid statuses:
// 1. waiting to payment pending
// 2. waiting to admin cancelled
// 3. confirmed to admin cancelled
// TODO: Confirm with Harshit on valid statuses
export const updateBookingStatus = async (req, res) => {
  const { bookingid, status,adminComments,upiRef,description } = req.body;
  var newBookingStatus = status;

  const t = await database.transaction();
  req.transaction = t;

  const booking = await TravelDb.findOne({
    where: {
      bookingid: bookingid,
      status: [STATUS_WAITING, STATUS_CONFIRMED,
        STATUS_PAYMENT_PENDING]
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

  switch (status) {
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

    if (transaction.status == STATUS_PAYMENT_PENDING) {
      await transaction.update(
        {
          upi_ref: upiRef || 'NA',
          status: upiRef ? STATUS_PAYMENT_COMPLETED : STATUS_CASH_COMPLETED,
          description:description,
          updatedBy: req.user.username
        },
        { transaction: t }
      );
    }

    case STATUS_WAITING:
    default:
      throw new ApiError(400, 'Invalid status provided');
  }

  await booking.update(
    {
      status: newBookingStatus,
      admin_comments:adminComments,
      updatedBy: req.user.username
    },
    { transaction: t }
  );

  const card = CardDb.findOne({ where: { cardno: booking.cardno } });

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
  return res.status(200).send({ message: MSG_UPDATE_SUCCESSFUL });
};

// TODO: Deprecate? where is this used?
export const updateTransactionStatus = async (req, res) => {
  const { cardno, bookingid, type ,payment_status,amount,upi_ref} = req.body;

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



