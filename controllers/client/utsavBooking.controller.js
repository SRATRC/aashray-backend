import {
  ERR_BOOKING_NOT_FOUND,
  ERR_BOOKING_ALREADY_CANCELLED,
  MSG_CANCEL_SUCCESSFUL,
  STATUS_CANCELLED,
  STATUS_ADMIN_CANCELLED,
  STATUS_CONFIRMED,
  ROOM_STATUS_CHECKEDIN,
  FEEDBACK_ELIGIBILITY_HOUR
} from '../../config/constants.js';
import {
  Transactions,
  UtsavBooking,
  UtsavDb,
  UtsavFeedback,
  UtsavFeedbackAnswer
} from '../../models/associations.js';
import { userCancelBooking } from '../../helpers/transactions.helper.js';
import {
  openUtsavSeat,
  utsavBookingHeldSeat,
  sendUtsavBookingUpdateEmail,
  cancelUtsavFoodBookings,
  validateFeedbackEligibility
} from '../../helpers/utsavBooking.helper.js';
import moment from 'moment-timezone';
import Sequelize from 'sequelize';
import database from '../../config/database.js';
import ApiError from '../../utils/ApiError.js';
import { sendUtsavStatusChangeWhatsApp } from '../../helpers/whatsapp.helper.js';

import {
  getOtherBookingUser,
  notifyCardno
} from '../../helpers/notification.helper.js';
import { attachUserContext } from '../../middleware/Logger.js';

export const FetchUpcoming = async (req, res) => {
  req.log.info('fetch_upcoming_utsav_start');
  const today = moment().tz('Asia/Kolkata').format('YYYY-MM-DD');

  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;
  const offset = (page - 1) * pageSize;

  const utsavs = await database.query(
    `
    SELECT t1.id AS utsav_id,
       t1.name AS utsav_name,
       t1.start_date AS utsav_start,
       t1.end_date AS utsav_end,
       t1.month AS utsav_month,
       t1.location AS utsav_location,
       t1.status AS utsav_status,
       t1.registration_deadline AS registration_deadline,
       JSON_ARRAYAGG(
           JSON_OBJECT(
               'package_id', t2.id,
               'package_name', t2.name,
               'package_start', t2.start_date,
               'package_end', t2.end_date,
               'package_amount', t2.amount
           )
       ) AS packages
    FROM utsav_db t1
    JOIN utsav_packages_db t2 ON t1.id = t2.utsavid
    WHERE t1.registration_deadline IS NULL OR t1.registration_deadline >= :today
    GROUP BY t1.id
    ORDER BY t1.start_date ASC, t1.id ASC
    LIMIT :limit
    OFFSET :offset;
  `,
    {
      replacements: {
        today,
        limit: pageSize,
        offset: offset
      },
      type: database.QueryTypes.SELECT,
      raw: true
    }
  );

  const groupedByMonth = utsavs.reduce((acc, event) => {
    const month = event.utsav_month;
    if (!acc[month]) {
      acc[month] = [];
    }
    acc[month].push(event);
    return acc;
  }, {});

  const formattedResponse = {
    message: 'fetched results',
    data: Object.keys(groupedByMonth).map((month) => ({
      title: month,
      data: groupedByMonth[month]
    }))
  };

  req.log.info('fetch_upcoming_utsav_success', { count: utsavs.length });
  return res.status(200).send(formattedResponse);
};

export const ViewUtsavBookings = async (req, res) => {
  attachUserContext(req);
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;
  const offset = (page - 1) * pageSize;
  const upcomingOnly = req.query.upcoming === 'true';
  const today = moment().tz('Asia/Kolkata').format('YYYY-MM-DD');
  const upcomingWhere = upcomingOnly
    ? 'AND COALESCE(t3.end_date, t2.end_date) >= :today'
    : '';
  // Without upcoming=true the list keeps its original newest-booking-first order.
  // With it, the list is the member's future events, soonest first.
  const orderBy = upcomingOnly
    ? 'COALESCE(t3.start_date, t2.start_date) ASC, t1.bookingid ASC'
    : 'created_at DESC';
  req.log.info('fetch_utsav_bookings_start', { cardno: req.user.cardno, page, pageSize });

  const utsavs = await database.query(
    `
    SELECT t1.bookingid,
       t1.utsavid,
       t2.name AS utsav_name,
       t2.start_date AS utsav_start_date,
       t2.end_date AS utsav_end_date,
       t2.month,
       t2.location AS utsav_location,
       t1.packageid,
       t3.name AS package_name,
       t3.start_date AS package_start,
       t3.end_date AS package_end,
       t1.volunteer,
       t1.cardno,
       t1.bookedBy,
       t1.roomno as stay,
       t5.issuedto AS user_name,
       t1.status,
       t4.status AS transaction_status,
       t4.amount,
       t2.createdAt AS created_at
    FROM utsav_booking t1
    LEFT JOIN utsav_db t2 ON t1.utsavid = t2.id
    LEFT JOIN utsav_packages_db t3 ON t3.id = t1.packageid
    LEFT JOIN card_db t5 ON t5.cardno = t1.cardno
    LEFT JOIN transactions t4 ON t4.bookingid = t1.bookingid
    WHERE (t1.cardno = :cardno OR t1.bookedBy = :cardno)
      ${upcomingWhere}
    ORDER BY ${orderBy}
    LIMIT :limit
    OFFSET :offset;
  `,
    {
      replacements: {
        cardno: req.user.cardno,
        limit: pageSize,
        offset: offset,
        ...(upcomingOnly ? { today } : {})
      },
      type: database.QueryTypes.SELECT,
      raw: true
    }
  );

  // Feedback eligibility

  const now = moment().tz('Asia/Kolkata');

  const updatedUtsavs = await Promise.all(
    utsavs.map(async (utsav) => {
      const feedbackStartDate = moment(utsav.utsav_start_date)
        .tz('Asia/Kolkata')
        .hour(FEEDBACK_ELIGIBILITY_HOUR)
        .minute(0)
        .second(0);

      const daysSinceStart = now.diff(feedbackStartDate, 'days');

      const normalizedStatus = (utsav.status || '').toLowerCase();

      const existingFeedback = await UtsavFeedback.findOne({
        where: {
          utsav_id: utsav.utsavid,
          cardno: req.user.cardno
        }
      });

      return {
        ...utsav,

        hasSubmittedFeedback: !!existingFeedback,

        showFeedback:
          !existingFeedback &&
          !now.isBefore(feedbackStartDate) &&
          daysSinceStart <= 8 &&
          ['confirmed', 'checkedin'].includes(normalizedStatus)
      };
    })
  );

  req.log.info('fetch_utsav_bookings_success', { cardno: req.user.cardno, count: updatedUtsavs.length });
  return res.status(200).send({ data: updatedUtsavs });
};

export const CancelUtsavBooking = async (req, res) => {
  attachUserContext(req);
  const { bookingid } = req.body;
  req.log.info('cancel_utsav_booking_start', { bookingid, cardno: req.user.cardno });

  const t = await database.transaction();
  req.transaction = t;

  const booking = await UtsavBooking.findOne({
    include: [
      {
        model: UtsavDb,
        as: 'UtsavDb'
      }
    ],
    // Only the member or whoever booked for them may cancel, same as the
    // study-session cancel. Before, any booking id could be cancelled.
    where: {
      bookingid: bookingid,
      [Sequelize.Op.or]: [
        { cardno: req.user.cardno },
        { bookedBy: req.user.cardno }
      ]
    }
  });

  if (!booking) {
    req.log.warn('cancel_utsav_booking_not_found', { bookingid, cardno: req.user.cardno });
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  let previousStatus = booking.status;
  req.log.info('cancel_utsav_booking_found', {
    bookingid,
    cardno: req.user.cardno,
    utsavid: booking.utsavid,
    packageid: booking.packageid,
    currentStatus: booking.status
  });

  // Lock the utsav row before cancelling, so every flow takes the utsav lock
  // before the card lock. The cancel path can lock the card (credit restore),
  // and the booking path locks utsav first; the reverse order deadlocks.
  const utsav = await UtsavDb.findOne({
    where: { id: booking.utsavid },
    transaction: t,
    lock: t.LOCK.UPDATE
  });

  // The booking above was read with no lock, so two cancels at once (a double
  // tap) both saw it as confirmed and each handed a seat back. Lock and re-read
  // its payment row and then the booking, in the same order the payment
  // confirmation locks them, and decide from what is there now.
  //
  // transactions.bookingid has no index, so a locking read by bookingid scans
  // and locks the whole table, blocking every new booking until this commits.
  // Find the payment row's id with a plain read, then lock only that row.
  const paymentRow = await Transactions.findOne({ where: { bookingid }, attributes: ['id'] });
  if (paymentRow) {
    await Transactions.findOne({ where: { id: paymentRow.id }, transaction: t, lock: t.LOCK.UPDATE });
  }
  const current = await UtsavBooking.findOne({
    where: { bookingid },
    transaction: t,
    lock: t.LOCK.UPDATE
  });
  if (!current) {
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }
  if ([STATUS_CANCELLED, STATUS_ADMIN_CANCELLED].includes(current.status)) {
    req.log.warn('cancel_utsav_booking_already_cancelled', { bookingid, status: current.status });
    throw new ApiError(400, ERR_BOOKING_ALREADY_CANCELLED);
  }
  previousStatus = current.status;

  await userCancelBooking(req.user, booking, t);
  req.log.info('cancel_utsav_booking_cancelled', {
    bookingid,
    cardno: req.user.cardno,
    previousStatus,
    newStatus: 'cancelled'
  });

  // Only a booking that held a seat was given utsav meals; waiting-list
  // bookings never are. The cleanup clears every meal in the package dates,
  // so running it for a booking that never had them wipes meals the member
  // booked on their own for those days.
  if (utsavBookingHeldSeat(previousStatus)) {
    await cancelUtsavFoodBookings(booking, req.user.username, t);
  }

  // Branch on previousStatus: userCancelBooking above has already overwritten
  // booking.status with 'cancelled'. A waiting-list booking never held a seat,
  // so cancelling it must not hand one back.
  if (utsavBookingHeldSeat(previousStatus)) {
    await openUtsavSeat(utsav, booking.cardno, req.user.username, t);
    req.log.info('cancel_utsav_booking_seat_opened', { bookingid, utsavid: booking.utsavid });
  } else {
    req.log.info('cancel_utsav_booking_seat_not_held', {
      bookingid,
      utsavid: booking.utsavid,
      previousStatus
    });
  }

  await t.commit();
  req.log.info('cancel_utsav_booking_committed', { bookingid });


  if (booking.bookedBy) {
    const other = getOtherBookingUser(booking, req.user.cardno);
    if (other) {
      const title = 'Utsav Booking Cancelled';
      const body =
        req.user.cardno === booking.cardno
          ? `Booking of "${booking.UtsavDb.name}" for ${req.user.issuedto} has been cancelled.`
          : `Your booking of "${booking.UtsavDb.name}" has been cancelled.`;
      notifyCardno(other, {
        title,
        body,
        screen: '/bookings'
      });
    }
  }

  await sendUtsavBookingUpdateEmail(booking, utsav);

  try {
    await sendUtsavStatusChangeWhatsApp(booking, previousStatus);
  } catch (waErr) {
    console.error("Error sending utsav status change WhatsApp in CancelUtsavBooking:", waErr);
  }

  req.log.info('cancel_utsav_booking_success', { bookingid, cardno: req.user.cardno });
  return res.status(200).send({ message: MSG_CANCEL_SUCCESSFUL });
};

export const FetchUtsavById = async (req, res) => {
  const { id } = req.params;
  req.log.info('fetch_utsav_by_id_start', { utsavId: id });
  const today = moment().tz('Asia/Kolkata').format('YYYY-MM-DD');

  const utsav = await database.query(
    `
    SELECT t1.id AS utsav_id,
       t1.name AS utsav_name,
       t1.start_date AS utsav_start,
       t1.end_date AS utsav_end,
       t1.month AS utsav_month,
       t1.location AS utsav_location,
       t1.status AS utsav_status,
       t1.registration_deadline AS registration_deadline,
       JSON_ARRAYAGG(
           JSON_OBJECT(
               'package_id', t2.id,
               'package_name', t2.name,
               'package_start', t2.start_date,
               'package_end', t2.end_date,
               'package_amount', t2.amount
           )
       ) AS packages
    FROM utsav_db t1
    JOIN utsav_packages_db t2 ON t1.id = t2.utsavid
    WHERE t1.id = :id
      AND (t1.registration_deadline IS NULL OR t1.registration_deadline >= :today)
    GROUP BY t1.id;
  `,
    {
      replacements: {
        id: id,
        today: today
      },
      type: database.QueryTypes.SELECT,
      raw: true
    }
  );

  if (!utsav || utsav.length === 0) {
    req.log.warn('fetch_utsav_by_id_not_found', { utsavId: id });
    throw new ApiError(404, 'Utsav not found');
  }

  req.log.info('fetch_utsav_by_id_success', { utsavId: id });
  return res.status(200).send({ data: utsav[0] });
};

export const validateUtsavFeedback = async (req, res) => {
  const { utsav_id } = req.query;

  if (!utsav_id) {
    throw new ApiError(400, 'Utsav ID is required');
  }

  const parsedUtsavId = Number(utsav_id);

  if (Number.isNaN(parsedUtsavId)) {
    throw new ApiError(400, 'Invalid Utsav ID');
  }

  await validateFeedbackEligibility(
    req.user.cardno,
    parsedUtsavId
  );

  return res.status(200).json({
    success: true,
    message: 'Feedback is allowed'
  });
};

const ALLOWED_UTSAV_FEEDBACK_QUESTIONS = [
  {
    id: 'event_rating',
    type: 'rating'
  },
  {
    id: 'stay_rating',
    type: 'rating'
  },
  {
    id: 'food_rating',
    type: 'rating'
  },
  {
    id: 'program_rating',
    type: 'rating'
  },
  {
    id: 'loved_most',
    type: 'text'
  },
  {
    id: 'improvement_suggestions',
    type: 'text'
  }
];

export const submitUtsavFeedback = async (req, res) => {

  const transaction = await database.transaction();

  try {

    const { utsav_id, answers } = req.body;

    if (!utsav_id) {
      throw new ApiError(400, 'utsav_id is required');
    }

    if (!Array.isArray(answers) || answers.length === 0) {
      throw new ApiError(400, 'answers array is required');
    }

    await validateFeedbackEligibility(
      req.user.cardno,
      utsav_id
    );

    const allowedQuestionMap = new Map(
      ALLOWED_UTSAV_FEEDBACK_QUESTIONS.map(
        (q) => [q.id, q.type]
      )
    );

    const submittedQuestionIds = [];

    // Validate all answers
    for (const answerObj of answers) {

      const {
        question_id,
        question_text,
        question_type,
        answer
      } = answerObj;

      submittedQuestionIds.push(question_id);

      if (
        !question_id ||
        !question_text ||
        !question_type ||
        answer === undefined ||
        answer === null ||
        answer === ''
      ) {
        throw new ApiError(
          400,
          'All feedback fields are required'
        );
      }

      const expectedType =
        allowedQuestionMap.get(question_id);

      if (!expectedType) {
        throw new ApiError(
          400,
          `Invalid question_id: ${question_id}`
        );
      }

      if (expectedType !== question_type) {
        throw new ApiError(
          400,
          `Invalid question_type for ${question_id}`
        );
      }

      // Rating validation
      if (question_type === 'rating') {

        const rating = Number(answer);

        if (
          Number.isNaN(rating) ||
          rating < 1 ||
          rating > 5
        ) {
          throw new ApiError(
            400,
            `${question_id} must be between 1 and 5`
          );
        }

      }

    }

    // Ensure all required questions are submitted
    for (const question of ALLOWED_UTSAV_FEEDBACK_QUESTIONS) {

      if (!submittedQuestionIds.includes(question.id)) {

        throw new ApiError(
          400,
          `${question.id} is required`
        );

      }

    }

    // Create main feedback row
    const feedback = await UtsavFeedback.create(
      {
        cardno: req.user.cardno,
        utsav_id
      },
      { transaction }
    );

    // Create answers
    const feedbackAnswers = answers.map((item) => ({
      feedback_id: feedback.id,
      question_id: item.question_id,
      question_text: item.question_text,
      question_type: item.question_type,
      answer: item.answer
    }));

    await UtsavFeedbackAnswer.bulkCreate(
      feedbackAnswers,
      { transaction }
    );

    await transaction.commit();

    return res.status(201).json({
      success: true,
      message: 'Utsav feedback submitted successfully'
    });

  } catch (error) {

    await transaction.rollback();

    throw error;

  }

};