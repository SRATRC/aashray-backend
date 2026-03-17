import {
  TYPE_ROOM,
  ERR_BOOKING_NOT_FOUND,
  STATUS_WAITING,
  ROOM_STATUS_PENDING_CHECKIN,
  MSG_BOOKING_SUCCESSFUL,
  TYPE_GUEST_ROOM,
  TYPE_FLAT,
  STATUS_PAYMENT_PENDING,
  BOOKING_STATUS_PENDING
} from '../../config/constants.js';
import { sendUnifiedEmail, sendUnifiedEmailForBookedBy } from '../helper.js';
import { userCancelBooking } from '../../helpers/transactions.helper.js';
import { RoomBooking, FlatBooking } from '../../models/associations.js';
import { bookFlatForMumukshus } from '../../helpers/roomBooking.helper.js';
import {
  getOtherBookingUser,
  notifyCardno
} from '../../helpers/notification.helper.js';
import { attachUserContext } from '../../middleware/Logger.js';
import ApiError from '../../utils/ApiError.js';
import sendMail from '../../utils/sendMail.js';
import database from '../../config/database.js';
import Sequelize from 'sequelize';
import moment from 'moment';

export const ViewAllBookings = async (req, res) => {
  attachUserContext(req);
  const { cardno } = req.user;
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;
  const offset = (page - 1) * (pageSize - 1);

  req.log.info('fetch_room_bookings_start', { cardno, page, pageSize });

  const user_bookings = await database.query(
    `
    SELECT combined.*,
       t3.issuedto AS name,
       COALESCE(t2.amount, 0) AS amount,
       t2.status AS transaction_status
FROM
  (SELECT t1.bookingid,
          t1.cardno AS bookedFor,
          t1.bookedBy AS bookedBy,
          t1.roomno,
          t1.checkin,
          t1.checkout,
          t1.nights,
          t1.roomtype,
          t1.status,
          t1.gender
   FROM room_booking t1
   WHERE t1.cardno = :cardno
     OR t1.bookedBy = :cardno
   UNION SELECT t4.bookingid,
          t4.cardno AS bookedFor,
          t4.bookedBy bookedBy,
          t4.flatno AS roomno,
          t4.checkin,
          t4.checkout,
          t4.nights,
          'flat' AS roomtype,
          t4.status,
          NULL AS gender
   FROM flat_booking t4
   WHERE t4.cardno = :cardno
    OR t4.bookedBy = :cardno
   )
   AS combined
   LEFT JOIN transactions t2 ON combined.bookingid = t2.bookingid
   AND t2.category IN (:category)
   LEFT JOIN card_db t3 ON t3.cardno = combined.bookedFor
   ORDER BY combined.checkin DESC
   LIMIT :limit
   OFFSET :offset;
    `,
    {
      replacements: {
        cardno: req.user.cardno,
        category: [TYPE_ROOM, TYPE_GUEST_ROOM, TYPE_FLAT],
        limit: pageSize,
        offset: offset
      },
      type: Sequelize.QueryTypes.SELECT
    }
  );
  req.log.info('fetch_room_bookings_success', { cardno, count: user_bookings.length });
  return res.status(200).send(user_bookings);
};

export const CancelBooking = async (req, res) => {
  attachUserContext(req);
  const { bookingid } = req.body;
  req.log.info('cancel_room_booking_start', { bookingid, cardno: req.user.cardno });

  const t = await database.transaction();
  req.transaction = t;

  let booking = await RoomBooking.findOne({
    where: {
      bookingid: bookingid,
      [Sequelize.Op.or]: [
        { cardno: req.user.cardno },
        { bookedBy: req.user.cardno }
      ],
      status: [
        STATUS_WAITING,
        STATUS_PAYMENT_PENDING,
        ROOM_STATUS_PENDING_CHECKIN
      ]
    }
  });

  if (!booking) {
    booking = await FlatBooking.findOne({
      where: {
        bookingid: bookingid,
        [Sequelize.Op.or]: [
          { cardno: req.user.cardno },
          { bookedBy: req.user.cardno }
        ],
        status: [
          STATUS_WAITING,
          STATUS_PAYMENT_PENDING,
          ROOM_STATUS_PENDING_CHECKIN
        ]
      }
    });
  }

  if (!booking) {
    req.log.warn('cancel_room_booking_not_found', { bookingid, cardno: req.user.cardno });
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  req.log.info('cancel_room_booking_found', {
    bookingid,
    cardno: req.user.cardno,
    currentStatus: booking.status,
    roomno: booking.roomno || booking.flatno,
    checkin: booking.checkin,
    checkout: booking.checkout
  });

  await userCancelBooking(req.user, booking, t);
  req.log.info('cancel_room_booking_cancelled', { bookingid, cardno: req.user.cardno });
  await t.commit();
  req.log.info('cancel_room_booking_committed', { bookingid });

  sendMail({
    email: req.user.email,
    subject: 'Raj Sharan - Room Booking Cancelled',
    template: 'rajSharanCancellation',
    context: {
      name: req.user.issuedto,
      bookingid: booking.bookingid,
      checkin: booking.checkin,
      checkout: booking.checkout
    }
  });

  if (booking.bookedBy) {
    const other = getOtherBookingUser(booking, req.user.cardno);
    if (other) {
      const title = 'Raj Sharan Booking Cancelled';
      const body =
        req.user.cardno === booking.cardno
          ? `Room booking for ${req.user.issuedto} from ${moment(
              booking.checkin
            ).format('Do MMM, YYYY')} to ${moment(booking.checkout).format(
              'Do MMM, YYYY'
            )} has been cancelled.`
          : `Your room booking from ${moment(booking.checkin).format(
              'Do MMM, YYYY'
            )} to ${moment(booking.checkout).format(
              'Do MMM, YYYY'
            )} has been cancelled.`;
      notifyCardno(other, { title, body, screen: '/bookings' });
    }
  }

  req.log.info('cancel_room_booking_success', { bookingid, cardno: req.user.cardno });
  res.status(200).send({ message: 'Room booking cancelled' });
};

/**
 * @deprecated This endpoint is deprecated. Use the unified booking endpoint with TYPE_FLAT as primary_booking instead.
 * This endpoint is kept for backward compatibility only.
 * New implementations should use: POST /api/mumukshu-booking/booking with primary_booking.booking_type = 'flat'
 */
export const FlatBookingMumukshu = async (req, res) => {
  attachUserContext(req);
  req.log.warn('flat_booking_mumukshu_deprecated', {
    cardno: req.user.cardno,
    message: 'FlatBookingMumukshu endpoint is deprecated. Use unified booking endpoint instead.'
  });

  const { mumukshus, startDay, endDay } = req.body;
  req.log.info('flat_booking_mumukshu_start', {
    cardno: req.user.cardno,
    startDay,
    endDay,
    mumukshuCount: mumukshus?.length
  });

  const t = await database.transaction();
  req.transaction = t;

  const cardnos = mumukshus.map((mumukshu) => mumukshu['cardno']);

  const { userBookingIds, order } = await bookFlatForMumukshus(
    startDay,
    endDay,
    cardnos,
    req.user,
    t
  );

  await t.commit();
  req.log.info('flat_booking_mumukshu_committed', {
    cardno: req.user.cardno,
    orderId: order?.id,
    amount: order?.amount
  });

  sendUnifiedEmailForBookedBy(userBookingIds, req.user, BOOKING_STATUS_PENDING);

  Object.entries(userBookingIds)
    .filter(([cardno]) => cardno !== req.user.cardno) // Filter out the current user's cardno
    .forEach(([cardno, bookings]) => {
      sendUnifiedEmail(
        cardno,
        { [TYPE_FLAT]: bookings },
        req.user,
        BOOKING_STATUS_PENDING
      );
    });

  req.log.info('flat_booking_mumukshu_success', {
    cardno: req.user.cardno,
    orderId: order?.id,
    amount: order?.amount
  });
  return res.status(200).send({
    message: MSG_BOOKING_SUCCESSFUL,
    data: order
  });
};
