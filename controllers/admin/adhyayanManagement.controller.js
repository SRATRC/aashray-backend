import {
  AdhyayanFeedback,
  CardDb,
  ShibirDb,
  ShibirBookingDb,
  Transactions,
  ShibirAttendanceDb,
  ShibirSession,
  ShibirAttendanceRecord,
  WaGroupJob
} from '../../models/associations.js';
import {
  STATUS_WAITING,
  STATUS_CONFIRMED,
  STATUS_PAYMENT_PENDING,
  STATUS_ADMIN_CANCELLED,
  STATUS_PAYMENT_COMPLETED,
  STATUS_CANCELLED,
  STATUS_CASH_COMPLETED,
  STATUS_CASH_PENDING,
  TYPE_ADHYAYAN,
  ERR_BOOKING_ALREADY_CANCELLED,
  MSG_FETCH_SUCCESSFUL,
  RESEARCH_CENTRE
} from '../../config/constants.js';
import {
  adminCancelTransaction,
  createPendingTransaction
} from '../../helpers/transactions.helper.js';
import {
  reserveAdhyayanSeat,
  openAdhyayanSeat,
  validateAdhyayanBooking,
  validateAdhyayans,
  sendAdhyayanBookingUpdateNotification,
  bookAdhyayanForMumukshusAdmin,
  createShibirAttendanceEntry,
  resetShibirAttendance,
  initializeShibirSessions
} from '../../helpers/adhyayanBooking.helper.js';
import { validateCard } from '../../helpers/card.helper.js';
import { sendUnifiedWhatsApp } from '../../helpers/whatsapp.helper.js';
import { getFeedbackStats } from '../../helpers/adhyayanBooking.helper.js';
import {
  sendDualUserNotifications,
  sendPushNotifications
} from '../../helpers/notification.helper.js';
import Sequelize, { QueryTypes } from 'sequelize';
import database from '../../config/database.js';
import ApiError from '../../utils/ApiError.js';
import moment from 'moment';

export const createAdhyayan = async (req, res) => {
  const {
    name,
    start_date,
    end_date,
    speaker,
    amount,
    location,
    total_seats,
    food_allowed,
    comments
  } = req.body;

  req.log.info('create_adhyayan_start', { name, speaker, start_date, end_date, total_seats, amount });

  const alreadyExists = await ShibirDb.findOne({
    where: {
      speaker: { [Sequelize.Op.like]: speaker },
      start_date: start_date
    }
  });
  if (alreadyExists) {
    req.log.warn('create_adhyayan_already_exists', { speaker, start_date });
    throw new ApiError(400, 'Adhyayan Already Exists');
  }

  const month = moment(start_date).format('MMMM');
  const t = await database.transaction();

  try {
    const adhyayan_details = await ShibirDb.create({
      name: name,
      speaker: speaker,
      month: month,
      start_date: start_date,
      end_date: end_date,
      location: location,
      total_seats: total_seats,
      amount: amount,
      available_seats: total_seats,
      food_allowed: food_allowed,
      comments: comments,
      updatedBy: req.user.username
    }, { transaction: t });

    // Initialize sessions immediately on creation if it's Research Centre
    if (location === RESEARCH_CENTRE) {
      await initializeShibirSessions(adhyayan_details, t);
    }

    await t.commit();

    try {
      await WaGroupJob.create({
        action: 'create_group',
        status: 'pending',
        payload: {
          name: `${name} - ${moment(start_date).format('DD MMM YYYY')}`,
          type: 'shibir',
          eventId: adhyayan_details.id
        }
      });
    } catch (waJobErr) {
      req.log.error('Failed to queue WhatsApp group creation for Shibir', { error: waJobErr.message });
    }

    req.log.info('create_adhyayan_success', { adhyayanId: adhyayan_details.id, name, speaker });
    res.status(200).send({ message: 'Created Adhyayan', data: adhyayan_details });
  } catch (error) {
    await t.rollback();
    req.log.error('create_adhyayan_failed', { name, speaker, error: error.message });
    throw error;
  }
};

export const fetchALLAdhyayan = async (req, res) => {
  req.log.info('fetch_all_adhyayan_start');
  const shibirs = await database.query(
    `SELECT 
      shibir_db.id,
      shibir_db.name,
      shibir_db.speaker,
      shibir_db.month,
      shibir_db.start_date,
      shibir_db.end_date,
      shibir_db.location,
      shibir_db.total_seats,
      shibir_db.available_seats,
      COUNT(CASE WHEN shibir_booking_db.status IN ('confirmed', 'cash completed') THEN 1 END) AS confirmed_count,
      COUNT(CASE WHEN shibir_booking_db.status = '${STATUS_WAITING}' THEN 1 END) AS waitlist_count,
      COUNT(CASE WHEN shibir_booking_db.status = '${STATUS_PAYMENT_PENDING}' THEN 1 END) AS pending_count,
      shibir_db.food_allowed,
      shibir_db.comments,
      shibir_db.status,
      shibir_db.updatedBy,
      shibir_db.whatsapp_group_jid
    FROM 
      shibir_db
    LEFT JOIN 
      shibir_booking_db ON shibir_db.id = shibir_booking_db.shibir_id
    WHERE 
      shibir_db.start_date >= CURRENT_DATE - INTERVAL 7 DAY
    GROUP BY 
      shibir_db.id,
      shibir_db.name,
      shibir_db.speaker,
      shibir_db.month,
      shibir_db.start_date,
      shibir_db.end_date,
      shibir_db.location,
      shibir_db.total_seats,
      shibir_db.available_seats,
      shibir_db.food_allowed,
      shibir_db.comments,
      shibir_db.status,
      shibir_db.updatedBy,
      shibir_db.whatsapp_group_jid
    ORDER BY 
      shibir_db.start_date ASC;`,
    {
      type: QueryTypes.SELECT
    }
  );

  req.log.info('fetch_all_adhyayan_success', { count: shibirs.length });
  return res.status(200).send({ message: 'Fetched Results', data: shibirs });
};

export const fetchAdhyayanByLocation = async (req, res) => {
  const { location } = req.query;
  req.log.info('fetch_adhyayan_by_location_start', { location });

  if (!location) {
    req.log.warn('fetch_adhyayan_by_location_missing_param');
    return res.status(400).send({ message: 'Location is required' });
  }

  const shibirs = await database.query(
    `SELECT 
      shibir_db.id,
      shibir_db.name,
      shibir_db.speaker,
      shibir_db.month,
      shibir_db.start_date,
      shibir_db.end_date,
      shibir_db.location,
      shibir_db.total_seats,
      shibir_db.available_seats,
      COUNT(CASE WHEN shibir_booking_db.status IN ('confirmed', 'cash completed') THEN 1 END) AS confirmed_count,
      COUNT(CASE WHEN shibir_booking_db.status = '${STATUS_WAITING}' THEN 1 END) AS waitlist_count,
      COUNT(CASE WHEN shibir_booking_db.status = '${STATUS_PAYMENT_PENDING}' THEN 1 END) AS pending_count,
      COUNT(CASE WHEN shibir_booking_db.status = '${STATUS_CANCELLED}' THEN 1 END) AS selfcancel_count,
      COUNT(CASE WHEN shibir_booking_db.status = '${STATUS_ADMIN_CANCELLED}' THEN 1 END) AS admin_cancelled_count,
      shibir_db.food_allowed,
      shibir_db.comments,
      shibir_db.status,
      shibir_db.updatedBy
    FROM 
      shibir_db
    LEFT JOIN 
      shibir_booking_db ON shibir_db.id = shibir_booking_db.shibir_id
    WHERE 
      shibir_db.start_date >= CURRENT_DATE - INTERVAL 15 DAY
      AND shibir_db.location = :location
    GROUP BY 
      shibir_db.id,
      shibir_db.name,
      shibir_db.speaker,
      shibir_db.month,
      shibir_db.start_date,
      shibir_db.end_date,
      shibir_db.location,
      shibir_db.total_seats,
      shibir_db.available_seats,
      shibir_db.food_allowed,
      shibir_db.comments,
      shibir_db.status,
      shibir_db.updatedBy
    ORDER BY
      shibir_db.start_date ASC;`,
    {
      type: QueryTypes.SELECT,
      replacements: { location }
    }
  );

  if (shibirs.length > 0) {
    const shibirIds = shibirs.map(s => s.id);
    const sessions = await ShibirSession.findAll({
      where: { shibir_id: shibirIds },
      order: [['session_number', 'ASC']]
    });

    // Group sessions by shibir_id
    const sessionsByShibir = {};
    for (const session of sessions) {
      if (!sessionsByShibir[session.shibir_id]) {
        sessionsByShibir[session.shibir_id] = [];
      }
      sessionsByShibir[session.shibir_id].push({
        session_number: session.session_number,
        type: session.type,
        date: session.date,
        start_time: session.start_time
      });
    }

    // Attach sessions to each shibir
    for (const shibir of shibirs) {
      shibir.sessions = sessionsByShibir[shibir.id] || [];
    }
  }

  req.log.info('fetch_adhyayan_by_location_success', { location, count: shibirs.length });
  return res.status(200).send({ message: 'Fetched Results', data: shibirs });
};

export const fetchPGS = async (req, res) => {
  req.log.info('fetch_pgs_start');
  const shibirs = await database.query(
    `SELECT 
      shibir_db.id,
      shibir_db.name,
      shibir_db.speaker,
      shibir_db.month,
      shibir_db.start_date,
      shibir_db.end_date,
      shibir_db.location,
      shibir_db.total_seats,
      shibir_db.available_seats,
      COUNT(CASE WHEN shibir_booking_db.status IN ('confirmed', 'cash completed') THEN 1 END) AS confirmed_count,
      COUNT(CASE WHEN shibir_booking_db.status = '${STATUS_WAITING}' THEN 1 END) AS waitlist_count,
      COUNT(CASE WHEN shibir_booking_db.status = '${STATUS_PAYMENT_PENDING}' THEN 1 END) AS pending_count,
      shibir_db.food_allowed,
      shibir_db.comments,
      shibir_db.status,
      shibir_db.updatedBy
    FROM 
      shibir_db
    LEFT JOIN 
      shibir_booking_db ON shibir_db.id = shibir_booking_db.shibir_id
    WHERE 
      shibir_db.start_date >= CURRENT_DATE - INTERVAL 30 DAY
      AND shibir_db.name LIKE 'Param Gyaan Sabha%'  -- only PGS entries
    GROUP BY 
      shibir_db.id,
      shibir_db.name,
      shibir_db.speaker,
      shibir_db.month,
      shibir_db.start_date,
      shibir_db.end_date,
      shibir_db.location,
      shibir_db.total_seats,
      shibir_db.available_seats,
      shibir_db.food_allowed,
      shibir_db.comments,
      shibir_db.status,
      shibir_db.updatedBy
    ORDER BY 
      shibir_db.start_date ASC;`,
    {
      type: QueryTypes.SELECT
    }
  );

  req.log.info('fetch_pgs_success', { count: shibirs.length });
  return res.status(200).send({ message: 'Fetched Results', data: shibirs });
};

export const fetchAdhyayan = async (req, res) => {
  const { id } = req.params;
  req.log.info('fetch_adhyayan_start', { id });
  await validateAdhyayans(id);

  const adhyayan = await ShibirDb.findOne({
    where: { id: id }
  });

  req.log.info('fetch_adhyayan_success', { id });
  return res.status(200).send({ message: 'Fetched Adhyayan', data: adhyayan });
};

export const fetchAdhyayanBookings = async (req, res) => {
  const shibir_id = req.query.shibir_id;
  let status = req.query.status;
  req.log.info('fetch_adhyayan_bookings_start', { shibir_id, status });
  if (status != null || status != undefined) {
    status = status.replace(/^"|"$/g, '');
    status = status.trim();
  }
  let statusToBeIncluded = [STATUS_CONFIRMED, STATUS_CASH_COMPLETED];

  if (status === 'waiting') {
    statusToBeIncluded = [STATUS_WAITING];
  } else if (status === 'pending') {
    statusToBeIncluded = [STATUS_PAYMENT_PENDING, STATUS_CASH_PENDING];
  } else if (status === 'cancelled') {
    statusToBeIncluded = [STATUS_CANCELLED];
  } else if (status === 'admin cancelled' || status === 'admin_cancelled') {
    statusToBeIncluded = [STATUS_ADMIN_CANCELLED];
  }

  const page = parseInt(req.query.page) || req.body.page || 1;
  const pageSize = parseInt(req.query.page_size) || req.body.page_size || 10;
  const offset = (page - 1) * pageSize;
  await validateAdhyayans(shibir_id);

  const adhyayanData = await database.query(
    `SELECT 
      t1.bookingid, 
      t1.shibir_id, 
      t1.bookedby, 
      t1.status, 
      t1.createdAt,
      t1.updatedAt,
      t2.cardno, 
      t2.issuedto, 
      t2.mobno, 
      t2.gender, 
      t2.center, 
      t2.res_status,
      t3.name,
      t4.status AS transaction_status,
      t4.description as comments,
      sa.id AS attendance_id
   FROM shibir_booking_db AS t1
   LEFT JOIN card_db AS t2 
      ON t1.cardno = t2.cardno 
   LEFT JOIN shibir_db AS t3 
      ON t1.shibir_id = t3.id 
   LEFT JOIN transactions AS t4
      ON t1.bookingid = t4.bookingid
   LEFT JOIN shibir_attendance_db AS sa
      ON t1.bookingid = sa.bookingid
   WHERE 
      t1.shibir_id = :shibirId 
      AND t1.status IN (:status)
      ORDER BY t1.createdAt ASC
   `,
    {
      replacements: {
        shibirId: shibir_id,
        status: statusToBeIncluded,
        pageSize,
        page: offset
      },
      raw: true,
      type: QueryTypes.SELECT
    }
  );


  req.log.info('fetch_adhyayan_bookings_success', { shibir_id, status, count: adhyayanData.length });
  return res
    .status(200)
    .send({ message: 'Found Adhyayan Bookings', data: adhyayanData });
};

export const updateAdhyayan = async (req, res) => {
  const {
    name,
    start_date,
    end_date,
    speaker,
    amount,
    location,
    total_seats,
    food_allowed,
    comments,
    available_seats // optional manual override
  } = req.body;

  const adhyayanId = req.params.id;
  req.log.info('update_adhyayan_start', { adhyayanId, name, total_seats, amount });
  const adhyayan = (await validateAdhyayans(adhyayanId))[0];

  const month = moment(start_date).format('MMMM');

  // 🧩 If total_seats changed, adjust available_seats accordingly
  let newAvailableSeats;
  if (total_seats != adhyayan.total_seats) {
    const diff = total_seats - adhyayan.total_seats;
    newAvailableSeats = Math.max(0, adhyayan.available_seats + diff);
  }
  // 🧩 If total_seats is same, allow manual update if provided
  else if (available_seats !== undefined && available_seats !== null) {
    newAvailableSeats = available_seats;
  }
  // 🧩 Otherwise, retain existing available seats
  else {
    newAvailableSeats = adhyayan.available_seats;
  }

  // Guard against changing duration if attendance records already exist
  const oldStartDate = moment(adhyayan.start_date).startOf('day');
  const oldEndDate = moment(adhyayan.end_date).startOf('day');
  const oldDays = oldEndDate.diff(oldStartDate, 'days') + 1;

  const newStartDate = moment(start_date).startOf('day');
  const newEndDate = moment(end_date).startOf('day');
  const newDays = newEndDate.diff(newStartDate, 'days') + 1;

  if (oldDays !== newDays) {
    const attendanceExists = await ShibirAttendanceRecord.findOne({
      where: { shibir_id: adhyayanId }
    });
    if (attendanceExists) {
      req.log.warn('update_adhyayan_failed_duration_change_attendance_exists', { adhyayanId, oldDays, newDays });
      return res.status(400).send({
        message: 'Cannot change shibir duration because attendance records already exist'
      });
    }
  }

  const t = await database.transaction();
  try {
    await adhyayan.update({
      name,
      speaker,
      month,
      start_date,
      end_date,
      location,
      total_seats,
      amount,
      available_seats: newAvailableSeats,
      food_allowed,
      comments,
      updatedBy: req.user.username
    }, { transaction: t });

    // Sync sessions immediately on date/duration changes
    if (location === RESEARCH_CENTRE) {
      await initializeShibirSessions({ id: adhyayan.id, start_date, end_date }, t);
    } else {
      // If changed away from Research Centre, clear sessions and attendance records
      await ShibirSession.destroy({ where: { shibir_id: adhyayan.id }, transaction: t });
      await ShibirAttendanceRecord.destroy({ where: { shibir_id: adhyayan.id }, transaction: t });
    }

    await t.commit();
    req.log.info('update_adhyayan_success', { adhyayanId, newAvailableSeats });
    res.status(200).send({ message: 'Updated Adhyayan' });
  } catch (error) {
    await t.rollback();
    req.log.error('update_adhyayan_failed', { adhyayanId, error: error.message });
    throw error;
  }
};

export const adhyayanWaitlist = async (req, res) => {
  req.log.info('fetch_adhyayan_waitlist_start');
  const today = moment().format('YYYY-MM-DD');

  const data = await database.query(
    `SELECT t1.bookingid, t1.shibir_id, t1.bookedby, t1.status, t2.id, t2.name, t2.speaker, 
    t2.start_date, t2.end_date, t3.cardno, t3.issuedto, t3.mobno, t3.center, t3.res_status
    FROM shibir_booking_db AS t1
    LEFT JOIN shibir_db AS t2 
    ON t1.shibir_id = t2.id 
    AND t2.start_date >= :date
    LEFT JOIN card_db AS t3 
    ON t1.cardno = t3.cardno 
    WHERE t1.status = :status`,
    {
      replacements: { date: today, status: STATUS_WAITING },
      raw: true,
      type: QueryTypes.SELECT
    }
  );
  req.log.info('fetch_adhyayan_waitlist_success', { count: data.length });
  res.status(200).send({ message: 'Fetched Adhyayan', data: data });
};

export const adhyayanPendinglist = async (req, res) => {
  req.log.info('fetch_adhyayan_pendinglist_start');
  const today = moment().format('YYYY-MM-DD');

  const data = await database.query(
    `SELECT t1.bookingid, t1.shibir_id, t1.bookedby, t1.status, t2.id, t2.name, t2.speaker, 
    t2.start_date, t2.end_date, t3.cardno, t3.issuedto, t3.mobno, t3.center, t3.res_status
    FROM shibir_booking_db AS t1
    LEFT JOIN shibir_db AS t2 
    ON t1.shibir_id = t2.id 
    AND t2.start_date >= :date
    LEFT JOIN card_db AS t3 
    ON t1.cardno = t3.cardno 
    WHERE t1.status = :statuses`,
    {
      replacements: {
        date: today,
        statuses: [STATUS_PAYMENT_PENDING, STATUS_CASH_PENDING]
      },
      raw: true,
      type: QueryTypes.SELECT
    }
  );
  req.log.info('fetch_adhyayan_pendinglist_success', { count: data.length });
  res.status(200).send({ message: 'Fetched Adhyayan', data: data });
};

export const adhyayanStatusUpdate = async (req, res) => {
  const { shibir_id, bookingid, status, description } = req.body;
  req.log.info('adhyayan_status_update_start', { shibir_id, bookingid, newStatus: status });

  var newBookingStatus = status;
  let newBooking = null;
  const t = await database.transaction();
  req.transaction = t;

  // Store notification data to send after transaction commit
  const notificationData = [];

  const adhyayan = (await validateAdhyayans(shibir_id))[0];
  const booking = await validateAdhyayanBooking(bookingid, shibir_id);
  const previousStatus = booking.status;

  if (status == booking.status) {
    req.log.warn('adhyayan_status_update_same_status', { bookingid, status });
    throw new ApiError(400, 'Status is same as before');
  }

  if (
    booking.status == STATUS_ADMIN_CANCELLED ||
    booking.status == STATUS_CANCELLED
  ) {
    req.log.warn('adhyayan_status_update_already_cancelled', { bookingid, currentStatus: booking.status });
    throw new ApiError(400, ERR_BOOKING_ALREADY_CANCELLED);
  }

  req.log.info('adhyayan_status_update_transition', { bookingid, fromStatus: booking.status, toStatus: status });

  var transaction = await Transactions.findOne({
    where: { bookingid: bookingid }
  });

  const cardno = booking.bookedBy || booking.cardno;
  const bookedByCard = await validateCard(cardno);

  switch (status) {
    // Only Waiting & Payment Pending booking can be changed to Confirmed
    case STATUS_CONFIRMED:
      if (booking.status == STATUS_WAITING) {
        await reserveAdhyayanSeat(adhyayan, t);
      }

      if (!transaction) {
        transaction = await createPendingTransaction(
          bookedByCard,
          booking,
          TYPE_ADHYAYAN,
          adhyayan.amount,
          req.user.username,
          t,
          true
        );
      }

      if (
        transaction.status === STATUS_PAYMENT_PENDING ||
        transaction.status === STATUS_CASH_PENDING
      ) {
        await transaction.update(
          {
            status: STATUS_PAYMENT_COMPLETED,
            description: description,
            updatedBy: req.user.username
          },
          { transaction: t }
        );
      }
      await ensureAttendanceEntry(booking, req.user, t);

      break;

    case STATUS_PAYMENT_PENDING:
      if (booking.status == STATUS_CONFIRMED) {
        throw new ApiError(
          400,
          "Confirmed booking's status cannot be changed to Payment Pending"
        );
      }

      // Only Waiting booking can be changed to Payment Pending
      if (booking.status == STATUS_WAITING) {
        await reserveAdhyayanSeat(adhyayan, t);

        if (!transaction) {
          transaction = await createPendingTransaction(
            bookedByCard,
            booking,
            TYPE_ADHYAYAN,
            adhyayan.amount,
            req.user.username,
            t,
            true
          );
        }

        // After applying credits, if the transaction is complete
        // then confirm the booking.
        if (transaction.status == STATUS_PAYMENT_COMPLETED) {
          newBookingStatus = STATUS_CONFIRMED;
          await ensureAttendanceEntry(booking, req.user, t);

          sendDualUserNotifications({
            primary: {
              cardno: booking.cardno,
              title: 'Adhyayan Booking Confirmed',
              body: 'Your adhyayan booking has been confirmed.'
            },
            bookedBy: booking.bookedBy && {
              token: bookedByCard.token,
              title: 'Adhyayan Booking Confirmed',
              body: `Adhyayan booking for ${booking.CardDb.issuedto.split(' ')[0]
                } has been confirmed.`
            },
            screen: '/bookings'
          });
        }
      }

      break;

    case STATUS_ADMIN_CANCELLED:
      if (
        booking.status == STATUS_CONFIRMED ||
        booking.status == STATUS_PAYMENT_PENDING
      ) {
        newBooking = await openAdhyayanSeat(adhyayan, req.user.username, t);

      }

      await resetShibirAttendance(booking.bookingid, req.user.username, t);

      if (transaction) {
        await adminCancelTransaction(req.user, bookedByCard, transaction, t);
      }
      break;

    case STATUS_WAITING:
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

  await t.commit();

  // Send notifications and emails after transaction commit
  try {

    await sendAdhyayanBookingUpdateNotification(booking, adhyayan, true, previousStatus);
    // Send notification and email for new booking if exists
    if (newBooking) {
      await sendAdhyayanBookingUpdateNotification(newBooking, adhyayan, true, 'waiting');
    }
  } catch (error) {
    // Log error but don't fail the response since transaction is already committed
    req.log.error('adhyayan_status_update_notification_error', { bookingid, error: error.message });
  }

  req.log.info('adhyayan_status_update_success', { bookingid, shibir_id, finalStatus: newBookingStatus });
  return res.status(200).send({ message: 'Updated booking status' });
};

export const activateAdhyayan = async (req, res) => {
  const { id, activate } = req.params;
  req.log.info('activate_adhyayan_start', { adhyayanId: id, activateStatus: activate });

  const itemUpdated = await ShibirDb.update(
    {
      status: activate,
      updatedBy: req.user.username
    },
    {
      where: {
        id: id
      }
    }
  );

  if (itemUpdated != 1) {
    req.log.error('activate_adhyayan_failed', { adhyayanId: id });
    throw new ApiError(500, 'Error occured while activating adhyayan');
  }
  req.log.info('activate_adhyayan_success', { adhyayanId: id, activateStatus: activate });
  res.status(200).send({ message: 'Adhyayan status updated' });
};

export const fetchAllAdhyayanList = async (req, res) => {
  req.log.info('fetch_all_adhyayan_list_start');
  const adhyayans = await database.query(
    `SELECT id, name FROM shibir_db ORDER BY id ASC`,
    {
      type: QueryTypes.SELECT,
      raw: true
    }
  );

  req.log.info('fetch_all_adhyayan_list_success', { count: adhyayans.length });
  return res.status(200).json({
    message: 'Fetched adhyayan list',
    data: adhyayans
  });
};

export const softDeleteShibir = async (req, res) => {
  const { id } = req.params;
  req.log.info('soft_delete_shibir_start', { shibirId: id });

  const updated = await ShibirDb.update(
    { status: 'deleted' },
    { where: { id } }
  );

  if (updated[0] === 0) {
    req.log.warn('soft_delete_shibir_not_found', { shibirId: id });
    return res.status(404).json({ message: 'Shibir not found' });
  }

  // Notify all users who have bookings for this adhyayan (rate-limited)
  try {
    const shibirId = parseInt(id);
    const bookings = await ShibirBookingDb.findAll({
      where: {
        shibir_id: shibirId,
        status: { [Sequelize.Op.in]: ['waiting', 'confirmed', 'pending'] }
      },
      attributes: ['cardno', 'bookedBy']
    });

    const recipients = new Set();
    for (const b of bookings) {
      if (b.cardno) recipients.add(b.cardno);
      if (b.bookedBy) recipients.add(b.bookedBy);
    }

    if (recipients.size > 0) {
      const cards = await CardDb.findAll({
        where: { cardno: { [Sequelize.Op.in]: Array.from(recipients) } },
        attributes: ['token']
      });

      const tokens = cards.map((c) => c.token).filter(Boolean);
      if (tokens.length > 0) {
        sendPushNotifications(tokens, {
          title: 'Adhyayan Cancelled by Admin',
          body: 'Your adhyayan booking has been cancelled by admin. We apologize for any inconvenience.',
          screen: '/bookings'
        });
      }
    }
  } catch (notifyErr) {
    req.log.error('soft_delete_shibir_notification_failed', { shibirId: id, error: notifyErr.message });
  }

  req.log.info('soft_delete_shibir_success', { shibirId: id });
  res.status(200).json({ message: 'Shibir marked as deleted' });
};


export const getAdhyayanFeedback = async (req, res) => {
  const { shibir_id } = req.params;
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 20;
  const offset = (page - 1) * pageSize;
  req.log.info('get_adhyayan_feedback_start', { shibir_id, page, pageSize });

  if (!shibir_id) {
    req.log.warn('get_adhyayan_feedback_missing_id');
    throw new ApiError(400, 'Adhyayan ID is required');
  }

  const feedback = await AdhyayanFeedback.findAll({
    where: { shibir_id: parseInt(shibir_id) },
    attributes: [
      'shibir_id',
      'cardno',
      'swadhay_karta_rating',
      'personal_interaction_rating',
      'swadhay_karta_suggestions',
      'raj_adhyayan_interest',
      'future_topics',
      'loved_most',
      'improvement_suggestions',
      'food_rating',
      'stay_rating',
      'submitted_at'
    ],
    include: [
      {
        model: CardDb,
        attributes: ['cardno', 'issuedto', 'mobno', 'gender', 'res_status', 'center'] // added res_status and center
      },
      {
        model: ShibirDb,
        attributes: ['id', 'name'] // just the name
      }
    ],
    order: [['submitted_at', 'DESC']],
    offset,
    limit: pageSize
  });

  const totalCount = await AdhyayanFeedback.count({
    where: { shibir_id: parseInt(shibir_id) }
  });

  const stats = await getFeedbackStats(parseInt(shibir_id));

  req.log.info('get_adhyayan_feedback_success', { shibir_id, feedbackCount: feedback.length, totalCount });
  return res.status(200).send({
    message: MSG_FETCH_SUCCESSFUL,
    data: {
      feedback,
      stats,
      pagination: {
        page,
      }
    }
  });
};

export const markAdhyayanAttendance = async (req, res) => {
  const { shibir_id, session_no, cardno } = req.params;
  const sessionNo = Number(session_no);
  req.log.info('mark_adhyayan_attendance_start', { shibir_id, session_no: sessionNo, cardno });

  const t = await database.transaction();
  req.transaction = t;

  const shibir = await ShibirDb.findByPk(shibir_id, { transaction: t });
  if (!shibir) {
    throw new ApiError(404, 'Shibir not found');
  }

  const session = await ShibirSession.findOne({
    where: { shibir_id, session_number: sessionNo },
    transaction: t
  });

  if (!session) {
    req.log.warn('mark_adhyayan_attendance_session_not_found', { shibir_id, sessionNo });
    throw new ApiError(400, `Session ${sessionNo} not found for this Shibir`);
  }

  const attendance = await ShibirAttendanceDb.findOne({
    where: { shibir_id, cardno },
    include: [
      {
        model: ShibirBookingDb,
        required: true,
        where: { status: [STATUS_CONFIRMED, STATUS_CASH_COMPLETED] }
      }
    ],
    transaction: t
  });

  if (!attendance) {
    req.log.warn('mark_adhyayan_attendance_record_not_found', { shibir_id, cardno });
    throw new ApiError(404, 'Attendance record not found');
  }

  const existingRecord = await ShibirAttendanceRecord.findOne({
    where: { shibir_id, bookingid: attendance.bookingid, session_number: sessionNo },
    transaction: t
  });

  if (existingRecord && existingRecord.attended) {
    req.log.warn('mark_adhyayan_attendance_already_marked', { shibir_id, cardno, sessionNo });
    throw new ApiError(400, `Attendance already marked for session ${sessionNo}`);
  }

  const card = await CardDb.findOne({
    where: { cardno },
    transaction: t
  });

  await ShibirAttendanceRecord.upsert(
    {
      shibir_id,
      bookingid: attendance.bookingid,
      cardno,
      session_number: sessionNo,
      attended: true,
      updatedBy: req.user.cardno || req.user.username
    },
    { transaction: t }
  );

  if (sessionNo <= 9) {
    const attendanceField = `session_${sessionNo}_attendance`;
    await attendance.update(
      {
        [attendanceField]: true,
        updatedBy: req.user.cardno || req.user.username
      },
      { transaction: t }
    );
  }

  await t.commit();

  req.log.info('mark_adhyayan_attendance_success', { shibir_id, cardno, sessionNo, participantName: card?.issuedto });
  return res.status(200).send({
    message: 'Attendance marked successfully',
    participantName: card?.issuedto || cardno,
    shibirName: shibir?.name || `Shibir ${shibir_id}`,
    session: sessionNo
  });
};

export const fetchAdhyayanAttendanceReport = async (req, res) => {
  const { shibir_id } = req.params;
  req.log.info('fetch_adhyayan_attendance_report_start', { shibir_id });

  const shibir = await ShibirDb.findByPk(shibir_id);
  if (!shibir) {
    req.log.warn('fetch_adhyayan_attendance_report_not_found', { shibir_id });
    throw new ApiError(404, 'Adhyayan not found');
  }

  let sessions = await ShibirSession.findAll({
    where: { shibir_id },
    order: [['session_number', 'ASC']]
  });

  if (sessions.length === 0) {
    const t = await database.transaction();
    req.transaction = t;
    try {
      await initializeShibirSessions(shibir, t);
      await t.commit();
      sessions = await ShibirSession.findAll({
        where: { shibir_id },
        order: [['session_number', 'ASC']]
      });
    } catch (err) {
      req.log.error('initialize_shibir_sessions_failed', { shibir_id, error: err.message });
      throw err;
    }
  }

  const attendanceRows = await ShibirAttendanceDb.findAll({
    where: { shibir_id },
    include: [
      {
        model: CardDb,
        attributes: ['cardno', 'issuedto', 'mobno', 'gender', 'center', 'res_status']
      },
      {
        model: ShibirBookingDb,
        required: true,
        attributes: ['status'],
        where: { status: STATUS_CONFIRMED }
      }
    ],
    order: [['cardno', 'ASC']]
  });

  const logs = await ShibirAttendanceRecord.findAll({
    where: { shibir_id, attended: true }
  });

  const logsMap = new Set(logs.map(l => `${l.bookingid}_${l.session_number}`));

  const reportData = attendanceRows.map(row => {
    const data = {
      cardno: row.cardno,
      name: row.CardDb?.issuedto || '',
      mobno: row.CardDb?.mobno || '',
      gender: row.CardDb?.gender || '',
      centre: row.CardDb?.center || '',
      res_status: row.CardDb?.res_status || ''
    };

    sessions.forEach(s => {
      const key = `${row.bookingid}_${s.session_number}`;
      data[`session_${s.session_number}`] = logsMap.has(key) ? 'Yes' : 'No';
    });

    return data;
  });

  req.log.info('fetch_adhyayan_attendance_report_success', { shibir_id, rowCount: reportData.length });
  return res.status(200).send({
    shibirName: shibir.name,
    speaker: shibir.speaker,
    startDate: shibir.start_date,
    endDate: shibir.end_date,
    maxSessions: sessions.length,
    sessions: sessions.map(s => ({
      session_number: s.session_number,
      type: s.type,
      date: s.date,
      start_time: s.start_time
    })),
    data: reportData
  });
};

export async function fetchAdhyayanAttendanceSummary(req, res) {
  const { shibir_id } = req.params;
  req.log.info('fetch_adhyayan_attendance_summary_start', { shibir_id });

  const shibir = await ShibirDb.findByPk(shibir_id);
  if (!shibir) {
    req.log.warn('fetch_adhyayan_attendance_summary_not_found', { shibir_id });
    return res.status(404).json({ message: 'Shibir not found' });
  }

  let sessions = await ShibirSession.findAll({
    where: { shibir_id },
    order: [['session_number', 'ASC']]
  });

  if (sessions.length === 0) {
    const t = await database.transaction();
    req.transaction = t;
    try {
      await initializeShibirSessions(shibir, t);
      await t.commit();
      sessions = await ShibirSession.findAll({
        where: { shibir_id },
        order: [['session_number', 'ASC']]
      });
    } catch (err) {
      req.log.error('initialize_shibir_sessions_failed', { shibir_id, error: err.message });
      throw err;
    }
  }

  const attendanceRows = await ShibirAttendanceDb.findAll({
    where: { shibir_id },
    include: [
      {
        model: ShibirBookingDb,
        required: true,
        attributes: ['status'],
        where: { status: STATUS_CONFIRMED }
      }
    ]
  });

  const totalRegistrants = attendanceRows.length;

  const attendedCounts = await ShibirAttendanceRecord.findAll({
    attributes: [
      'session_number',
      [Sequelize.fn('COUNT', Sequelize.col('ShibirAttendanceRecord.id')), 'count']
    ],
    where: { shibir_id, attended: true },
    include: [
      {
        model: ShibirBookingDb,
        as: 'booking',
        required: true,
        where: { status: STATUS_CONFIRMED },
        attributes: []
      }
    ],
    group: ['session_number']
  });

  const countMap = new Map(
    attendedCounts.map(c => [Number(c.getDataValue('session_number')), Number(c.getDataValue('count'))])
  );

  const summary = sessions.map(s => {
    const attendedCount = countMap.get(s.session_number) || 0;
    const absenteesCount = Math.max(0, totalRegistrants - attendedCount);

    return {
      session: `Session ${s.session_number}`,
      session_number: s.session_number,
      type: s.type,
      total_registrants: totalRegistrants,
      total_attended: attendedCount,
      total_absentees: absenteesCount
    };
  });

  req.log.info('fetch_adhyayan_attendance_summary_success', { shibir_id, totalRegistrants: attendanceRows.length });
  return res.status(200).json({
    data: {
      shibir_name: shibir.name,
      summary
    }
  });
}

export const createAdhyayanBookingByAdmin = async (req, res) => {
  const { shibir_ids, mumukshus } = req.body;
  req.log.info('create_adhyayan_booking_by_admin_start', { shibir_ids, mumukshuCount: mumukshus?.length });

  if (
    !Array.isArray(shibir_ids) ||
    shibir_ids.length === 0 ||
    !Array.isArray(mumukshus) ||
    mumukshus.length === 0
  ) {
    req.log.warn('create_adhyayan_booking_by_admin_invalid_input', { shibir_ids, mumukshus });
    return res.status(400).send({
      message: 'Invalid input'
    });
  }

  const t = await database.transaction();
  req.transaction = t;

  try {
    const result = await bookAdhyayanForMumukshusAdmin(
      shibir_ids,
      mumukshus,
      t,
      req.user
    );

    await t.commit();

    // Send WhatsApp notifications after successful transaction commit
    try {
      const allBookingIds = Object.values(result.userBookingIds).flat();
      if (allBookingIds.length > 0) {
        const bookings = await ShibirBookingDb.findAll({
          where: { bookingid: allBookingIds },
          include: [{ model: ShibirDb, as: 'ShibirDb' }]
        });

        const bookingsByCard = {};
        for (const booking of bookings) {
          if (!bookingsByCard[booking.cardno]) {
            bookingsByCard[booking.cardno] = [];
          }
          bookingsByCard[booking.cardno].push(booking);
        }

        const jobs = [];
        for (const cardno of Object.keys(bookingsByCard)) {
          jobs.push(sendUnifiedWhatsApp(cardno, bookingsByCard[cardno]));
        }
        // Run all notification jobs in parallel (non-blocking)
        Promise.allSettled(jobs).then((results) => {
          results.forEach((r, i) => {
            if (r.status === 'rejected') {
              req.log.error('create_adhyayan_booking_by_admin_whatsapp_failed', { index: i, error: r.reason });
            }
          });
        });
      }
    } catch (waErr) {
      req.log.error('create_adhyayan_booking_by_admin_whatsapp_error', { error: waErr.message });
    }

    req.log.info('create_adhyayan_booking_by_admin_success', { shibir_ids, mumukshuCount: mumukshus.length, result });
    return res.status(200).send({
      message: 'Adhyayan bookings created by admin',
      data: result
    });
  } catch (err) {
    await t.rollback();
    throw err;
  }
};

async function ensureAttendanceEntry(booking, user, t) {
  const existing = await ShibirAttendanceDb.findOne({
    where: { bookingid: booking.bookingid },
    transaction: t
  });

  if (!existing) {
    await createShibirAttendanceEntry(booking, user, t);
  }
}

export const toggleAttendance = async (req, res) => {
  const { shibir_id, cardno, sessionNumber, value } = req.body;
  req.log.info('toggle_attendance_start', { shibir_id, cardno, sessionNumber, value });

  if (!shibir_id || !cardno || !sessionNumber) {
    req.log.warn('toggle_attendance_missing_params', { shibir_id, cardno, sessionNumber });
    throw new ApiError(400, "shibir_id, cardno and sessionNumber required");
  }

  const t = await database.transaction();
  req.transaction = t;

  const sessionNo = Number(sessionNumber);

  const session = await ShibirSession.findOne({
    where: { shibir_id, session_number: sessionNo },
    transaction: t
  });

  if (!session) {
    req.log.warn('toggle_attendance_session_not_found', { shibir_id, sessionNo });
    throw new ApiError(400, `Session ${sessionNo} does not exist for this Shibir`);
  }

  const record = await ShibirAttendanceDb.findOne({
    where: { cardno, shibir_id },
    include: [
      {
        model: ShibirBookingDb,
        required: true,
        attributes: ['status'],
        where: { status: STATUS_CONFIRMED }
      }
    ],
    transaction: t
  });

  if (!record) {
    req.log.warn('toggle_attendance_record_not_found', { shibir_id, cardno });
    throw new ApiError(404, "Attendance record not found");
  }

  if (Number(value) === 1) {
    await ShibirAttendanceRecord.upsert(
      {
        shibir_id,
        bookingid: record.bookingid,
        cardno,
        session_number: sessionNo,
        attended: true,
        updatedBy: req.user.cardno || req.user.username
      },
      { transaction: t }
    );
  } else {
    await ShibirAttendanceRecord.destroy({
      where: {
        shibir_id,
        bookingid: record.bookingid,
        session_number: sessionNo
      },
      transaction: t
    });
  }

  if (sessionNo <= 9) {
    const columnName = `session_${sessionNo}_attendance`;
    await record.update(
      {
        [columnName]: Number(value) === 1
      },
      { transaction: t }
    );
  }

  await t.commit();
  req.log.info('toggle_attendance_success', { shibir_id, cardno, sessionNo, value });
  return res.json({
    message: "Attendance updated successfully"
  });
};

export const bulkToggleAttendance = async (req, res) => {
  const { shibir_id, sessionNumber, cardnos, value } = req.body;
  req.log.info('bulk_toggle_attendance_start', { shibir_id, sessionNumber, cardnosCount: cardnos?.length, value });

  if (!shibir_id || !sessionNumber || !Array.isArray(cardnos) || cardnos.length === 0) {
    req.log.warn('bulk_toggle_attendance_missing_params');
    throw new ApiError(400, "shibir_id, sessionNumber and non-empty cardnos array are required");
  }

  const t = await database.transaction();
  req.transaction = t;

  const sessionNo = Number(sessionNumber);

  const session = await ShibirSession.findOne({
    where: { shibir_id, session_number: sessionNo },
    transaction: t
  });

  if (!session) {
    throw new ApiError(400, `Session ${sessionNo} does not exist for this Shibir`);
  }

  const records = await ShibirAttendanceDb.findAll({
    where: {
      shibir_id,
      cardno: cardnos
    },
    include: [
      {
        model: ShibirBookingDb,
        required: true,
        attributes: ['status'],
        where: { status: STATUS_CONFIRMED }
      }
    ],
    transaction: t
  });

  if (records.length === 0) {
    throw new ApiError(404, "No eligible attendance records found for the given card numbers");
  }

  const updatedBy = req.user.cardno || req.user.username;

  if (Number(value) === 1) {
    const upsertPromises = records.map(r =>
      ShibirAttendanceRecord.upsert(
        {
          shibir_id,
          bookingid: r.bookingid,
          cardno: r.cardno,
          session_number: sessionNo,
          attended: true,
          updatedBy
        },
        { transaction: t }
      )
    );
    await Promise.all(upsertPromises);
  } else {
    const bookingids = records.map(r => r.bookingid);
    await ShibirAttendanceRecord.destroy({
      where: {
        shibir_id,
        bookingid: bookingids,
        session_number: sessionNo
      },
      transaction: t
    });
  }

  if (sessionNo <= 9) {
    const columnName = `session_${sessionNo}_attendance`;
    const updatePromises = records.map(r =>
      r.update(
        {
          [columnName]: Number(value) === 1,
          updatedBy
        },
        { transaction: t }
      )
    );
    await Promise.all(updatePromises);
  }

  await t.commit();
  req.log.info('bulk_toggle_attendance_success', { shibir_id, sessionNo, updatedCount: records.length, value });
  return res.json({
    message: `Successfully updated attendance for ${records.length} participants`
  });
};

export const createAttendanceEntryManually = async (req, res) => {
  const { bookingid } = req.body;
  req.log.info('create_attendance_entry_manually_start', { bookingid });

  const t = await database.transaction();
  req.transaction = t;

  const booking = await ShibirBookingDb.findOne({
    where: { bookingid },
    transaction: t
  });

  if (!booking) {
    req.log.warn('create_attendance_entry_manually_booking_not_found', { bookingid });
    throw new ApiError(404, "Booking not found");
  }

  // Check if already exists
  const existing = await ShibirAttendanceDb.findOne({
    where: {
      shibir_id: booking.shibir_id,
      cardno: booking.cardno
    },
    transaction: t
  });

  if (existing) {
    await t.rollback();
    req.log.warn('create_attendance_entry_manually_already_exists', { bookingid });
    return res.status(409).json({
      message: "Attendance record already exists"
    });
  }

  await createShibirAttendanceEntry(
    booking,
    req.user,
    t
  );

  await t.commit();

  req.log.info('create_attendance_entry_manually_success', { bookingid });
  return res.status(201).json({
    message: "Attendance record created"
  });
};
