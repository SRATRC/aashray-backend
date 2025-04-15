import {
  TYPE_ROOM,
  ERR_BOOKING_NOT_FOUND,
  STATUS_WAITING,
  ROOM_STATUS_PENDING_CHECKIN,
  MSG_BOOKING_SUCCESSFUL,
  TYPE_GUEST_ROOM,
  TYPE_FLAT
} from '../../config/constants.js';
import {
  validateDate,
  calculateNights,
  checkFlatAlreadyBooked,
  sendUnifiedEmail,
  setBookingIdMap
} from '../helper.js';
import { userCancelBooking } from '../../helpers/transactions.helper.js';
import { RoomBooking, FlatDb, FlatBooking } from '../../models/associations.js';
import { v4 as uuidv4 } from 'uuid';
import ApiError from '../../utils/ApiError.js';
import sendMail from '../../utils/sendMail.js';
import database from '../../config/database.js';
import Sequelize from 'sequelize';

export const ViewAllBookings = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;
  const offset = (page - 1) * pageSize;

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
   UNION SELECT t4.bookingid,
          t4.cardno AS bookedFor,
          NULL AS bookedBy,
          t4.flatno AS roomno,
          t4.checkin,
          t4.checkout,
          t4.nights,
          'flat' AS roomtype,
          t4.status,
          NULL AS gender
   FROM flat_booking t4) AS combined
   LEFT JOIN transactions t2 ON combined.bookingid = t2.bookingid
   AND t2.category IN (:category)
   LEFT JOIN card_db t3 ON t3.cardno = combined.bookedFor
   WHERE combined.bookedFor = :cardno
     OR combined.bookedBy = :cardno
   ORDER BY combined.checkin DESC
   LIMIT :limit
   OFFSET :offset;
    `,
    {
      replacements: {
        cardno: req.user.cardno,
        category: [TYPE_ROOM, TYPE_GUEST_ROOM],
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
      status: [STATUS_WAITING, ROOM_STATUS_PENDING_CHECKIN]
    }
  });

  if (!booking) {
    booking = await FlatBooking.findOne({
      where: {
        bookingid: bookingid,
        [Sequelize.Op.or]: [{ cardno: req.user.cardno }],
        status: [STATUS_WAITING, ROOM_STATUS_PENDING_CHECKIN]
      }
    });

    if (!booking) throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  await userCancelBooking(req.user, booking, t);
  await t.commit();

  sendMail({
    email: req.user.email,
    subject: `Your Raj Sharan Booking at SRATRC has been cancelled.`,
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

  const flatDb = await FlatDb.findOne({
    attributes: ['flatno'],
    where: {
      owner: req.user.cardno
    }
  });

  if (!flatDb) throw new ApiError(404, 'Flat not found');

  validateDate(startDay, endDay);

  for (var mumukshu of mumukshus) {
    if (await checkFlatAlreadyBooked(startDay, endDay, mumukshu['cardno'])) {
      throw new ApiError(400, 'Already Booked');
    }
  }

  const nights = await calculateNights(startDay, endDay);

  const t = await database.transaction();
  req.transaction = t;

  let flat_bookings = [];
  const userBookingIds = {};

  for (var mumukshu of mumukshus) {
    const bookingId = uuidv4();

    flat_bookings.push({
      bookingid: bookingId,
      cardno: mumukshu['cardno'],
      flatno: flatDb.dataValues.flatno,
      checkin: startDay,
      checkout: endDay,
      nights: nights,
      updatedBy: req.user.cardno,
      status: ROOM_STATUS_PENDING_CHECKIN
    });

    userBookingIds[mumukshu['cardno']] = [bookingId];
  }

  await FlatBooking.bulkCreate(flat_bookings, { transaction: t });

  await t.commit();
  
  const userBookingIdMap = {};
  setBookingIdMap(userBookingIdMap, TYPE_FLAT, userBookingIds);

  for (const cardno in userBookingIdMap) {
    const bookings = userBookingIdMap[cardno];
    sendUnifiedEmail(cardno, bookings, req.user);
  }
  
  return res.status(201).send({ message: MSG_BOOKING_SUCCESSFUL });
};
