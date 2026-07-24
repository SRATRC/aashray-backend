import {
  TravelDb,
  TravelBusPassengers,
  TravelBusGroup,
  UtsavDb
} from '../../models/associations.js';
import {
  STATUS_CONFIRMED,
  STATUS_WAITING,
  MSG_CANCEL_SUCCESSFUL,
  RAJ_PRAVAS_EMAIL,
  STATUS_PROCEED_FOR_PAYMENT,
  STATUS_AWAITING_CONFIRMATION,
  ERR_BOOKING_NOT_FOUND,
  RESEARCH_CENTRE
} from '../../config/constants.js';
import { userCancelBooking } from '../../helpers/transactions.helper.js';
import {
  updateWaitingTravelBooking,
  sendTravelBookingStatusUpdateMail
} from '../../helpers/travelBooking.helper.js';
import { sendTravelStatusChangeWhatsApp } from '../../helpers/whatsapp.helper.js';
import {
  getOtherBookingUser,
  notifyCardno
} from '../../helpers/notification.helper.js';
import { attachUserContext } from '../../middleware/Logger.js';
import database from '../../config/database.js';
import ApiError from '../../utils/ApiError.js';
import sendMail from '../../utils/sendMail.js';
import Sequelize from 'sequelize';
import moment from 'moment';

export const FetchUpcoming = async (req, res) => {
  attachUserContext(req);
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;
  const offset = (page - 1) * pageSize;
  req.log.info('fetch_travel_bookings_start', { cardno: req.user.cardno, page, pageSize });

  const data = await database.query(
    `SELECT t1.bookingid,
       t1.cardno,
       t1.bookedBy,
       t3.issuedto AS user_name,
       t1.date,
       t1.pickup_point,
       t1.drop_point,
       t1.type,
       t1.luggage,
       t1.arrival_time,
       t1.comments,
       t1.admin_comments,
       t1.status,
       t2.amount,
       t2.status AS transaction_status,
       t5.bus_name,
       t6.timing AS departure_time,
       t8.issuedto AS coordinator_name,
       t8.mobno AS coordinator_contact
    FROM travel_db t1
    LEFT JOIN transactions t2 ON t1.bookingid = t2.bookingid
    LEFT JOIN card_db t3 ON t1.cardno = t3.cardno
    LEFT JOIN travel_bus_passengers t4 ON t1.bookingid = t4.bookingid
    LEFT JOIN travel_bus_group t5 ON t4.bus_group_id = t5.id
    LEFT JOIN travel_bus_stops t6 ON t5.id = t6.bus_group_id AND TRIM(LOWER(t6.stop_name)) = TRIM(LOWER(t1.pickup_point))
    LEFT JOIN travel_db t7 ON t5.coordinator_bookingid = t7.bookingid
    LEFT JOIN card_db t8 ON t7.cardno = t8.cardno
    WHERE t1.cardno = :cardno
      OR t1.bookedBy = :cardno
    ORDER BY t1.date DESC
    LIMIT :limit
    OFFSET :offset;`,
    {
      replacements: {
        cardno: req.user.cardno,
        limit: pageSize,
        offset: offset
      },
      type: Sequelize.QueryTypes.SELECT
    }
  );

  req.log.info('fetch_travel_bookings_success', { cardno: req.user.cardno, count: data.length });
  return res.status(200).send({ message: 'Fetched data', data: data });
};

export const CancelTravel = async (req, res) => {
  attachUserContext(req);
  const { bookingid } = req.body;
  req.log.info('cancel_travel_start', { bookingid, cardno: req.user.cardno });

  let bookingWhichCameOutOfWaiting = null;
  const t = await database.transaction();
  req.transaction = t;

  const booking = await TravelDb.findOne({
    where: {
      bookingid: bookingid,
      status: [
        STATUS_AWAITING_CONFIRMATION,
        STATUS_CONFIRMED,
        STATUS_PROCEED_FOR_PAYMENT,
        STATUS_WAITING
      ]
    }
  });

  if (!booking) {
    req.log.warn('cancel_travel_not_found', { bookingid, cardno: req.user.cardno });
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  const bookingStatus = booking.status;
  req.log.info('cancel_travel_found', {
    bookingid,
    cardno: req.user.cardno,
    currentStatus: bookingStatus,
    date: booking.date,
    pickup: booking.pickup_point,
    drop: booking.drop_point
  });

  await userCancelBooking(req.user, booking, t);
  req.log.info('cancel_travel_cancelled', {
    bookingid,
    cardno: req.user.cardno,
    previousStatus: bookingStatus,
    newStatus: 'cancelled'
  });

  // bring people from the waiting to awaiting confirmation.
  if (bookingStatus != STATUS_WAITING) {
    bookingWhichCameOutOfWaiting = await updateWaitingTravelBooking(booking, t);
    if (bookingWhichCameOutOfWaiting) {
      req.log.info('cancel_travel_waitlist_promoted', {
        promotedBookingId: bookingWhichCameOutOfWaiting.bookingid
      });
    }
  }
  await t.commit();
  req.log.info('cancel_travel_committed', { bookingid });

  try {
    await sendTravelStatusChangeWhatsApp(booking, bookingStatus);
  } catch (waErr) {
    console.error("Error triggering travel status change WhatsApp on cancel:", waErr);
  }

  const cc = process.env.NODE_ENV == 'prod' ? RAJ_PRAVAS_EMAIL : null;
  sendMail({
    email: req.user.email,
    cc,
    subject: 'Raj Pravas Booking Cancelled',
    template: 'rajPravasCancellation',
    context: {
      name: req.user.issuedto,
      bookingid: bookingid,
      date: moment(booking.date).format('Do MMMM, YYYY'),
      pickup: booking.pickup_point,
      drop: booking.drop_point
    }
  });

  if (booking.bookedBy) {
    const other = getOtherBookingUser(booking, req.user.cardno);
    if (other) {
      const title = 'Raj Pravas Booking Cancelled';
      const body =
        req.user.cardno === booking.cardno
          ? `Travel on ${moment(booking.date).format('Do MMM, YYYY')} for ${req.user.issuedto
          } has been cancelled.`
          : `Your travel on ${moment(booking.date).format(
            'Do MMM, YYYY'
          )} from ${booking.pickup_point} to ${booking.drop_point
          } has been cancelled.`;
      notifyCardno(other, {
        title,
        body,
        screen: '/bookings'
      });
    }
  }

  if (bookingWhichCameOutOfWaiting) {
    sendTravelBookingStatusUpdateMail(bookingWhichCameOutOfWaiting);
  }

  req.log.info('cancel_travel_success', { bookingid, cardno: req.user.cardno });
  return res.status(200).send({ message: MSG_CANCEL_SUCCESSFUL });
};

export const checkUpcomingEvents = async (req, res) => {
  attachUserContext(req);
  const today = moment().format('YYYY-MM-DD');
  req.log.info('check_upcoming_events_start', { cardno: req.user.cardno, date: today });

  const utsavs = await UtsavDb.findAll({
    where: {
      end_date: {
        [Sequelize.Op.gte]: today
      },
      location: RESEARCH_CENTRE
    }
  });

  req.log.info('check_upcoming_events_success', {
    cardno: req.user.cardno,
    count: utsavs.length
  });

  return res.status(200).send({
    message: 'Fetched results',
    data: utsavs
  });
};
