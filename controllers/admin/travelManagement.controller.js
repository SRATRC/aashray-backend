import {
  TravelDb,
  CardDb,
  Transactions,
  TravelBusGroup,
  TravelBusPassengers,
  TravelBusStops,
  ShibirBookingDb,
  ShibirDb
} from '../../models/associations.js';
import {
  matchAdhyayanForLeg,
  ATTENDING_EXCLUDED_STATUSES
} from '../../helpers/adhyayanTravel.helper.js';
import { Op } from 'sequelize';
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
  STATUS_PAYMENT_PENDING
} from '../../config/constants.js';
import {
  adminCancelTransaction,
  createPendingTransaction,
  cancelTransaction
} from '../../helpers/transactions.helper.js';
import { sendDualUserNotifications } from '../../helpers/notification.helper.js';
import { updateWaitingTravelBooking, sendTravelBookingStatusUpdateMail } from '../../helpers/travelBooking.helper.js';
import { validateCard } from '../../helpers/card.helper.js';
import { sendTravelStatusChangeWhatsApp } from '../../helpers/whatsapp.helper.js';
import Sequelize, { QueryTypes } from 'sequelize';
import database from '../../config/database.js';
import sendMail from '../../utils/sendMail.js';
import ApiError from '../../utils/ApiError.js';
import moment from 'moment';
import XLSX from 'xlsx';

function normalizeExcelTime(value) {

  // Excel numeric time
  if (
    typeof value === 'number'
  ) {

    const totalMinutes =
      Math.round(
        value * 24 * 60
      );

    const hours =
      String(
        Math.floor(
          totalMinutes / 60
        )
      ).padStart(2, '0');

    const minutes =
      String(
        totalMinutes % 60
      ).padStart(2, '0');

    return `${hours}:${minutes}`;
  }

  // Already string
  if (
    typeof value === 'string'
  ) {

    return value.trim();
  }

  return '';
}

function getAdditionalConditions(
  whereClauses,
  pickupRC,
  dropRC,
  replacementMap
) {
  let additionalWhereClause = '';

  if (Array.isArray(whereClauses) && whereClauses.length > 0) {
    additionalWhereClause += ` AND ${whereClauses.join(' AND ')}`;
  }

  if (pickupRC === 'true') {
    additionalWhereClause += " AND t1.pickup_point = 'RC'";
  }

  if (dropRC === 'true') {
    additionalWhereClause += " AND t1.drop_point = 'RC'";
  }

  return additionalWhereClause;
}

export const fetchSummary = async (req, res) => {
  try {
    const { start_date, end_date, statuses, pickupRC, dropRC, adminComments } =
      req.query;
    req.log.info('travel_fetch_summary_start', { start_date, end_date, statuses, pickupRC, dropRC });

    const normalizedStatuses = Array.isArray(statuses)
      ? statuses
      : statuses
        ? [statuses]
        : [];

    const adminCommentFilters = Array.isArray(adminComments)
      ? adminComments
      : adminComments
        ? [adminComments]
        : [];

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
      conditions.push(
        `(t1.status = 'admin cancelled' AND t1.admin_comments = :adminComment${i})`
      );
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
            'railway station (bandra terminus)', 'railway station (kurla terminus)', 'railway station (ltt - kurla)', 'railway station (ltt - kurla terminus)',
            'railway station (csmt)', 'railway station (mumbai central)', 'mullund', 'mulund',
            'airport t1', 'airport t2', 'other', 'other (enter location in comments)',
            'railway station (ltt - kurla)', 'vile parle (sahara star hotel)', 'full car booking',
            'dadar (pritam hotel)','borivali (indraprasth shopping centre)','dadar (pritam da dhaba)','mulund (sarvoday nagar)'
          ) THEN 'Mumbai to Research Centre'
          WHEN LOWER(t1.drop_point) IN (
            'dadar', 'dadar (swami narayan temple)', 'dadar (swaminarayan temple)', 'amar mahal',
            'airoli', 'borivali', 'vile parle (sahara star)', 'airport terminal 1', 'airport terminal 2',
            'railway station (bandra terminus)', 'railway station (kurla terminus)', 'railway station (ltt - kurla)','railway station (ltt - kurla terminus)',
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
            'railway station (bandra terminus)', 'railway station (kurla terminus)', 'railway station (ltt - kurla)','railway station (ltt - kurla terminus)',
            'railway station (csmt)', 'railway station (mumbai central)', 'mullund', 'mulund',
            'airport t1', 'airport t2', 'other', 'other (enter location in comments)',
            'railway station (ltt - kurla)', 'vile parle (sahara star hotel)', 'full car booking',
            'dadar (pritam hotel)','borivali (indraprasth shopping centre)','dadar (pritam da dhaba)','mulund (sarvoday nagar)'
          ) THEN 'Mumbai to Research Centre'
          WHEN LOWER(t1.drop_point) IN (
            'dadar', 'dadar (swami narayan temple)', 'dadar (swaminarayan temple)', 'amar mahal',
            'airoli', 'borivali', 'vile parle (sahara star)', 'airport terminal 1', 'airport terminal 2',
            'railway station (bandra terminus)', 'railway station (kurla terminus)', 'railway station (ltt - kurla)','railway station (ltt - kurla terminus)',
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

    const data = await database.query(sql, {
      replacements,
      type: Sequelize.QueryTypes.SELECT
    });

    req.log.info('travel_fetch_summary_success', { start_date, end_date, count: data.length });
    return res.status(200).send({ message: 'Fetched data', data });
  } catch (error) {
    req.log.error('travel_fetch_summary_error', { error: error.message });
    return res.status(500).send({
      statusCode: 500,
      message: error.message,
      data: error.stack
    });
  }
};

export const fetchUpcomingBookings = async (req, res) => {
  const { start_date, end_date, statuses, pickupRC, dropRC, adminComments } =
    req.query;
  req.log.info('travel_fetch_upcoming_bookings_start', { start_date, end_date, statuses, pickupRC, dropRC });

  const normalizedStatuses = statuses
    ? Array.isArray(statuses)
      ? statuses
      : [statuses]
    : [];

  const adminCommentFilters = adminComments
    ? Array.isArray(adminComments)
      ? adminComments
      : [adminComments]
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
    conditions.push(
      `(t1.status = 'admin cancelled' AND t1.admin_comments = :adminComment${i})`
    );
  });

  const additionalWhereClause = getAdditionalConditions(
    conditions,
    pickupRC,
    dropRC,
    replacementMap
  );

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
    `SELECT t1.bookingid, t1.cardno, t1.trip_group_id, t1.bookedBy, t1.date,
       ${pickupSelect}, ${dropSelect}, t1.arrival_time,
       t1.leaving_post_adhyayan, t1.type, t1.total_people, t1.luggage,
tbp.bus_group_id,
tbg.bus_name,
tbg.capacity AS bus_capacity,
tbg.coordinator_bookingid,
       t1.comments, t1.admin_comments, t1.status, t3.issuedto, t3.mobno, t3.center,
       t2.amount, DATE(t2.updatedAt) as paymentDate, t2.status as paymentStatus, t3.res_status
      FROM travel_db t1
     LEFT JOIN transactions t2 ON t2.bookingid = t1.bookingId AND t2.category = :category
     LEFT JOIN card_db t3 ON t1.cardno = t3.cardno
      LEFT JOIN travel_bus_passengers tbp
    ON t1.bookingid = tbp.bookingid
LEFT JOIN travel_bus_group tbg
    ON tbp.bus_group_id = tbg.id
     WHERE t1.date >= :startDate AND t1.date <= :endDate
     ${additionalWhereClause}
     ORDER BY date ASC`,
    {
      replacements: replacementMap,
      type: Sequelize.QueryTypes.SELECT
    }
  );

  const busGroupIds =

    [...new Set(

      data
        .filter(
          item =>
            item.bus_group_id
        )
        .map(
          item =>
            item.bus_group_id
        )
    )];

  const busStops =
    await TravelBusStops.findAll({

      where: {

        bus_group_id:
          busGroupIds,
      },

      order: [
        ['stop_order', 'ASC']
      ],
    });

  for (const item of data) {

    item.stops =
      busStops.filter(
        stop =>

          stop.bus_group_id ===
          item.bus_group_id
      );
  }

  const cardnos = [...new Set(data.map((r) => r.cardno).filter(Boolean))];
  let registrations = [];
  if (cardnos.length > 0) {
    const rows = await ShibirBookingDb.findAll({
      where: {
        cardno: { [Op.in]: cardnos },
        status: { [Op.notIn]: ATTENDING_EXCLUDED_STATUSES }
      },
      include: [{ model: ShibirDb, as: 'ShibirDb', attributes: ['name', 'start_date', 'end_date'] }],
      // Deterministic order so same-delta ties in matchAdhyayanForLeg resolve stably.
      order: [[{ model: ShibirDb, as: 'ShibirDb' }, 'start_date', 'ASC']]
    });
    registrations = rows
      .filter((r) => r.ShibirDb)
      .map((r) => ({
        cardno: r.cardno,
        name: r.ShibirDb.name,
        start_date: r.ShibirDb.start_date,
        end_date: r.ShibirDb.end_date,
        status: r.status
      }));
  }

  // Index registrations by cardno once so the per-row match is O(rows + registrations).
  const registrationsByCardno = new Map();
  for (const reg of registrations) {
    if (!registrationsByCardno.has(reg.cardno)) registrationsByCardno.set(reg.cardno, []);
    registrationsByCardno.get(reg.cardno).push(reg);
  }

  for (const item of data) {
    item.adhyayan = matchAdhyayanForLeg(item, registrationsByCardno.get(item.cardno) || []);
  }

  req.log.info('travel_fetch_upcoming_bookings_success', { start_date, end_date, count: data.length });
  return res.status(200).send({ message: 'Fetched data', data });
};

export const fetchBookingForDriver = async (req, res) => {
  try {
    req.log.info('travel_fetch_booking_for_driver_start');

    // --- Get current IST time ---
    const now = new Date();
    const istNow = new Date(
      now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })
    );

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
            'Railway Station (Kurla Terminus)', 'Railway station (LTT - Kurla)', 'railway station (ltt - kurla terminus)', 'Railway Station (CSMT)',
            'Railway Station (Mumbai Central)', 'mullund', 'Mulund', 'AIRPORT T1', 'AIRPORT T2', 'OTHER',
            'RAILWAY STATION (LTT - KURLA)', 'VILE PARLE (SAHARA STAR HOTEL)', 'Full Car Booking',
            'Dadar (Pritam Hotel)', 'Railway station (Mumbai Central)', 'Other (enter location in comments)'
          ) THEN 'Mumbai to Research Centre'

          WHEN t1.drop_point IN (
            'dadar', 'Dadar (Swami Narayan Temple)', 'Dadar (Swaminarayan Temple)', 'Amar Mahal', 'Airoli', 'Borivali',
            'Vile Parle (Sahara Star)', 'Airport Terminal 1', 'Airport Terminal 2', 'Railway Station (Bandra Terminus)',
            'Railway Station (Kurla Terminus)', 'Railway station (LTT - Kurla)', 'railway station (ltt - kurla terminus)', 'Railway Station (CSMT)',
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
            'Railway Station (Kurla Terminus)', 'Railway station (LTT - Kurla)', 'railway station (ltt - kurla terminus)','Railway Station (CSMT)',
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
            'Railway Station (Kurla Terminus)', 'Railway station (LTT - Kurla)', 'railway station (ltt - kurla terminus)', 'Railway Station (CSMT)',
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
        replacements: { fetchDate }
      }
    );

    req.log.info('travel_fetch_booking_for_driver_success', { fetchDate, count: data.length });
    return res.status(200).send({ message: 'Fetched data', data });
  } catch (error) {
    req.log.error('travel_fetch_booking_for_driver_error', { error: error.message });
    return res.status(500).send({ message: 'Something went wrong', error });
  }
};

export const updateBookingStatus = async (req, res) => {
  const { bookingid, status, adminComments, description, charges, issueCredits } = req.body;
  let newBookingStatus = status;

  req.log.info('travel_update_booking_status_start', { bookingid, status, adminComments, issueCredits });

  const t = await database.transaction();
  req.transaction = t;

  const booking = await TravelDb.findOne({
    include: [
      {
        model: CardDb,
        attributes: ['issuedto']
      }
    ],
    where: {
      bookingid
    }
  });

  if (!booking) {
    req.log.warn('travel_update_booking_status_not_found', { bookingid });
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  const previousStatus = booking.status;

  if (status == booking.status) {
    req.log.warn('travel_update_booking_status_same', { bookingid, status });
    throw new ApiError(400, 'Status is same as before');
  }

  if ([STATUS_ADMIN_CANCELLED, STATUS_CANCELLED].includes(booking.status)) {
    if (!(booking.status === STATUS_CANCELLED && status === STATUS_ADMIN_CANCELLED)) {
      req.log.warn('travel_update_booking_status_already_cancelled', { bookingid, currentStatus: booking.status });
      throw new ApiError(400, ERR_BOOKING_ALREADY_CANCELLED);
    }
  }

  const cardno = booking.bookedBy || booking.cardno;
  const bookedByCard = await validateCard(cardno);
  let bookingWhichCameOutOfWaiting = null;
  let transaction = await Transactions.findOne({ where: { bookingid } });

  switch (status) {
    case STATUS_PROCEED_FOR_PAYMENT:
      if (!transaction) {
        transaction = (
          await createPendingTransaction(
            bookedByCard,
            booking,
            TYPE_TRAVEL,
            charges,
            req.user.username,
            t
          )
        ).transaction;
      }

      if (transaction.status === STATUS_PAYMENT_COMPLETED) {
        newBookingStatus = STATUS_CONFIRMED;
      }
      break;

    case STATUS_ADMIN_CANCELLED:
      if (transaction) {

        if (issueCredits === 'yes') {
          // Always cancel + issue credits
          await cancelTransaction(req.user, bookedByCard, transaction, t, true);
          break;
        }

        // issueCredits = "no"
        // ---- IMPORTANT FIX ----
        // If transaction is already completed, DO NOT update it.
        if ([STATUS_PAYMENT_COMPLETED, STATUS_CASH_COMPLETED].includes(transaction.status)) {
          // leave transaction untouched
          break;
        }

        // If transaction is pending or cash pending → mark admin cancelled
        await transaction.update(
          {
            status: STATUS_ADMIN_CANCELLED,
            updatedBy: req.user.username,
          },
          { transaction: t }
        );
      }
      break;

    case STATUS_SEATSFULL_CANCELLED:
      if (transaction) {
        await adminCancelTransaction(req.user, bookedByCard, transaction, t);
      }
      break;

    case STATUS_WRONGFORM_CANCELLED:
      if (transaction) {
        await adminCancelTransaction(req.user, bookedByCard, transaction, t);
      }
      break;

    case STATUS_CONFIRMED:
      if (
        transaction &&
        ![STATUS_PAYMENT_COMPLETED, STATUS_CASH_COMPLETED].includes(
          transaction.status
        )
      ) {
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

  const cancelledStatuses = [
    STATUS_ADMIN_CANCELLED,
    STATUS_SEATSFULL_CANCELLED,
    STATUS_WRONGFORM_CANCELLED,
    STATUS_CANCELLED
  ];

  if (
    cancelledStatuses.includes(
      newBookingStatus
    )
  ) {

    bookingWhichCameOutOfWaiting =
      await updateWaitingTravelBooking(
        booking,
        t
      );

    const bookingid =
      booking.bookingid;

    // REMOVE FROM BUS ASSIGNMENT

    const busAssignment =
      await TravelBusPassengers.findOne({

        where: {
          bookingid,
        },

        transaction: t,
      });

    if (busAssignment) {

      // REMOVE COORDINATOR

      await TravelBusGroup.update(

        {
          coordinator_bookingid:
            null,
        },

        {

          where: {

            id:
              busAssignment.bus_group_id,

            coordinator_bookingid:
              bookingid,
          },

          transaction: t,
        }
      );

      // REMOVE PASSENGER

      await TravelBusPassengers.destroy({

        where: {
          bookingid,
        },

        transaction: t,
      });

      req.log.info(

        'travel_admin_cancel_removed_from_bus',

        {
          bookingid,

          busGroupId:
            busAssignment.bus_group_id,
        }
      );
    }
  }

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


  await t.commit();
  req.log.info('travel_update_booking_status_transition', { bookingid, fromStatus: booking.status, toStatus: newBookingStatus });

  sendMail({
    email: card.email,
    subject: 'Raj Pravas - Travel Booking Updated',
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

  if (bookingWhichCameOutOfWaiting) {
    sendTravelBookingStatusUpdateMail(bookingWhichCameOutOfWaiting);
  }

  sendDualUserNotifications({
    primary: {
      cardno: booking.cardno,
      title: 'Raj Pravas Booking status update',
      body: `Your travel booking status has been changed to "${newBookingStatus}"`
    },
    bookedBy: booking.bookedBy && {
      cardno: booking.bookedBy,
      title: 'Raj Pravas Booking Cancelled',
      body: `Travel booking for ${booking.CardDb.issuedto.split(' ')[0]
        } has been updated to "${newBookingStatus}"`
    },
    screen: '/bookings'
  });

  try {
    await sendTravelStatusChangeWhatsApp(booking, previousStatus, { updatedBy: req.user.username });
  } catch (waErr) {
    console.error("Error triggering travel status change WhatsApp on admin update:", waErr);
  }

  req.log.info('travel_update_booking_status_success', { bookingid });
  return res.status(200).send({ message: MSG_UPDATE_SUCCESSFUL });
};

export const updateTransactionStatus = async (req, res) => {
  const { cardno, bookingid, type } = req.body;

  req.log.info('travel_update_transaction_status_start', { cardno, bookingid, type });

  const booking = await TravelDb.findOne({
    where: {
      bookingid,
      status: [STATUS_WAITING, STATUS_CONFIRMED]
    }
  });

  if (!booking) {
    req.log.warn('travel_update_transaction_status_booking_not_found', { bookingid });
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  const t = await database.transaction();
  req.transaction = t;

  const transaction = await Transactions.findOne({
    where: { cardno, bookingid, type }
  });

  if (!transaction) {
    req.log.warn('travel_update_transaction_status_transaction_not_found', { cardno, bookingid });
    throw new ApiError(404, ERR_TRANSACTION_NOT_FOUND);
  }

  await adminCancelTransaction(req.user, null, transaction, t);

  //TODO: send notification

  await t.commit();
  req.log.info('travel_update_transaction_status_success', { cardno, bookingid, amount: transaction.amount });
  return res.status(200).send({ message: MSG_UPDATE_SUCCESSFUL });
};



export async function updateBooking(req, res) {
  const t = await database.transaction();
  req.transaction = t;

  const {
    bookingid,
    amount,
    pickup_point,
    drop_point,
    type,
    date,
    bus_group_id,
    is_coordinator
  } = req.body;

  let removedFromOldBus = false;

  let matchingBus = null;

  req.log.info('travel_update_booking_start', { bookingid, amount, pickup_point, drop_point, type, date });

  if (!bookingid) {
    throw new ApiError(400, 'Booking ID is required');
  }

  const updatedFields = [];

  /* 1️⃣ TRANSACTION TABLE (amount) */
  if (amount !== undefined) {
    const transaction = await Transactions.findOne({
      where: { bookingid },
      transaction: t,
    });

    if (!transaction) {
      throw new ApiError(404, 'Transaction not found');
    }

    await transaction.update(
      {
        amount,
        updatedBy: req.user.username,
      },
      { transaction: t }
    );

    updatedFields.push('amount');
  }

  /* 2️⃣ TRAVEL TABLE (pickup / drop / type) */
  const travelUpdate = {};
  if (pickup_point !== undefined) travelUpdate.pickup_point = pickup_point;
  if (drop_point !== undefined) travelUpdate.drop_point = drop_point;
  if (type !== undefined) travelUpdate.type = type;
  if (date !== undefined) travelUpdate.date = date; // ✅ NEW

  if (Object.keys(travelUpdate).length > 0) {
    const travelBooking = await TravelDb.findOne({
      where: { bookingid },
      transaction: t,
    });

    if (!travelBooking) {
      throw new ApiError(404, 'Travel booking not found');
    }

    await travelBooking.update(travelUpdate, { transaction: t });

    if (
      pickup_point !== undefined ||
      drop_point !== undefined ||
      date !== undefined
    ) {
      const updatedPickup =
        pickup_point || travelBooking.pickup_point;

      const updatedDrop =
        drop_point || travelBooking.drop_point;

      const updatedDate =
        date || travelBooking.date;

      // Remove invalid bus assignment if route/date changed

      const busAssignment =
        await TravelBusPassengers.findOne({
          where: {
            bookingid,
          },
          include: [
            {
              model: TravelBusGroup,
              as: 'TravelBusGroup',
            },
          ],
          transaction: t,
        });

      if (busAssignment) {

        const bus = busAssignment.TravelBusGroup;

        let isValidRoute = true;

        // Date mismatch
        if (
          !moment(
            bus.event_date
          ).isSame(
            updatedDate,
            'day'
          )
        ) {
          isValidRoute = false;
        }

        // RC -> Mumbai
        else if (
          bus.pickup_point === 'Research Centre'
        ) {

          if (
            updatedDrop !== bus.drop_point
          ) {
            isValidRoute = false;
          }
        }

        // Mumbai -> RC
        else if (
          bus.drop_point === 'Research Centre'
        ) {

          if (
            updatedPickup !== bus.pickup_point
          ) {
            isValidRoute = false;
          }
        }

        if (!isValidRoute) {

          removedFromOldBus = true;

          // ALWAYS REMOVE INVALID ASSIGNMENT

          await TravelBusPassengers.destroy({
            where: {
              bookingid,
            },
            transaction: t,
          });

          // OPTIONAL NEW ASSIGNMENT

          if (
            bus_group_id !== undefined &&
            bus_group_id
          ) {

            // CHECK CAPACITY

            const selectedBus =
              await TravelBusGroup.findByPk(
                bus_group_id,
                {
                  include: [
                    {
                      model:
                        TravelBusPassengers,
                      as: 'passengers',
                    },
                  ],
                  transaction: t,
                }
              );

            if (!selectedBus) {

              throw new ApiError(
                404,
                'Bus not found'
              );
            }

            const passengerCount =
              selectedBus.passengers.length;

            const capacity =
              Number(selectedBus.capacity);

            if (
              passengerCount >= capacity
            ) {

              await t.rollback();

              return res.status(400).json({

                capacityExceeded: true,

                currentCapacity:
                  capacity,

                passengerCount,

                message:
                  'Bus capacity exceeded',
              });
            }

            await TravelBusPassengers.create(
              {
                bus_group_id,
                bookingid,
              },
              {
                transaction: t,
              }
            );
          }
        }

        // Check matching bus for new route
        const matchingBusWhere = {
          event_date: updatedDate,
        };

        // RC -> Mumbai
        if (
          updatedPickup === 'Research Centre'
        ) {

          matchingBusWhere.pickup_point =
            'Research Centre';

          matchingBusWhere.drop_point =
            updatedDrop;
        }

        // Mumbai -> RC
        else if (
          updatedDrop === 'Research Centre'
        ) {

          matchingBusWhere.pickup_point =
            updatedPickup;

          matchingBusWhere.drop_point =
            'Research Centre';
        }

        matchingBus =
          await TravelBusGroup.findOne({
            where: matchingBusWhere,
            transaction: t,
          });
      }
      updatedFields.push(...Object.keys(travelUpdate));

    }

    // MANUAL BUS CHANGE
    // EVEN IF ROUTE FIELDS DID NOT CHANGE

    if (
      bus_group_id !== undefined
    ) {

      const existingAssignment =
        await TravelBusPassengers.findOne({
          where: {
            bookingid,
          },
          transaction: t,
        });

      const alreadyAssignedToSameBus =
        existingAssignment &&
        existingAssignment.bus_group_id ==
        bus_group_id;

      if (!alreadyAssignedToSameBus) {

        await TravelBusPassengers.destroy({
          where: {
            bookingid,
          },
          transaction: t,
        });

        if (bus_group_id) {

          const selectedBus =
            await TravelBusGroup.findByPk(
              bus_group_id,
              {
                include: [
                  {
                    model:
                      TravelBusPassengers,
                    as: 'passengers',
                  },
                ],
                transaction: t,
              }
            );

          if (!selectedBus) {
            throw new ApiError(
              404,
              'Bus not found'
            );
          }

          const passengerCount =
            selectedBus.passengers.length;

          const capacity =
            Number(selectedBus.capacity);

          if (
            passengerCount >= capacity
          ) {

            await t.rollback();

            return res.status(400).json({
              capacityExceeded: true,

              currentCapacity:
                capacity,

              passengerCount,

              message:
                'Bus capacity exceeded',
            });
          }

          await TravelBusPassengers.create(
            {
              bus_group_id,
              bookingid,
            },
            {
              transaction: t,
            }
          );
        }

        updatedFields.push(
          'bus_group_id'
        );
      }

      // COORDINATOR UPDATE

      if (
        is_coordinator !== undefined
      ) {

        if (
          is_coordinator === 'yes'
        ) {

          await TravelBusGroup.update(
            {
              coordinator_bookingid:
                bookingid,
            },
            {
              where: {
                id: bus_group_id,
              },
              transaction: t,
            }
          );
        }

        else {

          await TravelBusGroup.update(
            {
              coordinator_bookingid:
                null,
            },
            {
              where: {
                id: bus_group_id,
                coordinator_bookingid:
                  bookingid,
              },
              transaction: t,
            }
          );
        }

        updatedFields.push(
          'is_coordinator'
        );
      }
    }
  }


  if (updatedFields.length === 0) {
    throw new ApiError(400, 'No fields provided to update');
  }

  await t.commit();

  req.log.info('travel_update_booking_success', { bookingid, updatedFields });
  return res.json({
    message: 'Booking updated successfully',
    updatedFields,

    removedFromOldBus,

    matchingBusAvailable:
      !!matchingBus,

    matchingBus,
  });
}

export async function createBusGroup(req, res) {
  const t = await database.transaction();

  try {
    const {
      event_date,
      bus_name,
      stops,
      capacity,
      notes,
      force_create,
      auto_assign = true,
      selected_bookingids = [],

    } = req.body;

    if (!event_date || !bus_name) {
      throw new ApiError(400, 'Event date and bus name are required');
    }

    if (
      !Array.isArray(stops) ||
      stops.length < 2
    ) {

      throw new ApiError(
        400,
        'Minimum 2 stops required'
      );
    }

    const existingBus = await TravelBusGroup.findOne({
      where: {
        event_date,
        bus_name,
      },
      transaction: t,
    });

    if (existingBus) {
      throw new ApiError(
        400,
        'Bus already exists for this date'
      );
    }

    const pickup_point =
      stops[0]?.stop_name;

    const drop_point =
      stops[
        stops.length - 1
      ]?.stop_name;

    const allBookings =
      await TravelDb.findAll({

        where: {

          date: event_date,

          status: {
            [Sequelize.Op.in]: [
              'confirmed',
              'proceed for payment'
            ]
          },
        },

        attributes: [
          'bookingid',
          'pickup_point',
          'drop_point',
        ],

        transaction: t,
      });

    const stopNames =
      stops.map(
        item => item.stop_name
      );

    for (
      let i = 1;
      i < stops.length;
      i++
    ) {

      const previousStop =
        stops[i - 1];

      const currentStop =
        stops[i];

      const previousTime =
        normalizeExcelTime(
          previousStop.timing
        );

      const currentTime =
        normalizeExcelTime(
          currentStop.timing
        );

      if (
        previousTime &&
        currentTime
      ) {

        const previousMinutes =

          Number(
            previousTime.split(':')[0]
          ) * 60 +

          Number(
            previousTime.split(':')[1]
          );

        const currentMinutes =

          Number(
            currentTime.split(':')[0]
          ) * 60 +

          Number(
            currentTime.split(':')[1]
          );

        if (
          currentMinutes <=
          previousMinutes
        ) {

          throw new ApiError(
            400,

            `Timing for stop ${currentStop.stop_name} must be after ${previousStop.stop_name}`
          );
        }
      }
    }

    const matchingBookings =
      allBookings.filter(
        booking => {
          const normalizedStops =
            stopNames.map(
              stop =>
                stop?.trim()?.toLowerCase()
            );

          const pickupIndex =
            normalizedStops.indexOf(
              booking.pickup_point
                ?.trim()
                ?.toLowerCase()
            );

          const dropIndex =
            normalizedStops.indexOf(
              booking.drop_point
                ?.trim()
                ?.toLowerCase()
            );

          return (

            pickupIndex !== -1 &&

            dropIndex !== -1 &&

            pickupIndex < dropIndex
          );
        }
      );

    const matchedPassengerCount =
      matchingBookings.length;

    // Capacity validation
    if (
      Number(capacity) < matchedPassengerCount &&
      !force_create
    ) {

      await t.rollback();

      return res.status(200).json({
        capacityExceeded: true,

        matchedPassengers:
          matchedPassengerCount,

        currentCapacity:
          Number(capacity),

        suggestedCapacity:
          matchedPassengerCount,
      });
    }


    const busGroup = await TravelBusGroup.create(
      {
        event_date,
        bus_name,
        pickup_point,
        drop_point,
        capacity,
        notes,
        createdBy: req.user.username,
      },
      {
        transaction: t,
      }
    );

    await TravelBusStops.bulkCreate(

      stops.map(
        (stop, index) => ({

          bus_group_id:
            busGroup.id,

          stop_name:
            stop.stop_name,

          timing:
            normalizeExcelTime(
              stop.timing
            ),

          stop_order:
            index + 1,
        })
      ),

      {
        transaction: t,
      }
    );

    // Auto assign matching passengers

    const filteredBookings =
      matchingBookings.filter(
        item =>

          selected_bookingids.length === 0 ||

          selected_bookingids.includes(
            item.bookingid
          )
      );

    const existingAssignments =
      await TravelBusPassengers.findAll({

        where: {

          bookingid:
            matchingBookings.map(
              item => item.bookingid
            ),
        },

        transaction: t,
      });



    const selectedBookingIds =
      req.body.selected_bookingids || [];

    const passengerMappings = [];

    for (const booking of matchingBookings) {

      // skip if unchecked in preview

      if (
        auto_assign &&
        selectedBookingIds.length &&
        !selectedBookingIds.includes(
          booking.bookingid
        )
      ) {
        continue;
      }
      const existingAssignment =
        existingAssignments.find(
          item =>
            item.bookingid ===
            booking.bookingid
        );

      // if already assigned and NOT selected
      // then ignore

      if (
        existingAssignment &&
        !selectedBookingIds.includes(
          booking.bookingid
        )
      ) {
        continue;
      }

      // if already assigned AND selected
      // remove old assignment first

      if (existingAssignment) {

        await TravelBusPassengers.destroy({

          where: {
            bookingid:
              booking.bookingid,
          },

          transaction: t,
        });
      }

      passengerMappings.push({

        bus_group_id:
          busGroup.id,

        bookingid:
          booking.bookingid,
      });
    }

    if (
      auto_assign &&
      passengerMappings.length > 0
    ) {

      await TravelBusPassengers.bulkCreate(

        passengerMappings,

        {
          transaction: t,
        }
      );
    }

    await t.commit();

    return res.status(201).json({
      message: `Bus created successfully. ${passengerMappings.length} passengers auto assigned.`,
      data: busGroup,
    });
  } catch (error) {
    await t.rollback();

    req.log.error('create_bus_group_error', {
      error: error.message,
    });

    return res.status(error.statusCode || 500).json({
      message: error.message || 'Internal server error',
    });
  }
}


export async function assignPassengersToBus(req, res) {
  const t = await database.transaction();

  try {
    const { bus_group_id, bookingids } = req.body;

    if (!bus_group_id) {
      throw new ApiError(400, 'Bus group ID is required');
    }

    if (!bookingids || !Array.isArray(bookingids) || bookingids.length === 0) {
      throw new ApiError(400, 'Booking IDs are required');
    }

    // Validate bus exists
    const busGroup = await TravelBusGroup.findByPk(bus_group_id, {
      transaction: t,
    });

    if (!busGroup) {
      throw new ApiError(404, 'Bus group not found');
    }

    // Prevent duplicate assignments
    const existingAssignments = await TravelBusPassengers.findAll({
      where: {
        bookingid: bookingids,
      },
      transaction: t,
    });

    if (existingAssignments.length > 0) {
      const alreadyAssigned = existingAssignments.map(
        item => item.bookingid
      );

      throw new ApiError(
        400,
        `Some bookings are already assigned: ${alreadyAssigned.join(', ')}`
      );
    }

    // Create mappings
    const passengerMappings = bookingids.map(bookingid => ({
      bus_group_id,
      bookingid,
    }));

    await TravelBusPassengers.bulkCreate(passengerMappings, {
      transaction: t,
    });

    await t.commit();

    return res.status(201).json({
      message: 'Passengers assigned successfully',
    });
  } catch (error) {
    await t.rollback();

    req.log.error('assign_passengers_error', {
      error: error.message,
    });

    return res.status(error.statusCode || 500).json({
      message: error.message || 'Internal server error',
    });
  }
}


export async function fetchBusGroupDetails(req, res) {
  try {
    const { id } = req.params;

    const busGroup = await TravelBusGroup.findOne({
      where: { id },

      include: [
        {
          model: TravelBusPassengers,
          as: 'passengers',
        },
        {
          model: TravelBusStops,
          as: 'stops',
        }
      ],
    });

    if (!busGroup) {
      throw new ApiError(404, 'Bus group not found');
    }

    // Get booking IDs
    const bookingids = busGroup.passengers.map(
      item => item.bookingid
    );

    // Fetch passenger details
    const passengers = await TravelDb.findAll({
      where: {
        bookingid: bookingids,
      },

      include: [
        {
          model: CardDb,
          attributes: ['issuedto', 'mobno', 'cardno'],
        },
      ],
    });

    // Coordinator details
    const coordinator = passengers.find(
      p => p.bookingid === busGroup.coordinator_bookingid
    );

    return res.json({
      bus: busGroup,
      coordinator,
      passengers,
    });
  } catch (error) {
    req.log.error('fetch_bus_group_details_error', {
      error: error.message,
    });

    return res.status(error.statusCode || 500).json({
      message: error.message || 'Internal server error',
    });
  }
}

export async function setBusCoordinator(req, res) {
  const t = await database.transaction();

  try {
    const { bus_group_id, bookingid } = req.body;

    if (!bus_group_id || !bookingid) {
      throw new ApiError(
        400,
        'Bus group ID and booking ID are required'
      );
    }

    // Validate bus exists
    const busGroup = await TravelBusGroup.findByPk(
      bus_group_id,
      {
        transaction: t,
      }
    );

    if (!busGroup) {
      throw new ApiError(404, 'Bus group not found');
    }

    // Validate passenger belongs to bus
    const passengerExists =
      await TravelBusPassengers.findOne({
        where: {
          bus_group_id,
          bookingid,
        },
        transaction: t,
      });

    if (!passengerExists) {
      throw new ApiError(
        400,
        'Passenger does not belong to this bus'
      );
    }

    await busGroup.update(
      {
        coordinator_bookingid: bookingid,
      },
      {
        transaction: t,
      }
    );

    await t.commit();

    return res.json({
      message: 'Coordinator assigned successfully',
    });
  } catch (error) {
    await t.rollback();

    req.log.error('set_bus_coordinator_error', {
      error: error.message,
    });

    return res.status(error.statusCode || 500).json({
      message: error.message || 'Internal server error',
    });
  }
}

export async function fetchAllBusGroups(req, res) {
  try {

    const busGroups =
      await TravelBusGroup.findAll({

        include: [
          {
            model: TravelBusPassengers,
            as: 'passengers',
          },
          {
            model: TravelBusStops,
            as: 'stops',
            separate: true,
            order: [
              ['stop_order', 'ASC']
            ],
          }
        ],

        order: [['event_date', 'DESC']],
      });

    return res.json({
      data: busGroups,
    });

  } catch (error) {

    req.log.error(
      'fetch_all_bus_groups_error',
      {
        error: error.message,
      }
    );

    return res.status(
      error.statusCode || 500
    ).json({
      message:
        error.message ||
        'Internal server error',
    });
  }
}

export async function fetchAvailableTravelBookings(req, res) {
  try {

    const { event_date } = req.query;

    if (!event_date) {
      throw new ApiError(400, 'Event date is required');
    }

    // Already assigned booking IDs
    // FETCH BUS GROUPS FOR SAME EVENT DATE

    const eventBusGroups =
      await TravelBusGroup.findAll({

        where: {
          event_date,
        },

        attributes: ['id'],
      });

    const busGroupIds =
      eventBusGroups.map(
        item => item.id
      );

    // FETCH ONLY ASSIGNMENTS
    // FOR THIS EVENT DATE

    const assignedPassengers =
      await TravelBusPassengers.findAll({

        where: {

          bus_group_id: {

            [Sequelize.Op.in]:
              busGroupIds,
          },
        },

        attributes: ['bookingid'],
      });

    const assignedBookingIds =
      assignedPassengers.map(
        item => item.bookingid
      );

    // Fetch confirmed travel bookings
    const busGroup = await TravelBusGroup.findByPk(
      req.query.bus_group_id
    );

    if (!busGroup) {
      throw new ApiError(404, 'Bus group not found');
    }

    const whereCondition = {
      date: event_date,
      status: {
        [Sequelize.Op.in]: [
          'confirmed',
          'proceed for payment'
        ]
      },
    };

    // Only exclude already-assigned bookings when there are any.
    // Op.notIn: [] resolves to NOT IN (NULL) on some Sequelize versions,
    // which matches zero rows and would hide all available bookings.
    if (assignedBookingIds.length > 0) {
      whereCondition.bookingid = {
        [Sequelize.Op.notIn]: assignedBookingIds,
      };
    }

    // RC → Mumbai
    if (
      busGroup.pickup_point === 'Research Centre'
    ) {
      whereCondition.drop_point = {
        [Sequelize.Op.ne]: 'Research Centre',
      };
    }

    // Mumbai → RC
    else if (
      busGroup.drop_point === 'Research Centre'
    ) {
      whereCondition.pickup_point = {
        [Sequelize.Op.ne]: 'Research Centre',
      };
    }

    const bookings = await TravelDb.findAll({
      where: whereCondition,

      include: [
        {
          model: CardDb,
          attributes: [
            'issuedto',
            'mobno',
            'cardno',
            'center',
          ],
        },
      ],

      order: [['pickup_point', 'ASC']],
    });

    return res.json({
      data: bookings,
    });

  } catch (error) {

    req.log.error(
      'fetch_available_travel_bookings_error',
      {
        error: error.message,
      }
    );

    return res
      .status(error.statusCode || 500)
      .json({
        message:
          error.message ||
          'Internal server error',
      });
  }
}


export async function removePassengerFromBus(
  req,
  res
) {

  const t = await database.transaction();

  try {

    const { bookingid } = req.params;

    const passenger =
      await TravelBusPassengers.findOne({
        where: {
          bookingid,
        },
        transaction: t,
      });

    if (!passenger) {
      throw new ApiError(
        404,
        'Passenger assignment not found'
      );
    }

    const bus =
      await TravelBusGroup.findByPk(
        passenger.bus_group_id,
        {
          transaction: t,
        }
      );

    await TravelBusPassengers.destroy({
      where: {
        bookingid,
      },
      transaction: t,
    });

    // Remove coordinator if same
    if (
      bus.coordinator_bookingid === bookingid
    ) {

      await bus.update(
        {
          coordinator_bookingid: null,
        },
        {
          transaction: t,
        }
      );
    }

    await t.commit();

    return res.json({
      message:
        'Passenger removed successfully',
    });

  } catch (error) {

    await t.rollback();

    return res.status(
      error.statusCode || 500
    ).json({
      message: error.message,
    });
  }
}

export async function updateBusCapacity(
  req,
  res
) {

  try {

    const {
      bus_group_id,
      capacity,
    } = req.body;

    const bus =
      await TravelBusGroup.findByPk(
        bus_group_id
      );

    if (!bus) {
      throw new ApiError(
        404,
        'Bus group not found'
      );
    }

    await bus.update({
      capacity,
    });

    return res.json({
      message:
        'Bus capacity updated successfully',
    });

  } catch (error) {

    return res.status(
      error.statusCode || 500
    ).json({
      message: error.message,
    });
  }
}


export async function updateBusGroup(
  req,
  res
) {

  const t =
    await database.transaction();

  try {

    const {
      bus_name,
      stops,
      timing,
      capacity,
      notes,
      auto_assign = false,
      remove_invalid = false,
    } = req.body;

    const bus =
      await TravelBusGroup.findByPk(
        req.params.id,
        {
          transaction: t,
        }
      );

    if (!bus) {
      throw new ApiError(
        404,
        'Bus not found'
      );
    }

    const pickup_point =
      stops[0]?.stop_name;

    const drop_point =
      stops[
        stops.length - 1
      ]?.stop_name;

    await bus.update({

      bus_name,

      pickup_point,

      drop_point,

      timing,

      capacity,

      notes,

      updatedBy:
        req.user.username,

    }, {
      transaction: t,
    });
    await TravelBusStops.destroy({

      where: {
        bus_group_id:
          bus.id,
      },

      transaction: t,
    });

    await TravelBusStops.bulkCreate(

      stops.map(
        (stop, index) => ({

          bus_group_id:
            bus.id,

          stop_name:
            stop.stop_name,

          timing:
            normalizeExcelTime(
              stop.timing
            ),

          stop_order:
            index + 1,
        })
      ),

      {
        transaction: t,
      }
    );

    // =====================================
    // ROUTE RECALCULATION
    // =====================================

    const allBookings =
      await TravelDb.findAll({

        where: {

          date:
            bus.event_date,

          status: {
            [Sequelize.Op.in]: [
              'confirmed',
              'proceed for payment',
            ],
          },
        },

        transaction: t,
      });

    const currentPassengers =
      await TravelBusPassengers.findAll({

        where: {
          bus_group_id:
            bus.id,
        },

        transaction: t,
      });

    const currentPassengerIds =
      currentPassengers.map(
        item => item.bookingid
      );

    const validBookingIds =
      [];

    const stopNames =
      stops.map(
        item => item.stop_name
      );

    for (
      let i = 1;
      i < stops.length;
      i++
    ) {

      const previousStop =
        stops[i - 1];

      const currentStop =
        stops[i];

      const previousTime =
        normalizeExcelTime(
          previousStop.timing
        );

      const currentTime =
        normalizeExcelTime(
          currentStop.timing
        );

      if (
        previousTime &&
        currentTime
      ) {

        const previousMinutes =

          Number(
            previousTime.split(':')[0]
          ) * 60 +

          Number(
            previousTime.split(':')[1]
          );

        const currentMinutes =

          Number(
            currentTime.split(':')[0]
          ) * 60 +

          Number(
            currentTime.split(':')[1]
          );

        if (
          currentMinutes <=
          previousMinutes
        ) {

          throw new ApiError(
            400,

            `Timing for stop ${currentStop.stop_name} must be after ${previousStop.stop_name}`
          );
        }
      }
    }

    const normalizedStops =
      stopNames.map(
        stop =>
          stop?.trim()?.toLowerCase()
      );

    for (const booking of allBookings) {

      const pickupIndex =
        normalizedStops.indexOf(
          booking.pickup_point
            ?.trim()
            ?.toLowerCase()
        );

      const dropIndex =
        normalizedStops.indexOf(
          booking.drop_point
            ?.trim()
            ?.toLowerCase()
        );

      const validRoute =

        pickupIndex !== -1 &&

        dropIndex !== -1 &&

        pickupIndex < dropIndex;

      if (validRoute) {

        validBookingIds.push(
          booking.bookingid
        );
      }
    }

    if (remove_invalid) {

      const invalidAssignedIds =
        currentPassengerIds.filter(
          id =>
            !validBookingIds.includes(
              id
            )
        );

      if (
        invalidAssignedIds.length
      ) {

        await TravelBusPassengers.destroy({

          where: {

            bus_group_id:
              bus.id,

            bookingid:
              invalidAssignedIds,
          },

          transaction: t,
        });
      }
    }
    if (auto_assign) {

      const existingAssignments =
        await TravelBusPassengers.findAll({

          where: {
            bookingid:
              validBookingIds,
          },

          transaction: t,
        });

      const alreadyAssignedIds =
        existingAssignments.map(
          item => item.bookingid
        );

      const availableBookingIds =
        validBookingIds.filter(
          id =>
            !alreadyAssignedIds.includes(
              id
            )
        );

      const latestPassengerCount =
        await TravelBusPassengers.count({

          where: {
            bus_group_id:
              bus.id,
          },

          transaction: t,
        });

      const remainingSeats =

        Number(capacity) -

        latestPassengerCount;

      const assignableIds =
        availableBookingIds.slice(
          0,
          remainingSeats
        );

      if (
        assignableIds.length
      ) {

        await TravelBusPassengers.bulkCreate(

          assignableIds.map(
            bookingid => ({

              bus_group_id:
                bus.id,

              bookingid,
            })
          ),

          {
            transaction: t,
          }
        );
      }
    }
    await t.commit();

    return res.status(200).send({
      message:
        'Bus updated successfully',
    });

  } catch (error) {

    await t.rollback();

    return res.status(
      error.statusCode || 500
    ).json({

      message:
        error.message,
    });
  }
}

export async function
  bulkAssignPassengersToBus(
    req,
    res
  ) {

  const t =
    await database.transaction();

  try {

    const {
      bus_group_id,
      bookingids,
      coordinator_bookingid,
    } = req.body;

    if (
      !bus_group_id
    ) {

      throw new ApiError(
        400,
        'Bus group ID required'
      );
    }

    if (
      !bookingids ||
      !Array.isArray(
        bookingids
      ) ||
      !bookingids.length
    ) {

      throw new ApiError(
        400,
        'Booking IDs required'
      );
    }

    const bus =
      await TravelBusGroup.findByPk(
        bus_group_id,
        {
          include: [
            {
              model:
                TravelBusPassengers,
              as: 'passengers',
            },
            {
              model:
                TravelBusStops,
              as: 'stops',
            },
          ],
          transaction: t,
        }
      );

    if (!bus) {

      throw new ApiError(
        404,
        'Bus not found'
      );
    }

    // EXISTING ASSIGNMENTS

    const existing =
      await TravelBusPassengers.findAll({

        where: {
          bookingid:
            bookingids,
        },

        transaction: t,
      });

    const existingIds =
      existing.map(
        item =>
          item.bookingid
      );

    const filteredBookingIds =
      bookingids.filter(
        id =>
          !existingIds.includes(
            id
          )
      );

    // VALID BOOKINGS

    const bookings =
      await TravelDb.findAll({

        where: {

          bookingid:
            filteredBookingIds,

          status: {
            [Sequelize.Op.in]: [
              'confirmed',
              'proceed for payment',
            ],
          },
        },

        transaction: t,
      });

    const validBookings = bookings.filter(
      booking => {

        // DATE CHECK

        if (
          String(booking.date)
            .split('T')[0] !==
          String(bus.event_date)
            .split('T')[0]
        ) {

          return false;
        }

        const stopNames =
          bus.stops
            .sort(
              (a, b) =>
                a.stop_order -
                b.stop_order
            )
            .map(
              stop => stop.stop_name
            );

        const pickupIndex =
          stopNames.indexOf(
            booking.pickup_point
          );

        const dropIndex =
          stopNames.indexOf(
            booking.drop_point
          );

        return (

          pickupIndex !== -1 &&

          dropIndex !== -1 &&

          pickupIndex < dropIndex
        );
      }
    );

    const validIds =
      validBookings.map(
        item => item.bookingid
      );
    const passengerCount =
      bus.passengers.length;

    const remainingSeats =
      Number(bus.capacity) -
      passengerCount;

    // TAKE ONLY FITTING PASSENGERS

    const assignableIds =
      validIds.slice(
        0,
        remainingSeats
      );

    // EXTRA PASSENGERS

    const skippedCapacityIds =
      validIds.slice(
        remainingSeats
      );

    const insertData =
      assignableIds.map(
        bookingid => ({
          bus_group_id,
          bookingid,
        })
      );

    if (
      insertData.length
    ) {

      await TravelBusPassengers.bulkCreate(
        insertData,
        {
          transaction: t,
        }
      );
    }

    // COORDINATOR

    if (
      coordinator_bookingid
    ) {

      await bus.update(
        {
          coordinator_bookingid,
        },
        {
          transaction: t,
        }
      );
    }

    await t.commit();

    return res.json({

      message:
        `${insertData.length} passengers assigned successfully`,

      skippedCapacityIds,
    });

  } catch (error) {

    await t.rollback();

    return res.status(
      error.statusCode || 500
    ).json({

      message:
        error.message,
    });
  }
}

export async function previewBulkUpload(
  req,
  res
) {

  try {

    const {
      bus_group_id,
      bookingids,
      coordinator_bookingid,
    } = req.body;

    if (
      !bus_group_id
    ) {

      throw new ApiError(
        400,
        'Bus group ID required'
      );
    }

    const bus =
      await TravelBusGroup.findByPk(
        bus_group_id,
        {
          include: [
            {
              model:
                TravelBusStops,
              as: 'stops',
            },
          ],
        }
      );

    if (!bus) {

      throw new ApiError(
        404,
        'Bus not found'
      );
    }

    // EXISTING ASSIGNMENTS

    const existingAssignments =
      await TravelBusPassengers.findAll({

        where: {
          bookingid:
            bookingids,
        },
      });

    const existingIds =
      existingAssignments.map(
        item =>
          item.bookingid
      );

    // FETCH BOOKINGS

    const bookings =
      await TravelDb.findAll({

        include: [
          {
            model: CardDb,
            attributes: [
              'issuedto',
            ],
          },
        ],

        where: {

          bookingid:
            bookingids,

          status: {
            [Sequelize.Op.in]: [
              'confirmed',
              'proceed for payment',
            ],
          },
        },
      });

    const rows = [];

    const validBookingIds =
      [];

    const alreadyAssigned =
      [];

    const wrongRoute =
      [];

    const wrongDate =
      [];

    const invalidBookingIds =
      [];

    for (const id of bookingids) {
      const excelRow =
        req.body.rows?.find(
          row => row.bookingid === id
        ) || {};

      const booking =
        bookings.find(
          item =>
            item.bookingid === id
        );

      // ALREADY ASSIGNED

      if (
        existingIds.includes(
          id
        )
      ) {

        alreadyAssigned.push(
          id
        );

        rows.push({

          bookingid: id,

          name:
            excelRow.name ||

            booking?.CardDb?.issuedto ||

            '',

          pickup_point:
            excelRow.pickup_point ||

            booking?.pickup_point ||

            '',

          drop_point:
            excelRow.drop_point ||

            booking?.drop_point ||

            '',

          status:
            booking?.status,

          result:
            'Already Assigned',

          isCoordinator:
            coordinator_bookingid ===
            id,
        });
        continue;
      }





      // INVALID

      if (!booking) {

        invalidBookingIds.push(
          id
        );

        rows.push({

          bookingid: id,

          name:
            excelRow.name ||

            booking?.CardDb?.issuedto ||

            '',

          pickup_point:
            excelRow.pickup_point ||

            booking?.pickup_point ||

            '',

          drop_point:
            excelRow.drop_point ||

            booking?.drop_point ||

            '',

          status:
            booking?.status,

          result:
            'Invalid',

          isCoordinator:
            coordinator_bookingid ===
            id,
        });
        continue;
      }

      // DATE CHECK

      if (

        String(
          booking.date
        ).split('T')[0]

        !==

        String(
          bus.event_date
        ).split('T')[0]
      ) {

        wrongDate.push(id);

        rows.push({

          bookingid: id,

          name:
            excelRow.name ||

            booking?.CardDb?.issuedto ||

            '',

          pickup_point:
            excelRow.pickup_point ||

            booking?.pickup_point ||

            '',

          drop_point:
            excelRow.drop_point ||

            booking?.drop_point ||

            '',

          status:
            booking?.status,

          result:
            'Wrong Date',

          isCoordinator:
            coordinator_bookingid ===
            id,
        });
        continue;
      }

      const stopNames =
        bus.stops
          .sort(
            (a, b) =>
              a.stop_order -
              b.stop_order
          )
          .map(
            stop => stop.stop_name
          );

      const pickupIndex =
        stopNames.indexOf(
          booking.pickup_point
        );

      const dropIndex =
        stopNames.indexOf(
          booking.drop_point
        );

      const validRoute =

        pickupIndex !== -1 &&

        dropIndex !== -1 &&

        pickupIndex < dropIndex;

      if (!validRoute) {

        wrongRoute.push(id);

        rows.push({

          bookingid: id,

          name:
            excelRow.name ||

            booking?.CardDb?.issuedto ||

            '',

          pickup_point:
            excelRow.pickup_point ||

            booking?.pickup_point ||

            '',

          drop_point:
            excelRow.drop_point ||

            booking?.drop_point ||

            '',

          status:
            booking?.status,

          result:
            'Wrong Route',

          isCoordinator:
            coordinator_bookingid ===
            id,
        });

        continue;
      }

      validBookingIds.push(
        id
      );

      rows.push({

        bookingid: id,

        name:
          excelRow.name ||

          booking?.CardDb?.issuedto ||

          '',

        pickup_point:
          excelRow.pickup_point ||

          booking.pickup_point ||

          '',

        drop_point:
          excelRow.drop_point ||

          booking.drop_point ||

          '',

        status:
          booking.status,

        result:
          'Valid',

        isCoordinator:
          coordinator_bookingid ===
          id,
      });
    }

    const passengerCount =
      await TravelBusPassengers.count({

        where: {
          bus_group_id,
        },
      });

    const remainingSeats =
      Number(bus.capacity) -
      passengerCount;

    const assignableIds =
      validBookingIds.slice(
        0,
        remainingSeats
      );


    const skippedCapacityIds =
      validBookingIds.slice(
        remainingSeats
      );

    rows.forEach(row => {

      if (
        skippedCapacityIds.includes(
          row.bookingid
        )
      ) {

        row.result =
          'Capacity Full';
      }
    });


    return res.json({

      validBookingIds:
        assignableIds,

      skippedCapacityIds,

      alreadyAssigned,

      wrongRoute,

      wrongDate,

      invalidBookingIds,

      coordinator_bookingid,

      remainingSeats,

      capacityExceeded:

        validBookingIds.length >
        remainingSeats,

      rows,
    });

  } catch (error) {

    return res.status(
      error.statusCode || 500
    ).json({

      message:
        error.message,
    });
  }
}

export async function exportBusPassengers(
  req,
  res
) {

  try {

    const busGroupId =
      req.params.id;

    const bus =
      await TravelBusGroup.findByPk(
        busGroupId
      );

    if (!bus) {

      throw new ApiError(
        404,
        'Bus not found'
      );
    }

    const assignments =
      await TravelBusPassengers.findAll({

        where: {
          bus_group_id:
            busGroupId,
        },
      });

    const bookingIds =
      assignments.map(
        item =>
          item.bookingid
      );

    const passengers =
      await TravelDb.findAll({

        where: {
          bookingid:
            bookingIds,
        },

        include: [
          {
            model: CardDb,
            attributes: [
              'issuedto',
              'mobno',
              'cardno',
            ],
          },
        ],
      });

    const excelData =
      passengers.map(
        passenger => {

          const assignment =
            assignments.find(
              item =>
                item.bookingid ===
                passenger.bookingid
            );

          return {

            Name:
              passenger.CardDb
                ?.issuedto || '',

            Mobile:
              passenger.CardDb
                ?.mobno || '',

            Pickup:
              passenger.pickup_point,

            Drop:
              passenger.drop_point,

            Status:
              passenger.status,

            Luggage:
              passenger.luggage,

            Comments:
              passenger.comments,

            Boarded:
              assignment?.boarded
                ? 'Yes'
                : 'No',

            Coordinator:
              bus.coordinator_bookingid ===
                passenger.bookingid
                ? 'Yes'
                : 'No',
          };
        }
      );

    const workbook =
      XLSX.utils.book_new();

    const worksheet =
      XLSX.utils.json_to_sheet(
        excelData
      );

    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      'Passengers'
    );

    const buffer =
      XLSX.write(
        workbook,
        {
          type: 'buffer',
          bookType: 'xlsx',
        }
      );

    res.setHeader(
      'Content-Disposition',
      `attachment; filename=${bus.bus_name}_passengers.xlsx`
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    return res.send(buffer);

  } catch (error) {

    return res.status(
      error.statusCode || 500
    ).json({

      message:
        error.message,
    });
  }
}

export async function
  deleteBusGroup(
    req,
    res
  ) {

  const t =
    await database.transaction();

  try {

    const busId =
      req.params.id;

    const bus =
      await TravelBusGroup.findByPk(
        busId,
        {
          transaction: t,
        }
      );

    if (!bus) {

      throw new ApiError(
        404,
        'Bus not found'
      );
    }

    // DELETE PASSENGERS

    await TravelBusPassengers.destroy({

      where: {
        bus_group_id:
          busId,
      },

      transaction: t,
    });

    // DELETE STOPS

    await TravelBusStops.destroy({

      where: {
        bus_group_id:
          busId,
      },

      transaction: t,
    });

    // DELETE BUS

    await bus.destroy({
      transaction: t,
    });

    await t.commit();

    return res.json({

      message:
        'Bus deleted successfully',
    });

  } catch (error) {

    await t.rollback();

    return res.status(
      error.statusCode || 500
    ).json({

      message:
        error.message,
    });
  }
}


export async function
  previewCreateBusGroup(
    req,
    res
  ) {

  try {

    const {
      event_date,
      stops,
      capacity,
    } = req.body;

    if (
      !event_date
    ) {

      throw new ApiError(
        400,
        'Event date required'
      );
    }

    if (
      !Array.isArray(stops) ||
      stops.length < 2
    ) {

      throw new ApiError(
        400,
        'Minimum 2 stops required'
      );
    }

    const bookings =
      await TravelDb.findAll({

        where: {

          date: event_date,

          status: {
            [Sequelize.Op.in]: [
              'confirmed',
              'proceed for payment',
            ],
          },
        },

        include: [
          {
            model: CardDb,
            attributes: [
              'issuedto',
              'cardno',
              'mobno',
            ],
          },
        ],
      });


    const stopNames =
      stops.map(
        item => item.stop_name
      );

    const existingAssignments =
      await TravelBusPassengers.findAll({

        where: {

          bookingid:
            bookings.map(
              item => item.bookingid
            ),
        },

        attributes: [
          'bookingid',
        ],
      });

    const rows = [];

    const validBookingIds = [];


    for (const booking of bookings) {

      const normalizedStops =
        stopNames.map(
          stop =>
            stop?.trim()?.toLowerCase()
        );

      const pickupIndex =
        normalizedStops.indexOf(
          booking.pickup_point
            ?.trim()
            ?.toLowerCase()
        );

      const dropIndex =
        normalizedStops.indexOf(
          booking.drop_point
            ?.trim()
            ?.toLowerCase()
        );

      const validRoute =

        pickupIndex !== -1 &&

        dropIndex !== -1 &&

        pickupIndex < dropIndex;

      if (!validRoute) {
        continue;
      }

      const existingAssignment =
        existingAssignments.find(
          item =>
            item.bookingid ===
            booking.bookingid
        );

      if (
        !existingAssignment
      ) {

        validBookingIds.push(
          booking.bookingid
        );
      }

      rows.push({

        bookingid:
          booking.bookingid,

        name:
          booking.CardDb
            ?.issuedto || '',

        cardno:
          booking.CardDb
            ?.cardno || '',

        mobile:
          booking.CardDb
            ?.mobno || '',

        pickup:
          booking.pickup_point,

        drop:
          booking.drop_point,

        status:
          booking.status,

        alreadyAssigned:
          !!existingAssignment,
      });
    }

    const remainingSeats =
      Number(capacity);

    const assignableIds =
      validBookingIds.slice(
        0,
        remainingSeats
      );

    const skippedCapacityIds =
      validBookingIds.slice(
        remainingSeats
      );

    return res.json({

      rows,

      totalMatching:
        rows.length,

      assignableCount:
        assignableIds.length,

      skippedCapacityCount:
        skippedCapacityIds.length,

      validBookingIds,

      assignableIds,

      skippedCapacityIds,
    });

  } catch (error) {

    return res.status(
      error.statusCode || 500
    ).json({

      message:
        error.message,
    });
  }
}

export async function previewUpdateBusGroup(
  req,
  res
) {

  const t =
    await database.transaction();
  try {

    const {
      bus_group_id,
      stops,
      capacity,
    } = req.body;

    const bus =
      await TravelBusGroup.findByPk(
        bus_group_id,
        {
          include: [
            {
              model:
                TravelBusPassengers,
              as: 'passengers',
            },
          ],
        }
      );

    if (!bus) {

      throw new ApiError(
        404,
        'Bus not found'
      );
    }

    const bookings =
      await TravelDb.findAll({

        where: {

          date:
            bus.event_date,

          status: {
            [Sequelize.Op.in]: [
              'confirmed',
              'proceed for payment',
            ],
          },
        },

        include: [
          {
            model: CardDb,
            attributes: [
              'issuedto',
              'cardno',
              'mobno',
            ],
          },
        ],
      });

    const stopNames =
      stops.map(
        item => item.stop_name
      );

    const currentAssignedIds =
      bus.passengers.map(
        item =>
          item.bookingid
      );

    const newlyMatching =
      [];

    const noLongerMatching =
      [];

    const allAssignments =
      await TravelBusPassengers.findAll({
        transaction: t,
      });

    const assignedBookingIds =
      allAssignments.map(
        item => item.bookingid
      );

    for (const booking of bookings) {

      const normalizedStops =
        stopNames.map(
          stop =>
            stop?.trim()?.toLowerCase()
        );

      const pickupIndex =
        normalizedStops.indexOf(
          booking.pickup_point
            ?.trim()
            ?.toLowerCase()
        );

      const dropIndex =
        normalizedStops.indexOf(
          booking.drop_point
            ?.trim()
            ?.toLowerCase()
        );
      const validRoute =

        pickupIndex !== -1 &&

        dropIndex !== -1 &&

        pickupIndex <
        dropIndex;

      const isAssigned =
        currentAssignedIds.includes(
          booking.bookingid
        );

      // NEW MATCH

      if (
        validRoute &&
        !isAssigned
      ) {

        newlyMatching.push({

          bookingid:
            booking.bookingid,

          name:
            booking.CardDb
              ?.issuedto || '',

          cardno:
            booking.CardDb
              ?.cardno || '',

          pickup:
            booking.pickup_point,

          drop:
            booking.drop_point,

          alreadyAssigned:
            assignedBookingIds.includes(
              booking.bookingid
            ),
        });
      }

      // NO LONGER MATCHING

      if (
        !validRoute &&
        isAssigned
      ) {

        noLongerMatching.push({

          bookingid:
            booking.bookingid,

          name:
            booking.CardDb
              ?.issuedto || '',

          cardno:
            booking.CardDb
              ?.cardno || '',

          pickup:
            booking.pickup_point,

          drop:
            booking.drop_point,
        });
      }
    }

    const remainingSeats =

      Number(capacity) -

      (
        bus.passengers.length -

        noLongerMatching.length
      );

    const assignable =
      newlyMatching.slice(
        0,
        remainingSeats
      );

    const overflow =
      newlyMatching.slice(
        remainingSeats
      );

    await t.commit();
    return res.json({

      newlyMatching,

      noLongerMatching,

      assignable,

      overflow,
    });

  } catch (error) {
    await t.rollback();
    return res.status(
      error.statusCode || 500
    ).json({

      message:
        error.message,
    });
  }
}


export async function
  previewBulkMasterUpload(
    req,
    res
  ) {

  try {

    const {
      buses,
      assignments,
    } = req.body;

    const reassignmentMap = {};
    const groupedBuses = {};


    for (const row of buses) {

      const key =
        `${row['Bus Name']}__${row['Event Date']}`;

      if (!groupedBuses[key]) {

        groupedBuses[key] = {

          bus_name:
            row['Bus Name'],

          event_date:
            row['Event Date'],

          capacity:
            Number(row['Capacity']),

          stops: [],
        };
      }

      groupedBuses[key].stops.push({

        stop_order:
          Number(row['Stop Order']),

        stop_name:
          row['Stop Name'],

        timing:
          normalizeExcelTime(
            row['Timing']
          ),
      });
    }

    const parsedBuses =
      Object.values(groupedBuses);

    for (const assignment of assignments) {

      reassignmentMap[
        assignment['Booking Id']
      ] = assignment['Bus Name'];
    }


    const previewBuses = [];

    for (const item of parsedBuses) {

      item.stops.sort(
        (a, b) =>
          a.stop_order - b.stop_order
      );

      const stopNames =
        item.stops.map(
          stop => stop.stop_name
        );

      item.bookingids =
        Array.from(
          new Set(

            assignments

              .filter(
                assignment =>

                  assignment[
                  'Bus Name'
                  ] ===
                  item.bus_name
              )

              .map(
                assignment =>
                  assignment[
                  'Booking Id'
                  ]
              )

              .filter(Boolean)

          )
        );

      const VALID_STOPS = [

        'Research Centre',

        'Dadar (Swaminarayan Temple)',

        'Amar Mahal',

        'Airoli',

        'Vile Parle (Sahara Star)',

        'Airport Terminal 1',

        'Airport Terminal 2',

        'Railway Station (Bandra Terminus)',

        'Railway Station (LTT - Kurla Terminus)',

        'Railway Station (CSMT)',

        'Railway Station (Mumbai Central)',

        'Other (enter location in comments)',

        'Dadar (Pritam Da Dhaba)',

        'Borivali (Indraprasth Shopping Centre)',

        'Mulund (Sarvoday Nagar)',

        'Railway Station (Kurla Terminus)',
      ];

      const invalidStops =
        stopNames.filter(
          stop =>
            !VALID_STOPS.includes(
              stop
            )
        );

      const missingTiming =
        item.stops.some(
          stop => !stop.timing
        );

      if (missingTiming) {

        item.routeError =
          'Missing timing';
      }

      const duplicateStops =
        stopNames.filter(
          (stop, index) =>

            stopNames.indexOf(
              stop
            ) !== index
        );

      for (
        let i = 1;
        i < item.stops.length;
        i++
      ) {

        const previousStop =
          item.stops[i - 1];

        const currentStop =
          item.stops[i];

        const previousTime =
          normalizeExcelTime(
            previousStop.timing
          );

        const currentTime =
          normalizeExcelTime(
            currentStop.timing
          );

        currentTime <= previousTime

      }

      if (
        item.stops.length < 2
      ) {

        item.routeError =
          'Minimum 2 stops required';
      }

      if (

        !stopNames.includes(
          'Research Centre'
        )
      ) {

        item.routeError =
          'Research Centre missing in route';
      }

      if (

        item.stops.some(
          stop => !stop.stop_name
        )
      ) {

        item.routeError =
          'Empty stop found';
      }

      if (
        duplicateStops.length
      ) {

        item.routeError =
          'Duplicate stops found';
      }
      if (
        invalidStops.length
      ) {

        item.routeError =
          `Invalid stop(s): ${invalidStops.join(', ')}`;
      }

      const existingBus =
        await TravelBusGroup.findOne({

          where: {

            event_date:
              item.event_date,

            bus_name:
              item.bus_name,
          },
        });

      item.duplicateBus =
        !!existingBus;

      const validPassengers =
        [];

      const invalidPassengers =
        [];

      const alreadyAssigned =
        [];

      for (
        const bookingid
        of item.bookingids
      ) {

        const booking =
          await TravelDb.findOne({

            where: {
              bookingid,
            },

            include: [
              {
                model: CardDb,
                attributes: [
                  'issuedto',
                  'cardno',
                ],
              },
            ],
          });

        if (!booking) {

          invalidPassengers.push({

            bookingid,

            reason:
              'Booking not found',

            name: '',

            pickup: '',

            drop: '',
          });

          continue;
        }

        const pickupIndex =
          stopNames.indexOf(
            booking.pickup_point
          );

        const dropIndex =
          stopNames.indexOf(
            booking.drop_point
          );

        const validRoute =

          pickupIndex !== -1 &&

          dropIndex !== -1 &&

          pickupIndex < dropIndex;

        if (!validRoute) {

          invalidPassengers.push({

            bookingid,

            name:
              booking.CardDb
                ?.issuedto || '',

            pickup:
              booking.pickup_point,

            drop:
              booking.drop_point,

            reason:
              'Route mismatch',
          });
          continue;
        }

        const existing =
          await TravelBusPassengers.findOne({

            where: {
              bookingid,
            },

            include: [
              {
                model: TravelBusGroup,
                as: 'TravelBusGroup',
              },
            ],
          });
        if (existing) {

          const existingBus =
            existing.TravelBusGroup;

          const sameBus =

            existingBus?.bus_name ===
            item.bus_name &&

            String(
              existingBus?.event_date
            ).split('T')[0] ===

            String(
              item.event_date
            ).split('T')[0];

          // SAME BUS
          // SHOW ALREADY ASSIGNED

          const targetBusFromExcel =
            reassignmentMap[
            booking.bookingid
            ];

          if (
            sameBus &&
            targetBusFromExcel ===
            item.bus_name
          ) {

            alreadyAssigned.push({

              bookingid:
                booking.bookingid,

              name:
                booking.CardDb
                  ?.issuedto || '',

              pickup:
                booking.pickup_point,

              drop:
                booking.drop_point,
            });

            continue;
          }

          // DIFFERENT BUS
          // REASSIGN ALLOWED

          if (
            req.body.update_existing
          ) {

            validPassengers.push({

              bookingid:
                booking.bookingid,

              name:
                booking.CardDb
                  ?.issuedto || '',

              pickup:
                booking.pickup_point,

              drop:
                booking.drop_point,
            });

            continue;
          }

          // DIFFERENT BUS
          // BUT UPDATE NOT ALLOWED

          alreadyAssigned.push({

            bookingid:
              booking.bookingid,

            name:
              booking.CardDb
                ?.issuedto || '',

            pickup:
              booking.pickup_point,

            drop:
              booking.drop_point,
          });

          continue;
        }
        if (
          !validPassengers.some(
            item =>

              item.bookingid ===
              booking.bookingid
          )
        ) {

          validPassengers.push({

            bookingid:
              booking.bookingid,

            name:
              booking.CardDb
                ?.issuedto || '',

            pickup:
              booking.pickup_point,

            drop:
              booking.drop_point,
          });
        }
      }

      const overflowPassengers =
        validPassengers.slice(
          item.capacity
        );

      previewBuses.push({

        ...item,

        validPassengers:
          validPassengers.slice(
            0,
            item.capacity
          ),

        overflowPassengers,

        invalidPassengers,

        alreadyAssigned,
      });
    }

    return res.json({
      buses:
        previewBuses,
    });

  } catch (error) {

    return res.status(
      error.statusCode || 500
    ).json({

      message:
        error.message,
    });
  }
}

export async function
  createBulkMasterUpload(
    req,
    res
  ) {

  let createdBuses = 0;

  let assignedPassengers = 0;

  let skippedDuplicateBuses = 0;

  let skippedAssignedPassengers = 0;
  const t =
    await database.transaction();

  try {

    const {
      buses,
      update_existing = false,
    } = req.body;

    const parsedBuses = buses;

    for (const item of parsedBuses) {

      const stopNames =
        item.stops.map(
          stop => stop.stop_name
        );


      for (
        let i = 1;
        i < item.stops.length;
        i++
      ) {

        const previousStop =
          item.stops[i - 1];

        const currentStop =
          item.stops[i];

        const previousTime =
          previousStop.timing;

        const currentTime =
          currentStop.timing;

        if (
          previousTime &&
          currentTime &&
          currentTime <= previousTime
        ) {

          throw new ApiError(
            400,

            `Timing sequence invalid in ${item.bus_name}. ` +

            `${currentStop.stop_name} (${currentTime}) ` +

            `must be after ` +

            `${previousStop.stop_name} (${previousTime})`
          );
        }
      }


      const VALID_STOPS = [

        'Research Centre',

        'Dadar (Swaminarayan Temple)',

        'Amar Mahal',

        'Airoli',

        'Vile Parle (Sahara Star)',

        'Airport Terminal 1',

        'Airport Terminal 2',

        'Railway Station (Bandra Terminus)',

        'Railway Station (LTT - Kurla Terminus)',

        'Railway Station (CSMT)',

        'Railway Station (Mumbai Central)',

        'Other (enter location in comments)',

        'Dadar (Pritam Da Dhaba)',

        'Borivali (Indraprasth Shopping Centre)',

        'Mulund (Sarvoday Nagar)',

        'Railway Station (Kurla Terminus)',
      ];

      const invalidStops =
        stopNames.filter(
          stop =>
            !VALID_STOPS.includes(
              stop
            )
        );

      const missingTiming =
        item.stops.some(
          stop =>

            stop.timing === undefined ||

            stop.timing === null ||

            stop.timing === ''
        );

      if (missingTiming) {

        throw new ApiError(
          400,
          `Missing timing in ${item.bus_name}`
        );
      }

      if (invalidStops.length) {

        throw new ApiError(

          400,

          `Invalid stop(s): ${invalidStops.join(', ')}`
        );
      }// DUPLICATE BUS CHECK

      const existingBus =
        await TravelBusGroup.findOne({

          where: {

            event_date:
              item.event_date,

            bus_name:
              item.bus_name,
          },

          transaction: t,
        });
      if (
        existingBus &&
        !update_existing
      ) {

        skippedDuplicateBuses++;

        continue;
      }

      let bus = null;

      // UPDATE EXISTING BUS

      if (
        existingBus &&
        update_existing
      ) {

        bus = existingBus;

        await bus.update({

          pickup_point:
            item.stops[0].stop_name,

          drop_point:
            item.stops[
              item.stops.length - 1
            ].stop_name,

          capacity:
            item.capacity,

          updatedBy:
            req.user.username,

        }, {
          transaction: t,
        });

        await TravelBusStops.destroy({

          where: {
            bus_group_id:
              bus.id,
          },

          transaction: t,
        });


        await TravelBusGroup.update(
          {
            coordinator_bookingid:
              null,
          },
          {
            where: {
              id: bus.id,
            },
            transaction: t,
          }
        );
      } else {

        // CREATE NEW BUS

        bus =
          await TravelBusGroup.create({

            event_date:
              item.event_date,

            bus_name:
              item.bus_name,

            pickup_point:
              item.stops[0].stop_name,

            drop_point:
              item.stops[
                item.stops.length - 1
              ].stop_name,

            capacity:
              item.capacity,

            createdBy:
              req.user.username,

          }, {
            transaction: t,
          });

        createdBuses++;
      }
      // CREATE STOPS

      await TravelBusStops.bulkCreate(
        item.stops.map(
          (stop, index) => ({

            bus_group_id:
              bus.id,

            stop_name:
              stop.stop_name,

            timing:
              normalizeExcelTime(
                stop.timing
              ),

            stop_order:
              index + 1,
          })
        ),

        {
          transaction: t,
        }
      );

      // CREATE PASSENGERS

      if (
        item.bookingids?.length
      ) {

        const uniquePassengers =
          Array.from(
            new Set(

              (item.validPassengers || [])
                .map(
                  passenger =>
                    passenger.bookingid
                )
            )
          ).map(
            bookingid => ({
              bookingid
            })
          );

        const existingPassengerAssignments =
          await TravelBusPassengers.findAll({

            where: {

              bookingid:
                uniquePassengers.map(
                  item => item.bookingid
                ),
            },

            transaction: t,
          });

        const finalPassengers = [];

        for (const passenger of uniquePassengers) {

          const existingAssignment =
            existingPassengerAssignments.find(
              item =>
                item.bookingid === passenger.bookingid
            );

          // REASSIGNMENT CASE

          if (
            existingAssignment &&
            update_existing
          ) {

            // REMOVE FROM OLD BUS

            await TravelBusPassengers.destroy({
              where: {
                bookingid:
                  passenger.bookingid,
              },
              transaction: t,
            });

            finalPassengers.push({
              bus_group_id:
                bus.id,

              bookingid:
                passenger.bookingid,
            });

            continue;
          }

          // ALREADY ASSIGNED BUT NO UPDATE

          if (
            existingAssignment &&
            !update_existing
          ) {

            skippedAssignedPassengers++;

            continue;
          }

          // NORMAL NEW ASSIGNMENT

          finalPassengers.push({
            bus_group_id:
              bus.id,

            bookingid:
              passenger.bookingid,
          });
        }

        if (finalPassengers.length > 0) {

          await TravelBusPassengers.bulkCreate(
            finalPassengers,
            {
              transaction: t,
            }
          );

          assignedPassengers +=
            finalPassengers.length;
        }

      }


    } await t.commit();

    return res.json({

      message:

        `${createdBuses} buses created, ` +

        `${assignedPassengers} passengers assigned, ` +

        `${skippedDuplicateBuses} duplicate buses skipped`,
    });
  } catch (error) {

    await t.rollback();

    req.log.error('travel_bulk_master_create_error', { error: error.message });

    return res.status(
      error.statusCode || 500
    ).json({

      message:
        error.message,

      errors:
        error.errors || null,
    });
  }
}