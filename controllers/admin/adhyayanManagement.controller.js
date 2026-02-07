import {
  AdhyayanFeedback,
  CardDb,
  ShibirDb,
  ShibirBookingDb,
  Transactions,
  ShibirAttendanceDb
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
  MSG_FETCH_SUCCESSFUL
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
  createShibirAttendanceEntry
} from '../../helpers/adhyayanBooking.helper.js';
import { validateCard } from '../../helpers/card.helper.js';
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

  const alreadyExists = await ShibirDb.findOne({
    where: {
      speaker: { [Sequelize.Op.like]: speaker },
      start_date: start_date
    }
  });
  if (alreadyExists) throw new ApiError(400, 'Adhyayan Already Exists');

  const month = moment(start_date).format('MMMM');

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
  });

  res.status(200).send({ message: 'Created Adhyayan', data: adhyayan_details });
};

export const fetchALLAdhyayan = async (req, res) => {
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
      shibir_db.updatedBy
    ORDER BY 
      shibir_db.start_date ASC;`,
    {
      type: QueryTypes.SELECT
    }
  );

  return res.status(200).send({ message: 'Fetched Results', data: shibirs });
};

export const fetchAdhyayanByLocation = async (req, res) => {
  const { location } = req.query;

  if (!location) {
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

  return res.status(200).send({ message: 'Fetched Results', data: shibirs });
};

export const fetchPGS = async (req, res) => {
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

  return res.status(200).send({ message: 'Fetched Results', data: shibirs });
};

export const fetchAdhyayan = async (req, res) => {
  const { id } = req.params;
  await validateAdhyayans(id);

  const adhyayan = await ShibirDb.findOne({
    where: { id: id }
  });

  return res.status(200).send({ message: 'Fetched Adhyayan', data: adhyayan });
};

export const fetchAdhyayanBookings = async (req, res) => {
  const shibir_id = req.query.shibir_id;
  let status = req.query.status;
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
      t2.cardno, 
      t2.issuedto, 
      t2.mobno, 
      t2.gender, 
      t2.center, 
      t2.res_status,
      t3.name,
      t4.status AS transaction_status,
      t4.description as comments 
   FROM shibir_booking_db AS t1
   LEFT JOIN card_db AS t2 
      ON t1.cardno = t2.cardno 
   LEFT JOIN shibir_db AS t3 
      ON t1.shibir_id = t3.id 
   LEFT JOIN transactions AS t4
      ON t1.bookingid = t4.bookingid
   WHERE 
      t1.shibir_id = :shibirId 
      AND t1.status IN (:status)
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
  });

  res.status(200).send({ message: 'Updated Adhyayan' });
};

export const adhyayanWaitlist = async (req, res) => {
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
  res.status(200).send({ message: 'Fetched Adhyayan', data: data });
};

export const adhyayanPendinglist = async (req, res) => {
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
  res.status(200).send({ message: 'Fetched Adhyayan', data: data });
};

export const adhyayanStatusUpdate = async (req, res) => {
  const { shibir_id, bookingid, status, description } = req.body;

  var newBookingStatus = status;
  let newBooking = null;
  const t = await database.transaction();
  req.transaction = t;

  // Store notification data to send after transaction commit
  const notificationData = [];

  const adhyayan = (await validateAdhyayans(shibir_id))[0];
  const booking = await validateAdhyayanBooking(bookingid, shibir_id);

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
              body: `Adhyayan booking for ${
                booking.CardDb.issuedto.split(' ')[0]
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
   
    sendAdhyayanBookingUpdateNotification(booking, adhyayan);
    // Send notification and email for new booking if exists
    if (newBooking) {
      await sendAdhyayanBookingUpdateNotification(newBooking, adhyayan);
    }
  } catch (error) {
    // Log error but don't fail the response since transaction is already committed
    console.error('Error sending notifications/emails:', error);
  }
  
  return res.status(200).send({ message: 'Updated booking status' });
};

export const activateAdhyayan = async (req, res) => {
  const itemUpdated = await ShibirDb.update(
    {
      status: req.params.activate,
      updatedBy: req.user.username
    },
    {
      where: {
        id: req.params.id
      }
    }
  );

  if (itemUpdated != 1)
    throw new ApiError(500, 'Error occured while activating adhyayan');
  res.status(200).send({ message: 'Adhyayan status updated' });
};

export const fetchAllAdhyayanList = async (req, res) => {
  const adhyayans = await database.query(
    `SELECT id, name FROM shibir_db ORDER BY id ASC`,
    {
      type: QueryTypes.SELECT,
      raw: true
    }
  );

  return res.status(200).json({
    message: 'Fetched adhyayan list',
    data: adhyayans
  });
};

export const softDeleteShibir = async (req, res) => {
  const { id } = req.params;

  const updated = await ShibirDb.update(
    { status: 'deleted' },
    { where: { id } }
  );

  if (updated[0] === 0) {
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
    console.error('Bulk adhyayan cancel notification failed:', notifyErr);
  }

  res.status(200).json({ message: 'Shibir marked as deleted' });
};


export const getAdhyayanFeedback = async (req, res) => {
  const { shibir_id } = req.params;
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 20;
  const offset = (page - 1) * pageSize;

  if (!shibir_id) {
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

  return res.status(200).send({
    message: MSG_FETCH_SUCCESSFUL,
    data: {
      feedback,
      stats,
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages: Math.ceil(totalCount / pageSize)
      }
    }
  });
};

export const markAdhyayanAttendance = async (req, res) => {
  const t = await database.transaction();

  try {
    const { shibir_id, session_no, cardno } = req.params;
    const sessionNo = Number(session_no);

    if (!sessionNo || sessionNo < 1 || sessionNo > 9) {
      throw new ApiError(400, 'Invalid session number');
    }

    const attendance = await ShibirAttendanceDb.findOne({
      where: { shibir_id, cardno },
      transaction: t
    });

    if (!attendance) {
      throw new ApiError(404, 'Attendance record not found');
    }

    const sessionField = `session_${sessionNo}`;
    const attendanceField = `session_${sessionNo}_attendance`;

    if (!attendance[sessionField]) {
      throw new ApiError(400, `Session ${sessionNo} not applicable`);
    }

    if (attendance[attendanceField]) {
      throw new ApiError(400, `Attendance already marked for session ${sessionNo}`);
    }

    const shibir = await ShibirDb.findByPk(shibir_id, { transaction: t });
    const card = await CardDb.findOne({ where: { cardno }, transaction: t });

    await attendance.update(
      {
        [attendanceField]: true,
        updatedBy: req.user.cardno
      },
      { transaction: t }
    );

    await t.commit();

    return res.status(200).send({
      message: 'Attendance marked successfully',
      participantName: card?.issuedto || cardno,
      shibirName: shibir?.name || `Shibir ${shibir_id}`,
      session: sessionNo
    });

  } catch (err) {
    // ✅ rollback ONLY if transaction not finished
    if (t && !t.finished) {
      await t.rollback();
    }
    throw err;
  }
};

export const fetchAdhyayanAttendanceReport = async (req, res) => {
  const { shibir_id } = req.params;

  const { Op } = Sequelize;

  const shibir = await ShibirDb.findByPk(shibir_id);
  if (!shibir) {
    throw new ApiError(404, 'Adhyayan not found');
  }

  // Build dynamic OR condition for active sessions
  const sessionConditions = [];
  for (let i = 1; i <= 9; i++) {
    sessionConditions.push({ [`session_${i}`]: 1 });
  }

  const attendanceRows = await ShibirAttendanceDb.findAll({
    where: {
  shibir_id,
  session_1: 1   // just check one session
}
,
    include: [
      {
        model: CardDb,
        attributes: ['cardno', 'issuedto', 'mobno', 'gender', 'center', 'res_status']
      }
    ],
    order: [['cardno', 'ASC']]
  });

  const reportData = attendanceRows.map(row => {
    const data = {
      cardno: row.cardno,
      name: row.CardDb?.issuedto || '',
      mobno: row.CardDb?.mobno || '',
      gender: row.CardDb?.gender || '',
      centre: row.CardDb?.center || '',
      res_status: row.CardDb?.res_status || ''
    };

    for (let i = 1; i <= 9; i++) {
      const attended = row[`session_${i}_attendance`];

      data[`session_${i}`] = Number(attended) === 1 ? 'Yes' : 'No';

    }

    return data;
  });

  return res.status(200).send({
    shibirName: shibir.name,
    speaker: shibir.speaker,
    maxSessions: 9,
    data: reportData
  });
};

export async function fetchAdhyayanAttendanceSummary(req, res) {
  const { shibir_id } = req.params;

  const shibir = await ShibirDb.findByPk(shibir_id);
  if (!shibir) {
    return res.status(404).json({ message: 'Shibir not found' });
  }

  const attendanceRows = await ShibirAttendanceDb.findAll({
    where: { shibir_id }
  });

  const totalRegistrants = attendanceRows.length;
  const summary = [];

  for (let i = 1; i <= 9; i++) {
    const attendedCount = attendanceRows.filter(
      r => r[`session_${i}_attendance`] === true
    ).length;

    const absenteesCount = totalRegistrants - attendedCount;

    summary.push({
      session: `Session ${i}`,
      total_registrants: totalRegistrants,
      total_attended: attendedCount,
      total_absentees: absenteesCount
    });
  }

  return res.status(200).json({
    data: {
      shibir_name: shibir.name,
      summary
    }
  });
}

export const createAdhyayanBookingByAdmin = async (req, res) => {
  const { shibir_ids, mumukshus } = req.body;

  // ✅ STRICT validation
  if (
    !Array.isArray(shibir_ids) ||
    shibir_ids.length === 0 ||
    !Array.isArray(mumukshus) ||
    mumukshus.length === 0
  ) {
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
  try {
    const { shibir_id, cardno, sessionNumber, value } = req.body;

    if (!shibir_id || !cardno || !sessionNumber) {
      return res.status(400).json({
        message: "shibir_id, cardno and sessionNumber required"
      });
    }

    // Validate session number
    if (sessionNumber < 1 || sessionNumber > 9) {
      return res.status(400).json({
        message: "Invalid session number"
      });
    }

    const columnName = `session_${sessionNumber}_attendance`;

    const record = await ShibirAttendanceDb.findOne({
      where: { 
        cardno,
        shibir_id  // Add shibir_id to the where clause
      }
    });

    if (!record) {
      return res.status(404).json({
        message: "Attendance record not found"
      });
    }

    await record.update({
      [columnName]: value
    });

    return res.json({
      message: "Attendance updated successfully"
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Internal server error",
      error: error.message  // Add this to see the actual SQL error
    });
  }
};


export const createAttendanceEntryManually = async (req, res) => {
  const { bookingid } = req.body;

  const t = await database.transaction();

  try {
    const booking = await ShibirBookingDb.findOne({
      where: { bookingid },
      transaction: t
    });

    if (!booking) {
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

    return res.status(201).json({
      message: "Attendance record created"
    });

  } catch (error) {
    await t.rollback();
    throw error;
  }
};
