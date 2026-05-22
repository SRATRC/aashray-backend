import {
  ERR_BOOKING_NOT_FOUND,
  MSG_CANCEL_SUCCESSFUL,
  STATUS_CONFIRMED,
  ROOM_STATUS_CHECKEDIN,
  FEEDBACK_ELIGIBILITY_HOUR
} from '../../config/constants.js';
import {
  UtsavBooking,
  UtsavDb,
  UtsavFeedback,
  UtsavFeedbackAnswer
} from '../../models/associations.js';
import { userCancelBooking } from '../../helpers/transactions.helper.js';
import {
  openUtsavSeat,
  sendUtsavBookingUpdateEmail,
  validateFeedbackEligibility
} from '../../helpers/utsavBooking.helper.js';
import moment from 'moment-timezone';
import database from '../../config/database.js';
import ApiError from '../../utils/ApiError.js';

import {
  getOtherBookingUser,
  notifyCardno
} from '../../helpers/notification.helper.js';

export const FetchUpcoming = async (req, res) => {
  const today = moment().format('YYYY-MM-DD');

  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;
  const offset = (page - 1) * (pageSize - 1);

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
    ORDER BY t1.start_date ASC
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

  return res.status(200).send(formattedResponse);
};

export const ViewUtsavBookings = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;
  const offset = (page - 1) * pageSize;

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
    WHERE t1.cardno = :cardno OR t1.bookedBy = :cardno
    ORDER BY created_at DESC
    LIMIT :limit
    OFFSET :offset;
  `,
    {
      replacements: {
        cardno: req.user.cardno,
        limit: pageSize,
        offset: offset
      },
      type: database.QueryTypes.SELECT,
      raw: true
    }
  );

  // ✅ ADD THIS BLOCK (feedback eligibility)

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

  return res.status(200).send({ data: updatedUtsavs });
};

export const CancelUtsavBooking = async (req, res) => {
  const { bookingid } = req.body;

  const t = await database.transaction();
  req.transaction = t;

  const booking = await UtsavBooking.findOne({
    include: [
      {
        model: UtsavDb,
        as: 'UtsavDb'
      }
    ],
    where: {
      bookingid: bookingid
    }
  });

  if (!booking) {
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  await userCancelBooking(req.user, booking, t);

  const utsav = await UtsavDb.findOne({
    where: { id: booking.utsavid }
  });
  await openUtsavSeat(utsav, booking.cardno, req.user.username, t);

  await t.commit();

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

  return res.status(200).send({ message: MSG_CANCEL_SUCCESSFUL });
};

export const FetchUtsavById = async (req, res) => {
  const { id } = req.params;
  const today = moment().format('YYYY-MM-DD');

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
    throw new ApiError(404, 'Utsav not found');
  }

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
  const { utsav_id, answers } = req.body;

  if (!utsav_id) {
    throw new ApiError(400, 'utsav_id is required');
  }

  if (!Array.isArray(answers) || answers.length === 0) {
    throw new ApiError(400, 'answers array is required');
  }

  await validateFeedbackEligibility(req.user.cardno, utsav_id);

  const allowedQuestionMap = new Map(
    ALLOWED_UTSAV_FEEDBACK_QUESTIONS.map((q) => [q.id, q.type])
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
      throw new ApiError(400, 'All feedback fields are required');
    }

    const expectedType = allowedQuestionMap.get(question_id);

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
  const feedback = await UtsavFeedback.create({
    cardno: req.user.cardno,
    utsav_id
  });

  // Create answers
  const feedbackAnswers = answers.map((item) => ({
    feedback_id: feedback.id,
    question_id: item.question_id,
    question_text: item.question_text,
    question_type: item.question_type,
    answer: item.answer
  }));

  await UtsavFeedbackAnswer.bulkCreate(feedbackAnswers);

  return res.status(201).json({
    success: true,
    message: 'Utsav feedback submitted successfully'
  });
};