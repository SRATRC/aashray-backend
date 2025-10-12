import {
  ShibirDb,
  ShibirBookingDb,
  AdhyayanFeedback
} from '../../models/associations.js';
import {
  STATUS_CONFIRMED,
  STATUS_PAYMENT_PENDING,
  TYPE_ADHYAYAN,
  ERR_BOOKING_NOT_FOUND,
  TYPE_GUEST_ADHYAYAN,
  STATUS_CANCELLED,
  STATUS_ADMIN_CANCELLED,
  ERR_BOOKING_ALREADY_CANCELLED,
  STATUS_DELETED,
  FEEDBACK_ELIGIBILITY_HOUR
} from '../../config/constants.js';
import { validateFeedbackEligibility } from '../../helpers/adhyayanBooking.helper.js';
import { openAdhyayanSeat } from '../../helpers/adhyayanBooking.helper.js';
import { userCancelBooking } from '../../helpers/transactions.helper.js';
import {
  getOtherBookingUser,
  notifyCardno
} from '../../helpers/notification.helper.js';
import database from '../../config/database.js';
import Sequelize from 'sequelize';
import moment from 'moment';
import sendMail from '../../utils/sendMail.js';
import ApiError from '../../utils/ApiError.js';

export const FetchAllShibir = async (req, res) => {
  const today = moment().format('YYYY-MM-DD');

  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;
  const offset = (page - 1) * pageSize;

  const shibirs = await ShibirDb.findAll({
    where: {
      start_date: {
        [Sequelize.Op.gt]: today
      },
      status: {
        [Sequelize.Op.ne]: STATUS_DELETED
      }
    },
    offset,
    limit: pageSize,
    order: [['start_date', 'ASC']]
  });

  const groupedByMonth = shibirs.reduce((acc, event) => {
    const month = event.month;
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

export const FetchBookedShibir = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;
  const offset = (page - 1) * pageSize;

  const shibirs = await database.query(
    `
    SELECT t1.bookingid,
       t1.cardno,
       t1.bookedBy AS bookedBy,
       t4.issuedto AS name,
       t1.shibir_id,
       t2.location,
       t1.status,
       t2.name AS shibir_name,
       t2.speaker,
       t2.start_date,
       t2.end_date,
       COALESCE(t3.amount, 0) AS amount,
       t3.status AS transaction_status
    FROM shibir_booking_db t1
    JOIN shibir_db t2 ON t1.shibir_id = t2.id
    LEFT JOIN transactions t3 ON t1.bookingid = t3.bookingid
      AND t3.category IN (:category)
    LEFT JOIN card_db t4 ON t4.cardno = t1.cardno
    WHERE (t1.cardno = :cardno OR t1.bookedBy = :cardno)
    ORDER BY t2.start_date DESC
    LIMIT :limit
    OFFSET :offset;
    `,
    {
      replacements: {
        cardno: req.user.cardno,
        category: [TYPE_ADHYAYAN, TYPE_GUEST_ADHYAYAN],
        limit: pageSize,
        offset: offset
      },
      type: Sequelize.QueryTypes.SELECT
    }
  );

  const currentDate = new Date();
  shibirs.forEach((shibir) => {
    const startDate = new Date(shibir.start_date);
    const feedbackStartDate = new Date(startDate);
    feedbackStartDate.setHours(FEEDBACK_ELIGIBILITY_HOUR, 0, 0, 0);

    const feedbackEndDate = new Date(shibir.end_date);
    feedbackEndDate.setDate(feedbackEndDate.getDate() + 15);

    shibir.showFeedback =
      currentDate >= feedbackStartDate &&
      currentDate <= feedbackEndDate &&
      shibir.status === STATUS_CONFIRMED;
  });

  return res.status(200).send({ data: shibirs });
};

export const CancelShibir = async (req, res) => {
  const { bookingid } = req.body;

  const t = await database.transaction();
  req.transaction = t;

  const booking = await ShibirBookingDb.findOne({
    where: {
      bookingid: bookingid,
      [Sequelize.Op.or]: [
        { cardno: req.user.cardno },
        { bookedBy: req.user.cardno }
      ]
    }
  });

  if (!booking) {
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  if ([STATUS_CANCELLED, STATUS_ADMIN_CANCELLED].includes(booking.status)) {
    throw new ApiError(400, ERR_BOOKING_ALREADY_CANCELLED);
  }

  const adhyayan = await ShibirDb.findOne({
    where: { id: booking.shibir_id }
  });

  if ([STATUS_CONFIRMED, STATUS_PAYMENT_PENDING].includes(booking.status)) {
    await openAdhyayanSeat(adhyayan, req.user.username, t);
  }

  await userCancelBooking(req.user, booking, t);
  await t.commit();

  sendMail({
    email: req.user.email,
    subject: 'Raj Adhyayan Booking Cancelled',
    template: 'rajAdhyayanCancellation',
    context: {
      name: req.user.issuedto,
      adhyayanName: adhyayan.name
    }
  });

  if (booking.bookedBy) {
    const other = getOtherBookingUser(booking, req.user.cardno);
    if (other) {
      const title = 'Adhyayan Booking Cancelled';
      const body =
        req.user.cardno === booking.cardno
          ? `booking of "${adhyayan.name}" has been cancelled for ${req.user.issuedto}.`
          : `Your booking of "${adhyayan.name}" has been cancelled.`;
      notifyCardno(other, { title, body, screen: '/bookings' });
    }
  }

  return res.status(200).send({ message: 'Shibir booking cancelled' });
};

export const FetchShibirInRange = async (req, res) => {
  const { start_date } = req.query;
  let { end_date } = req.query;

  const startDateObj = new Date(start_date);
  if (!end_date) {
    const endDateObj = new Date(startDateObj);
    endDateObj.setDate(startDateObj.getDate() + 15); // Add 15 days
    end_date = endDateObj.toISOString().split('T')[0];
  }

  const whereCondition = {
    start_date: {
      [Sequelize.Op.gte]: start_date
    }
  };

  if (end_date) {
    whereCondition.start_date[Sequelize.Op.lte] = end_date;
    whereCondition.end_date = {
      [Sequelize.Op.gte]: start_date,
      [Sequelize.Op.lte]: end_date
    };
  }

  const shibirs = await ShibirDb.findAll({
    where: whereCondition,
    order: [['start_date', 'ASC']]
  });

  return res.status(200).send({ data: shibirs });
};

export const FetchShibirById = async (req, res) => {
  const { id } = req.params;

  const shibir = await ShibirDb.findOne({
    where: {
      id: id
    }
  });

  if (!shibir) throw new ApiError(404, 'Shibir not found');

  return res.status(200).send({ data: shibir });
};

export const submitFeedback = async (req, res) => {
  const {
    shibir_id,
    swadhay_karta_rating,
    personal_interaction_rating,
    swadhay_karta_suggestions,
    raj_adhyayan_interest,
    future_topics,
    loved_most,
    improvement_suggestions,
    food_rating,
    stay_rating
  } = req.body;

  if (!shibir_id) {
    throw new ApiError(400, 'Adhyayan ID is required');
  }

  const t = await database.transaction();
  req.transaction = t;

  await validateFeedbackEligibility(req.user.cardno, shibir_id);

  await AdhyayanFeedback.create(
    {
      cardno: req.user.cardno,
      shibir_id,
      swadhay_karta_rating,
      personal_interaction_rating,
      swadhay_karta_suggestions,
      raj_adhyayan_interest,
      future_topics,
      loved_most,
      improvement_suggestions,
      food_rating,
      stay_rating,
      updatedBy: req.user.cardno
    },
    { transaction: t }
  );

  await t.commit();

  return res.status(201).send({
    message: 'Feedback submitted successfully'
  });
};

export const feedbackValidation = async (req, res) => {
  const { shibir_id } = req.query;

  if (!shibir_id) {
    throw new ApiError(400, 'Adhyayan ID is required');
  }

  await validateFeedbackEligibility(req.user.cardno, shibir_id);

  return res.status(200).send({
    message: 'Feedback is allowed'
  });
};
