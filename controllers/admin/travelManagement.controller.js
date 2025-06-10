import { TravelDb, CardDb, Transactions } from '../../models/associations.js';
import database from '../../config/database.js';
import Sequelize from 'sequelize';
import sendMail from '../../utils/sendMail.js';
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
  STATUS_WAITING,
  TYPE_TRAVEL,
  STATUS_CASH_COMPLETED,
  STATUS_PROCEED_FOR_PAYMENT
} from '../../config/constants.js';
import {
  adminCancelTransaction,
  createPendingTransaction
} from '../../helpers/transactions.helper.js';
import { updateWaitingTravelBooking } from '../../helpers/travelBooking.helper.js';
import { validateCard } from '../../helpers/card.helper.js';

function getAdditionalConditions(statuses, pickupRC, dropRC, replacementMap) {
  let additionalWhereClause = '';

  if (statuses && statuses.length > 0) {
    additionalWhereClause += ' AND t1.status IN (:status)';
    replacementMap.status = statuses;
  }

  if (pickupRC === 'true') {
    additionalWhereClause += " AND t1.pickup_point = 'RC'";
  }

  if (dropRC === 'true') {
    additionalWhereClause += " AND t1.drop_point = 'RC'";
  }

  return additionalWhereClause;
}

export const fectchSummary = async (req, res) => {
  const { start_date, end_date, statuses, pickupRC, dropRC } = req.query;

  const normalizedStatuses = statuses
    ? Array.isArray(statuses)
      ? statuses
      : [statuses]
    : [];

  const replacementMap = {
    startDate: start_date,
    endDate: end_date
  };

  const additionalWhereClause = getAdditionalConditions(
    normalizedStatuses,
    pickupRC,
    dropRC,
    replacementMap
  );

  const data = await database.query(
    `SELECT t1.status, COUNT(*) as count
     FROM travel_db t1
     WHERE t1.date >= :startDate AND t1.date <= :endDate ${additionalWhereClause}
     GROUP BY t1.status`,
    {
      replacements: replacementMap,
      type: Sequelize.QueryTypes.SELECT
    }
  );
  console.log('Summary data from DB:', data);

  return res.status(200).send({ message: 'Fetched data', data });
};

export const fetchUpcomingBookings = async (req, res) => {
  const { start_date, end_date, statuses, pickupRC, dropRC } = req.query;

  const normalizedStatuses = statuses
    ? Array.isArray(statuses)
      ? statuses
      : [statuses]
    : [];

  const replacementMap = {
    startDate: start_date,
    endDate: end_date,
    category: TYPE_TRAVEL
  };

  const additionalWhereClause = getAdditionalConditions(
    normalizedStatuses,
    pickupRC,
    dropRC,
    replacementMap
  );

  const data = await database.query(
    `SELECT t1.bookingid, t1.bookedBy, t1.date, t1.pickup_point, t1.drop_point, t1.type, t1.luggage,
            t1.comments, t1.admin_comments, t1.status, t3.issuedto, t3.mobno, t3.center,
            t2.amount, DATE(t2.updatedAt) as paymentDate, t2.status as paymentStatus, t3.res_status
     FROM travel_db t1
     LEFT JOIN transactions t2 ON t2.bookingid = t1.bookingId AND t2.category = :category
     LEFT JOIN card_db t3 ON t1.cardno = t3.cardno
     WHERE t1.date >= :startDate AND t1.date <= :endDate ${additionalWhereClause}
     ORDER BY date ASC`,
    {
      replacements: replacementMap,
      type: Sequelize.QueryTypes.SELECT
    }
  );

  return res.status(200).send({ message: 'Fetched data', data });
};

export const updateBookingStatus = async (req, res) => {
  const { bookingid, status, adminComments,  description,charges } = req.body;
  let newBookingStatus = status;

  const t = await database.transaction();
  req.transaction = t;

  const booking = await TravelDb.findOne({
    where: {
      bookingid
      // status: [STATUS_AWAITING_CONFIRMATION, STATUS_CONFIRMED, STATUS_PAYMENT_PENDING, STATUS_PROCEED_FOR_PAYMENT]
    }
  });

  if (!booking) throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  if (status == booking.status)
    throw new ApiError(400, 'Status is same as before');
  if ([STATUS_ADMIN_CANCELLED, STATUS_CANCELLED].includes(booking.status)) {
    throw new ApiError(400, ERR_BOOKING_ALREADY_CANCELLED);
  }

  const cardno = booking.bookedBy || booking.cardno;
  const bookedByCard = await validateCard(cardno);

  let transaction = await Transactions.findOne({ where: { bookingid } });

  switch (status) {
    case STATUS_PROCEED_FOR_PAYMENT:
      if (!transaction) {
        transaction = await createPendingTransaction(
          bookedByCard,
          booking,
          TYPE_TRAVEL,
          charges,
          req.user.username,
          t,
          true
        );
      }

      if (transaction.status === STATUS_PAYMENT_COMPLETED) {
        newBookingStatus = STATUS_CONFIRMED;
      }
      break;

    case STATUS_ADMIN_CANCELLED:
      if (transaction) {
        await adminCancelTransaction(req.user, transaction, t);
        updateWaitingTravelBooking(booking.date);
      }
      break;

    case STATUS_CONFIRMED:
<<<<<<< HEAD
  if (transaction && ![STATUS_PAYMENT_COMPLETED, STATUS_CASH_COMPLETED].includes(transaction.status)) {
    await transaction.update(
      {
        
        
        description,
        updatedBy: req.user.username
      },
      { transaction: t }
    );
  }
  break;
=======
      if (
        transaction &&
        ![STATUS_PAYMENT_COMPLETED, STATUS_CASH_COMPLETED].includes(
          transaction.status
        )
      ) {
        await transaction.update(
          {
            status: STATUS_CASH_COMPLETED,
            description,
            updatedBy: req.user.username
          },
          { transaction: t }
        );
      }
      break;
>>>>>>> f3041e7491f44deef537b8b689f31774fc710493

    case STATUS_WAITING:
    default:
      throw new ApiError(400, 'Invalid status provided');
  }

  await booking.update(
    {
      status: newBookingStatus,
      admin_comments: adminComments,
      updatedBy: req.user.username
    },
    { transaction: t }
  );

  const card = await CardDb.findOne({ where: { cardno: booking.cardno } });

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

export const updateTransactionStatus = async (req, res) => {
<<<<<<< HEAD
  const { cardno, bookingid, type, payment_status, amount } = req.body;
=======
  const { cardno, bookingid, type } = req.body;
>>>>>>> f3041e7491f44deef537b8b689f31774fc710493

  const booking = await TravelDb.findOne({
    where: {
      bookingid,
      status: [STATUS_WAITING, STATUS_CONFIRMED]
    }
  });

  if (!booking) throw new ApiError(404, ERR_BOOKING_NOT_FOUND);

  const t = await database.transaction();
  req.transaction = t;

  const transaction = await Transactions.findOne({
    where: { cardno, bookingid, type }
  });

  if (!transaction) throw new ApiError(404, ERR_TRANSACTION_NOT_FOUND);

  await adminCancelTransaction(req.user, transaction, t);

  await t.commit();
  return res.status(200).send({ message: MSG_UPDATE_SUCCESSFUL });
};
