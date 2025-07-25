import {
  TYPE_ROOM,
  ERR_BOOKING_NOT_FOUND,
  STATUS_WAITING,
  ROOM_STATUS_PENDING_CHECKIN,
  MSG_BOOKING_SUCCESSFUL,
  TYPE_GUEST_ROOM,
  TYPE_FLAT,
  ERR_FLAT_ALREADY_BOOKED,
  STATUS_PAYMENT_PENDING,
  BOOKING_STATUS_PENDING
} from '../../config/constants.js';
import {
  validateDate,
  calculateNights,
  checkFlatAlreadyBooked,
  sendUnifiedEmail,
  sendUnifiedEmailForBookedBy
} from '../helper.js';
import {
  updateRazorpayTransactions,
  userCancelBooking
} from '../../helpers/transactions.helper.js';
import { RoomBooking, FlatDb, FlatBooking } from '../../models/associations.js';
import { bookFlatForMumukshus, createFlatBooking } from '../../helpers/roomBooking.helper.js';
import { generateOrderId } from '../../helpers/transactions.helper.js';
import ApiError from '../../utils/ApiError.js';
import sendMail from '../../utils/sendMail.js';
import database from '../../config/database.js';
import Sequelize from 'sequelize';

export const ViewAllBookings = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;
  const offset = (page - 1) * (pageSize - 1);

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
  return res.status(200).send(user_bookings);
};

export const CancelBooking = async (req, res) => {
  const { bookingid } = req.body;

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
        cardno: req.user.cardno,
        status: [
          STATUS_WAITING,
          STATUS_PAYMENT_PENDING,
          ROOM_STATUS_PENDING_CHECKIN
        ]
      }
    });
  }

  if (!booking) throw new ApiError(404, ERR_BOOKING_NOT_FOUND);

  await userCancelBooking(req.user, booking, t);
  await t.commit();

  sendMail({
    email: req.user.email,
    subject: 'Vitraag Vigyaan Aashray: Raj Sharan Booking Cancelled',
    template: 'rajSharanCancellation',
    context: {
      name: req.user.issuedto,
      bookingid: booking.bookingid,
      checkin: booking.checkin,
      checkout: booking.checkout
    }
  });

  res.status(200).send({ message: 'Room booking cancelled' });
};

export const FlatBookingMumukshu = async (req, res) => {
  const { mumukshus, startDay, endDay } = req.body;

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

  return res.status(200).send({
    message: MSG_BOOKING_SUCCESSFUL,
    data: order
  });
};
