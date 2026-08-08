import {
  ShibirDb,
  ShibirBookingDb,
  AdhyayanFeedback,
  CardDb,
  ShibirAttendanceDb
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
  STATUS_WAITING,
  FEEDBACK_ELIGIBILITY_HOUR
} from '../../config/constants.js';
import { validateFeedbackEligibility } from '../../helpers/adhyayanBooking.helper.js';
import { openAdhyayanSeat, sendAdhyayanBookingUpdateNotification, resetShibirAttendance } from '../../helpers/adhyayanBooking.helper.js';
import { userCancelBooking } from '../../helpers/transactions.helper.js';
import {
  getOtherBookingUser,
  notifyCardno
} from '../../helpers/notification.helper.js';
import { attachUserContext } from '../../middleware/Logger.js';
import database from '../../config/database.js';
import Sequelize from 'sequelize';
import moment from 'moment';
import sendMail from '../../utils/sendMail.js';
import ApiError from '../../utils/ApiError.js';

export const FetchAllShibir = async (req, res) => {
  req.log.info('fetch_all_shibir_start');
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

  // How many people are already queued on each shibir. A full shibir is still
  // bookable — it goes to the waitlist — so the app shows the queue length in
  // place of "N seats left", and could not until this was sent.
  const waitlistCounts = shibirs.length
    ? await ShibirBookingDb.findAll({
        attributes: [
          'shibir_id',
          [Sequelize.fn('COUNT', Sequelize.col('bookingid')), 'waitlist_count']
        ],
        where: {
          shibir_id: { [Sequelize.Op.in]: shibirs.map((shibir) => shibir.id) },
          status: STATUS_WAITING
        },
        group: ['shibir_id'],
        raw: true
      })
    : [];

  const waitlistByShibir = new Map(
    waitlistCounts.map((row) => [row.shibir_id, Number(row.waitlist_count)])
  );

  const groupedByMonth = shibirs.reduce((acc, event) => {
    const month = event.month;
    if (!acc[month]) {
      acc[month] = [];
    }
    // Plain object so the added field survives serialization — a model instance
    // only serializes its own attributes.
    acc[month].push({
      ...event.toJSON(),
      waitlist_count: waitlistByShibir.get(event.id) ?? 0
    });
    return acc;
  }, {});

  const formattedResponse = {
    message: 'fetched results',
    data: Object.keys(groupedByMonth).map((month) => ({
      title: month,
      data: groupedByMonth[month]
    }))
  };

  req.log.info('fetch_all_shibir_success', { count: shibirs.length });
  return res.status(200).send(formattedResponse);
};

export const FetchBookedShibir = async (req, res) => {
  attachUserContext(req);
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;
  const offset = (page - 1) * pageSize;
  req.log.info('fetch_booked_shibir_start', { cardno: req.user.cardno, page, pageSize });

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
  const updatedShibirs = await Promise.all(
    shibirs.map(async (shibir) => {
      const startDate = new Date(shibir.start_date);
      const feedbackStartDate = new Date(startDate);
      feedbackStartDate.setHours(FEEDBACK_ELIGIBILITY_HOUR, 0, 0, 0);

      const feedbackEndDate = new Date(shibir.end_date);
      feedbackEndDate.setDate(feedbackEndDate.getDate() + 15);

      const existingFeedback = await AdhyayanFeedback.findOne({
        where: {
          shibir_id: shibir.shibir_id,
          cardno: req.user.cardno
        }
      });

      return {
        ...shibir,
        hasSubmittedFeedback: !!existingFeedback,
        showFeedback:
          !existingFeedback &&
          currentDate >= feedbackStartDate &&
          currentDate <= feedbackEndDate &&
          shibir.status === STATUS_CONFIRMED
      };
    })
  );

  req.log.info('fetch_booked_shibir_success', { cardno: req.user.cardno, count: updatedShibirs.length });
  return res.status(200).send({ data: updatedShibirs });
};

export const CancelShibir = async (req, res) => {
  attachUserContext(req);
  const { bookingid } = req.body;
  req.log.info('cancel_shibir_start', { bookingid, cardno: req.user.cardno });

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
    req.log.warn('cancel_shibir_not_found', { bookingid, cardno: req.user.cardno });
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  if ([STATUS_CANCELLED, STATUS_ADMIN_CANCELLED].includes(booking.status)) {
    req.log.warn('cancel_shibir_already_cancelled', {
      bookingid,
      cardno: req.user.cardno,
      currentStatus: booking.status
    });
    throw new ApiError(400, ERR_BOOKING_ALREADY_CANCELLED);
  }

  req.log.info('cancel_shibir_found', {
    bookingid,
    cardno: req.user.cardno,
    shibirId: booking.shibir_id,
    currentStatus: booking.status
  });

  const adhyayan = await ShibirDb.findOne({
    where: { id: booking.shibir_id }
  });

  let newBooking = null;
  if ([STATUS_CONFIRMED, STATUS_PAYMENT_PENDING].includes(booking.status)) {
    req.log.info('cancel_shibir_opening_seat', { shibirId: booking.shibir_id });
    newBooking = await openAdhyayanSeat(adhyayan, req.user.username, t);
    if (newBooking) {
      req.log.info('cancel_shibir_waitlist_promoted', {
        newBookingId: newBooking.bookingid,
        shibirId: booking.shibir_id
      });
    }
  }

  await resetShibirAttendance(booking.bookingid, req.user.username, t);

  const previousStatus = booking.status;
  await userCancelBooking(req.user, booking, t);
  req.log.info('cancel_shibir_cancelled', { bookingid, cardno: req.user.cardno });
  await t.commit();
  req.log.info('cancel_shibir_committed', { bookingid });

  await sendAdhyayanBookingUpdateNotification(booking, adhyayan, false, previousStatus);

  if (newBooking) {
    //sending notification and email to user who got moved from waiting to pending and cc to the bookedBy user if any.
    await sendAdhyayanBookingUpdateNotification(newBooking, adhyayan, false, 'waiting');
  }

  req.log.info('cancel_shibir_success', { bookingid, cardno: req.user.cardno });
  return res.status(200).send({ message: 'Adhyayan booking cancelled' });
};

export const FetchShibirInRange = async (req, res) => {
  const { start_date } = req.query;
  let { end_date } = req.query;
  req.log.info('fetch_shibir_in_range_start', { start_date, end_date });

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

  req.log.info('fetch_shibir_in_range_success', { start_date, end_date, count: shibirs.length });
  return res.status(200).send({ data: shibirs });
};

export const FetchShibirById = async (req, res) => {
  const { id } = req.params;
  req.log.info('fetch_shibir_by_id_start', { shibirId: id });

  const shibir = await ShibirDb.findOne({
    where: {
      id: id
    }
  });

  if (!shibir) {
    req.log.warn('fetch_shibir_by_id_not_found', { shibirId: id });
    throw new ApiError(404, 'Shibir not found');
  }

  req.log.info('fetch_shibir_by_id_success', { shibirId: id });
  return res.status(200).send({ data: shibir });
};

export const submitFeedback = async (req, res) => {
  attachUserContext(req);
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

  req.log.info('submit_feedback_start', { cardno: req.user.cardno, shibirId: shibir_id });

  if (!shibir_id) {
    req.log.warn('submit_feedback_missing_shibir_id', { cardno: req.user.cardno });
    throw new ApiError(400, 'Adhyayan ID is required');
  }

  const t = await database.transaction();
  req.transaction = t;

  await validateFeedbackEligibility(req.user.cardno, shibir_id);
  req.log.info('submit_feedback_eligibility_passed', { cardno: req.user.cardno, shibirId: shibir_id });

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
  req.log.info('submit_feedback_success', { cardno: req.user.cardno, shibirId: shibir_id });

  return res.status(201).send({
    message: 'Feedback submitted successfully'
  });
};

export const feedbackValidation = async (req, res) => {
  attachUserContext(req);
  const { shibir_id } = req.query;
  req.log.info('feedback_validation_start', { cardno: req.user.cardno, shibirId: shibir_id });

  if (!shibir_id) {
    req.log.warn('feedback_validation_missing_shibir_id', { cardno: req.user.cardno });
    throw new ApiError(400, 'Adhyayan ID is required');
  }

  await validateFeedbackEligibility(req.user.cardno, shibir_id);
  req.log.info('feedback_validation_success', { cardno: req.user.cardno, shibirId: shibir_id });

  return res.status(200).send({
    message: 'Feedback is allowed'
  });
};
