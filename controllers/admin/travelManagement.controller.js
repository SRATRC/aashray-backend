import { TravelDb, CardDb, Transactions } from '../../models/associations.js';
import database from '../../config/database.js';
import Sequelize from 'sequelize';
import sendMail from '../../utils/sendMail.js';
import ApiError from '../../utils/ApiError.js';
import moment from 'moment';
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
  STATUS_CASH_PENDING,
  STATUS_PROCEED_FOR_PAYMENT,
  STATUS_SEATSFULL_CANCELLED,
  STATUS_WRONGFORM_CANCELLED,
  RAJ_PRAVAS_EMAIL,
  STATUS_PAYMENT_PENDING
} from '../../config/constants.js';
import {
  adminCancelTransaction,
  createPendingTransaction
} from '../../helpers/transactions.helper.js';
import { updateWaitingTravelBooking } from '../../helpers/travelBooking.helper.js';
import { validateCard } from '../../helpers/card.helper.js';
function getAdditionalConditions(whereClauses, pickupRC, dropRC, replacementMap) {
  let additionalWhereClause = '';

  console.log('🔍 getAdditionalConditions called with:', {
    whereClauses,
    pickupRC,
    dropRC,
    replacementMap
  });

  if (Array.isArray(whereClauses) && whereClauses.length > 0) {
    additionalWhereClause += ` AND ${whereClauses.join(' AND ')}`;
  } else if (whereClauses && !Array.isArray(whereClauses)) {
    console.warn('⚠️ Warning: whereClauses is not an array:', whereClauses);
  }

  if (pickupRC === 'true') {
    additionalWhereClause += " AND t1.pickup_point = 'RC'";
  }

  if (dropRC === 'true') {
    additionalWhereClause += " AND t1.drop_point = 'RC'";
  }

  console.log('✅ Final additionalWhereClause:', additionalWhereClause);

  return additionalWhereClause;
}

export const fetchSummary = async (req, res) => {
  console.log('🚀 fetchSummary triggered');

  try {
    const { start_date, end_date, statuses, pickupRC, dropRC, adminComments } = req.query;

    const normalizedStatuses = Array.isArray(statuses)
      ? statuses
      : statuses ? [statuses] : [];

    const adminCommentFilters = Array.isArray(adminComments)
      ? adminComments
      : adminComments ? [adminComments] : [];

    const replacements = {
      startDate: start_date,
      endDate: end_date
    };

    const conditions = [];

    normalizedStatuses.forEach((s, i) => {
      if (s === 'admin cancelled' && adminCommentFilters.length > 0) return;
      replacements[`status${i}`] = s;
      conditions.push(`t1.status = :status${i}`);
    });

    adminCommentFilters.forEach((c, i) => {
      replacements[`adminComment${i}`] = c;
      conditions.push(`(t1.status = 'admin cancelled' AND t1.admin_comments = :adminComment${i})`);
    });

    // Build WHERE clause
    let whereClause = '';
    if (conditions.length > 0) {
      whereClause += ' AND ' + conditions.join(' AND ');
    }
    if (pickupRC === 'true') {
      whereClause += " AND t1.pickup_point = 'RC'";
    }
    if (dropRC === 'true') {
      whereClause += " AND t1.drop_point = 'RC'";
    }

    const sql = `
      SELECT
        CASE
          WHEN LOWER(t1.pickup_point) IN (
            'dadar', 'dadar (swami narayan temple)', 'dadar (swaminarayan temple)', 'amar mahal',
            'airoli', 'borivali', 'vile parle (sahara star)', 'airport terminal 1', 'airport terminal 2',
            'railway station (bandra terminus)', 'railway station (kurla terminus)', 'railway station (ltt - kurla)',
            'railway station (csmt)', 'railway station (mumbai central)', 'mullund', 'mulund',
            'airport t1', 'airport t2', 'other', 'other (enter location in comments)',
            'railway station (ltt - kurla)', 'vile parle (sahara star hotel)', 'full car booking',
            'dadar (pritam hotel)','borivali (indraprasth shopping centre)','dadar (pritam da dhaba)','mulund (sarvoday nagar)'
          ) THEN 'Mumbai to Research Centre'
          WHEN LOWER(t1.drop_point) IN (
            'dadar', 'dadar (swami narayan temple)', 'dadar (swaminarayan temple)', 'amar mahal',
            'airoli', 'borivali', 'vile parle (sahara star)', 'airport terminal 1', 'airport terminal 2',
            'railway station (bandra terminus)', 'railway station (kurla terminus)', 'railway station (ltt - kurla)',
            'railway station (csmt)', 'railway station (mumbai central)', 'mullund', 'mulund',
            'airport t1', 'airport t2', 'other', 'other (enter location in comments)',
            'railway station (ltt - kurla)', 'vile parle (sahara star hotel)', 'full car booking',
            'dadar (pritam hotel)','borivali (indraprasth shopping centre)','dadar (pritam da dhaba)','mulund (sarvoday nagar)'
          ) THEN 'Research Centre to Mumbai'
          ELSE 'Other'
        END AS destination,

        CASE
          WHEN t1.status = 'admin cancelled' AND t1.admin_comments = 'admin_cancel_wrong_form'
            THEN 'Cancelled as wrong form filled'
          WHEN t1.status = 'admin cancelled' AND t1.admin_comments = 'admin_cancel_seats_full'
            THEN 'Cancelled as all seats are booked'
          ELSE t1.status
        END AS status,

        COUNT(*) AS count

      FROM travel_db t1
      WHERE t1.date >= :startDate AND t1.date <= :endDate
      ${whereClause}
      GROUP BY
        CASE
          WHEN LOWER(t1.pickup_point) IN (
            'dadar', 'dadar (swami narayan temple)', 'dadar (swaminarayan temple)', 'amar mahal',
            'airoli', 'borivali', 'vile parle (sahara star)', 'airport terminal 1', 'airport terminal 2',
            'railway station (bandra terminus)', 'railway station (kurla terminus)', 'railway station (ltt - kurla)',
            'railway station (csmt)', 'railway station (mumbai central)', 'mullund', 'mulund',
            'airport t1', 'airport t2', 'other', 'other (enter location in comments)',
            'railway station (ltt - kurla)', 'vile parle (sahara star hotel)', 'full car booking',
            'dadar (pritam hotel)','borivali (indraprasth shopping centre)','dadar (pritam da dhaba)','mulund (sarvoday nagar)'
          ) THEN 'Mumbai to Research Centre'
          WHEN LOWER(t1.drop_point) IN (
            'dadar', 'dadar (swami narayan temple)', 'dadar (swaminarayan temple)', 'amar mahal',
            'airoli', 'borivali', 'vile parle (sahara star)', 'airport terminal 1', 'airport terminal 2',
            'railway station (bandra terminus)', 'railway station (kurla terminus)', 'railway station (ltt - kurla)',
            'railway station (csmt)', 'railway station (mumbai central)', 'mullund', 'mulund',
            'airport t1', 'airport t2', 'other', 'other (enter location in comments)',
            'railway station (ltt - kurla)', 'vile parle (sahara star hotel)', 'full car booking',
            'dadar (pritam hotel)','borivali (indraprasth shopping centre)','dadar (pritam da dhaba)','mulund (sarvoday nagar)'
          ) THEN 'Research Centre to Mumbai'
          ELSE 'Other'
        END,
        CASE
          WHEN t1.status = 'admin cancelled' AND t1.admin_comments = 'admin_cancel_wrong_form'
            THEN 'Cancelled as wrong form filled'
          WHEN t1.status = 'admin cancelled' AND t1.admin_comments = 'admin_cancel_seats_full'
            THEN 'Cancelled as all seats are booked'
          ELSE t1.status
        END
      ORDER BY destination, status
    `;

    console.log('📥 Replacements:', replacements);
    const data = await database.query(sql, {
      replacements,
      type: Sequelize.QueryTypes.SELECT
    });

    console.log('📊 fetchSummary data:', data);
    return res.status(200).send({ message: 'Fetched data', data });

  } catch (error) {
    console.error('❌ fetchSummary error:', error);
    return res.status(500).send({
      statusCode: 500,
      message: error.message,
      data: error.stack
    });
  }
};


export const fetchUpcomingBookings = async (req, res) => {
  const { start_date, end_date, statuses, pickupRC, dropRC, adminComments } = req.query;

  const normalizedStatuses = statuses
    ? Array.isArray(statuses) ? statuses : [statuses]
    : [];

  const adminCommentFilters = adminComments
    ? Array.isArray(adminComments) ? adminComments : [adminComments]
    : [];

  const replacementMap = {
    startDate: start_date,
    endDate: end_date,
    category: TYPE_TRAVEL
  };

  const conditions = [];

  normalizedStatuses.forEach((s, i) => {
    if (s === 'admin cancelled' && adminCommentFilters.length > 0) {
      return;
    }
    replacementMap[`status${i}`] = s;
    conditions.push(`t1.status = :status${i}`);
  });

  adminCommentFilters.forEach((c, i) => {
    replacementMap[`adminComment${i}`] = c;
    conditions.push(`(t1.status = 'admin cancelled' AND t1.admin_comments = :adminComment${i})`);
  });

  const additionalWhereClause = getAdditionalConditions(conditions, pickupRC, dropRC, replacementMap);

  // Replace pickup and drop point if user selected "other"
  const pickupSelect = `
  CASE
    WHEN t1.pickup_point IN ('Other', 'Other (enter location in comments)')
      THEN t1.comments
    ELSE t1.pickup_point
  END AS pickup_point`;

const dropSelect = `
  CASE
    WHEN t1.drop_point IN ('Other', 'Other (enter location in comments)')
      THEN t1.comments
    ELSE t1.drop_point
  END AS drop_point`;

  const data = await database.query(
    `SELECT t1.bookingid, t1.bookedBy, t1.date,
       ${pickupSelect}, ${dropSelect}, t1.arrival_time,
       t1.leaving_post_adhyayan, t1.type, t1.total_people, t1.luggage,
       t1.comments, t1.admin_comments, t1.status, t3.issuedto, t3.mobno, t3.center,
       t2.amount, DATE(t2.updatedAt) as paymentDate, t2.status as paymentStatus, t3.res_status
      FROM travel_db t1
     LEFT JOIN transactions t2 ON t2.bookingid = t1.bookingId AND t2.category = :category
     LEFT JOIN card_db t3 ON t1.cardno = t3.cardno
     WHERE t1.date >= :startDate AND t1.date <= :endDate
     ${additionalWhereClause}
     ORDER BY date ASC`,
    {
      replacements: replacementMap,
      type: Sequelize.QueryTypes.SELECT
    }
  );

  return res.status(200).send({ message: 'Fetched data', data });
};

import { QueryTypes } from 'sequelize'; // Make sure you import this if you're using Sequelize

export const fetchBookingForDriver = async (req, res) => {
  try {
    // --- Get current IST time ---
    const now = new Date();
    const istNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));

    // --- Decide date to fetch based on 8PM IST cutoff ---
    const fetchDate =
      istNow.getHours() < 20
        ? istNow.toISOString().split('T')[0]
        : new Date(istNow.getTime() + 86400000).toISOString().split('T')[0];

    const data = await database.query(
      `
      SELECT
        t1.date,
        t3.issuedto AS Mumukshu_Name,
        t3.mobno AS Mobile_Number,

        CASE
          WHEN t1.pickup_point IN (
            'dadar', 'Dadar (Swami Narayan Temple)', 'Dadar (Swaminarayan Temple)', 'Amar Mahal', 'Airoli', 'Borivali',
            'Vile Parle (Sahara Star)', 'Airport Terminal 1', 'Airport Terminal 2', 'Railway Station (Bandra Terminus)',
            'Railway Station (Kurla Terminus)', 'Railway station (LTT - Kurla)', 'Railway Station (CSMT)',
            'Railway Station (Mumbai Central)', 'mullund', 'Mulund', 'AIRPORT T1', 'AIRPORT T2', 'OTHER',
            'RAILWAY STATION (LTT - KURLA)', 'VILE PARLE (SAHARA STAR HOTEL)', 'Full Car Booking',
            'Dadar (Pritam Hotel)', 'Railway station (Mumbai Central)', 'Other (enter location in comments)'
          ) THEN 'Mumbai to Research Centre'

          WHEN t1.drop_point IN (
            'dadar', 'Dadar (Swami Narayan Temple)', 'Dadar (Swaminarayan Temple)', 'Amar Mahal', 'Airoli', 'Borivali',
            'Vile Parle (Sahara Star)', 'Airport Terminal 1', 'Airport Terminal 2', 'Railway Station (Bandra Terminus)',
            'Railway Station (Kurla Terminus)', 'Railway station (LTT - Kurla)', 'Railway Station (CSMT)',
            'Railway Station (Mumbai Central)', 'mullund', 'Mulund', 'AIRPORT T1', 'AIRPORT T2', 'OTHER',
            'RAILWAY STATION (LTT - KURLA)', 'VILE PARLE (SAHARA STAR HOTEL)', 'Full Car Booking',
            'Dadar (Pritam Hotel)', 'Railway station (Mumbai Central)', 'Other (enter location in comments)'
          ) THEN 'Research Centre to Mumbai'

          ELSE 'Unknown'
        END AS Travelling_From,

        CASE
          WHEN t1.pickup_point IN (
            'dadar', 'Dadar (Swami Narayan Temple)', 'Dadar (Swaminarayan Temple)', 'Amar Mahal', 'Airoli', 'Borivali',
            'Vile Parle (Sahara Star)', 'Airport Terminal 1', 'Airport Terminal 2', 'Railway Station (Bandra Terminus)',
            'Railway Station (Kurla Terminus)', 'Railway station (LTT - Kurla)', 'Railway Station (CSMT)',
            'Railway Station (Mumbai Central)', 'mullund', 'Mulund', 'AIRPORT T1', 'AIRPORT T2', 'OTHER',
            'RAILWAY STATION (LTT - KURLA)', 'VILE PARLE (SAHARA STAR HOTEL)', 'Full Car Booking',
            'Dadar (Pritam Hotel)', 'Railway station (Mumbai Central)', 'Other (enter location in comments)'
          )
          THEN
            CASE
              WHEN LOWER(t1.pickup_point) IN ('dadar', 'dadar (swami narayan temple)', 'dadar (swaminarayan temple)', 'dadar (pritam hotel)')
                THEN 'Dadar (Swami Narayan Temple)'
              WHEN LOWER(t1.pickup_point) = 'amar mahal'
                THEN 'Amar Mahal'
              WHEN LOWER(t1.pickup_point) = 'airoli'
                THEN 'Airoli'
              WHEN LOWER(t1.pickup_point) IN ('other', 'other (enter location in comments)')
                THEN COALESCE(t1.comments, 'Other')
              ELSE t1.pickup_point
            END

          WHEN t1.drop_point IN (
            'dadar', 'Dadar (Swami Narayan Temple)', 'Dadar (Swaminarayan Temple)', 'Amar Mahal', 'Airoli', 'Borivali',
            'Vile Parle (Sahara Star)', 'Airport Terminal 1', 'Airport Terminal 2', 'Railway Station (Bandra Terminus)',
            'Railway Station (Kurla Terminus)', 'Railway station (LTT - Kurla)', 'Railway Station (CSMT)',
            'Railway Station (Mumbai Central)', 'mullund', 'Mulund', 'AIRPORT T1', 'AIRPORT T2', 'OTHER',
            'RAILWAY STATION (LTT - KURLA)', 'VILE PARLE (SAHARA STAR HOTEL)', 'Full Car Booking',
            'Dadar (Pritam Hotel)', 'Railway station (Mumbai Central)', 'Other (enter location in comments)'
          )
          THEN
            CASE
              WHEN LOWER(t1.drop_point) IN ('dadar', 'dadar (swami narayan temple)', 'dadar (swaminarayan temple)', 'dadar (pritam hotel)')
                THEN 'Dadar (Swami Narayan Temple)'
              WHEN LOWER(t1.drop_point) = 'amar mahal'
                THEN 'Amar Mahal'
              WHEN LOWER(t1.drop_point) = 'airoli'
                THEN 'Airoli'
              WHEN LOWER(t1.drop_point) IN ('other', 'other (enter location in comments)')
                THEN COALESCE(t1.comments, 'Other')
              ELSE t1.drop_point
            END

          ELSE COALESCE(t1.pickup_point, t1.drop_point)
        END AS \`Pickup/Dropoff_Point\`

      FROM travel_db t1
      LEFT JOIN card_db t3 ON t1.cardno = t3.cardno
      WHERE t1.status IN ('confirmed')
        AND t1.date = :fetchDate

      ORDER BY
        Travelling_From ASC,
        CASE
          WHEN LOWER(t1.pickup_point) IN ('dadar', 'dadar (swami narayan temple)', 'dadar (swaminarayan temple)', 'dadar (pritam hotel)')
               OR LOWER(t1.drop_point) IN ('dadar', 'dadar (swami narayan temple)', 'dadar (swaminarayan temple)', 'dadar (pritam hotel)')
            THEN 1
          WHEN LOWER(t1.pickup_point) = 'amar mahal' OR LOWER(t1.drop_point) = 'amar mahal'
            THEN 2
          WHEN LOWER(t1.pickup_point) = 'airoli' OR LOWER(t1.drop_point) = 'airoli'
            THEN 3
          ELSE 4
        END,
        \`Pickup/Dropoff_Point\`
      ;
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { fetchDate },
      }
    );

    return res.status(200).send({ message: 'Fetched data', data });
  } catch (error) {
    console.error("Error fetching data for driver:", error);
    return res.status(500).send({ message: 'Something went wrong', error });
  }
};


export const updateBookingStatus = async (req, res) => {
  const { bookingid, status, adminComments,  description, charges } = req.body;
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
        transaction = (await createPendingTransaction(
          bookedByCard,
          booking,
          TYPE_TRAVEL,
          charges,
          req.user.username,
          t
        )).transaction;
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

      case STATUS_SEATSFULL_CANCELLED:
      if (transaction) {
        await adminCancelTransaction(req.user, bookedByCard, transaction, t);
        updateWaitingTravelBooking(booking.date);
      }
      break;

      case STATUS_WRONGFORM_CANCELLED:
      if (transaction) {
        await adminCancelTransaction(req.user, bookedByCard, transaction, t);
        updateWaitingTravelBooking(booking.date);
      }
      break;

    case STATUS_CONFIRMED:
  if (transaction && ![STATUS_PAYMENT_COMPLETED, STATUS_CASH_COMPLETED].includes(transaction.status)) {
    let newTransactionStatus;

    if (transaction.status === STATUS_CASH_PENDING) {
      newTransactionStatus = STATUS_PAYMENT_COMPLETED;
    } else if (transaction.status === STATUS_PAYMENT_PENDING) {
      newTransactionStatus = STATUS_PAYMENT_COMPLETED;
    }

    if (newTransactionStatus) {
      await transaction.update(
        {
          status: newTransactionStatus,
          description,
          updatedBy: req.user.username
        },
        { transaction: t }
      );
    }
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
  if (newBookingStatus === STATUS_ADMIN_CANCELLED) {
  if (booking.admin_comments === 'admin_cancel_seats_full') {
    newBookingStatus = 'Cancelled because all seats were booked';
  } else if (booking.admin_comments === 'admin_cancel_wrong_form') {
    newBookingStatus = 'Cancelled because of wrong form filled';
  } else {
    newBookingStatus = 'Cancelled by admin';
  }
}
  sendMail({
    email: card.email,
    subject: 'Vitraag Vigyaan Aashray: Raj Pravas - Travel Booking Updated',
    template: 'rajPravasStatusUpdate',
    context: {
      name: card.issuedto,
      bookingid: booking.bookingid,
      date: moment(booking.date).format('Do MMMM, YYYY'),
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

