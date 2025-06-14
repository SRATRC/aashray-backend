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
    `SELECT
  CASE
    WHEN t1.pickup_point IN (
      'dadar',
      'Dadar (Swami Narayan Temple)', 
      'Dadar (Swaminarayan Temple)',
      'Amar Mahal', 
      'Airoli', 
      'Vile Parle (Sahara Star)', 
      'Airport Terminal 1', 
      'Airport Terminal 2', 
      'Railway Station (Bandra Terminus)', 
      'Railway Station (Kurla Terminus)',
      'Railway station (LTT - Kurla)', 
      'Railway Station (CSMT)', 
      'Railway Station (Mumbai Central)',
      'mullund',
      'AIRPORT T1',
      'AIRPORT T2',
      'OTHER',
      'RAILWAY STATION (LTT - KURLA)',
      'VILE PARLE (SAHARA STAR HOTEL)',
      'Full Car Booking'
    ) THEN 'Mumbai to Research Centre'
    
    WHEN t1.drop_point IN (
      'dadar',
      'Dadar (Swami Narayan Temple)', 
      'Dadar (Swaminarayan Temple)',
      'Amar Mahal', 
      'Airoli', 
      'Vile Parle (Sahara Star)', 
      'Airport Terminal 1', 
      'Airport Terminal 2', 
      'Railway Station (Bandra Terminus)', 
      'Railway Station (Kurla Terminus)', 
      'Railway station (LTT - Kurla)',
      'Railway Station (CSMT)', 
      'Railway Station (Mumbai Central)',
      'mullund',
      'AIRPORT T1',
      'AIRPORT T2',
      'OTHER',
      'RAILWAY STATION (LTT - KURLA)',
      'VILE PARLE (SAHARA STAR HOTEL)',
      'Full Car Booking'
    ) THEN 'Research Centre to Mumbai'
    ELSE 'Other'
  END AS destination,
  t1.status,
  COUNT(*) AS count
FROM travel_db t1
WHERE t1.date >= :startDate AND t1.date <= :endDate
${additionalWhereClause} -- Your existing dynamic filtering conditions
GROUP BY destination, t1.status
ORDER BY destination, t1.status`,
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
    `SELECT t1.bookingid, t1.bookedBy, t1.date, t1.pickup_point, t1.drop_point, DATE(t1.arrival_time), t1.leaving_post_adhyayan, t1.type, t1.total_people, t1.luggage,
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
console.log("Fetched travel data:", data);

  return res.status(200).send({ message: 'Fetched data', data });
  
};

import { QueryTypes } from 'sequelize'; // Make sure you import this if you're using Sequelize

export const fetchBookingForDriver = async (req, res) => {
  try {
    const data = await database.query(
      `
      SELECT
  t1.date,
  t3.issuedto AS Mumukshu_Name,
  t3.mobno AS Mobile_Number,

  CASE
    WHEN t1.pickup_point IN (
      'dadar', 'Dadar (Swami Narayan Temple)', 'Dadar (Swaminarayan Temple)',
      'Amar Mahal', 'Airoli', 'Vile Parle (Sahara Star)', 
      'Airport Terminal 1', 'Airport Terminal 2', 
      'Railway Station (Bandra Terminus)', 'Railway Station (Kurla Terminus)', 
      'Railway station (LTT - Kurla)', 'Railway Station (CSMT)', 
      'Railway Station (Mumbai Central)', 'mullund', 'AIRPORT T1',
      'AIRPORT T2', 'OTHER', 'RAILWAY STATION (LTT - KURLA)',
      'VILE PARLE (SAHARA STAR HOTEL)', 'Full Car Booking'
    ) THEN 'Mumbai to Research Centre'
    WHEN t1.drop_point IN (
      'dadar', 'Dadar (Swami Narayan Temple)', 'Dadar (Swaminarayan Temple)',
      'Amar Mahal', 'Airoli', 'Vile Parle (Sahara Star)', 
      'Airport Terminal 1', 'Airport Terminal 2', 
      'Railway Station (Bandra Terminus)', 'Railway Station (Kurla Terminus)', 
      'Railway station (LTT - Kurla)', 'Railway Station (CSMT)', 
      'Railway Station (Mumbai Central)', 'mullund', 'AIRPORT T1',
      'AIRPORT T2', 'OTHER', 'RAILWAY STATION (LTT - KURLA)',
      'VILE PARLE (SAHARA STAR HOTEL)', 'Full Car Booking'
    ) THEN 'Research Centre to Mumbai'
    ELSE 'Unknown'
  END AS Travelling_From,

  CASE
    WHEN LOWER(t1.pickup_point) IN ('dadar', 'dadar (swami narayan temple)', 'dadar (swaminarayan temple)')
         OR LOWER(t1.drop_point) IN ('dadar', 'dadar (swami narayan temple)', 'dadar (swaminarayan temple)')
      THEN 'Dadar (Swami Narayan Temple)'
    WHEN LOWER(t1.pickup_point) = 'amar mahal' OR LOWER(t1.drop_point) = 'amar mahal'
      THEN 'Amar Mahal'
    WHEN LOWER(t1.pickup_point) = 'airoli' OR LOWER(t1.drop_point) = 'airoli'
      THEN 'Airoli'
    ELSE COALESCE(t1.pickup_point, t1.drop_point)
  END AS \`Pickup/Dropoff_Point\`

FROM travel_db t1
LEFT JOIN card_db t3 ON t1.cardno = t3.cardno
WHERE t1.status = 'confirmed'
  AND t1.date = CASE
    WHEN CURTIME() < '20:00:00' THEN CURDATE()
    ELSE CURDATE() + INTERVAL 1 DAY
  END

ORDER BY
  Travelling_From ASC,
  CASE
    WHEN LOWER(t1.pickup_point) IN ('dadar', 'dadar (swami narayan temple)', 'dadar (swaminarayan temple)')
         OR LOWER(t1.drop_point) IN ('dadar', 'dadar (swami narayan temple)', 'dadar (swaminarayan temple)')
      THEN 1
    WHEN LOWER(t1.pickup_point) = 'amar mahal' OR LOWER(t1.drop_point) = 'amar mahal'
      THEN 2
    WHEN LOWER(t1.pickup_point) = 'airoli' OR LOWER(t1.drop_point) = 'airoli'
      THEN 3
    ELSE 4
  END,
  \`Pickup/Dropoff_Point\`;
`,
      { type: QueryTypes.SELECT }
    );

    console.log("Fetched travel data for driver:", data);
    return res.status(200).send({ message: 'Fetched data', data });
  } catch (error) {
    console.error("Error fetching data for driver:", error);
    return res.status(500).send({ message: 'Something went wrong', error });
  }
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
        await adminCancelTransaction(req.user, bookedByCard, transaction, t);
        updateWaitingTravelBooking(booking.date);
      }
      break;

    case STATUS_CONFIRMED:
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
  const { cardno, bookingid, type, payment_status, amount } = req.body;

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

  await adminCancelTransaction(req.user, null, transaction, t);

  await t.commit();
  return res.status(200).send({ message: MSG_UPDATE_SUCCESSFUL });
};
