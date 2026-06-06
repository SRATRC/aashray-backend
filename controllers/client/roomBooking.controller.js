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
import ApiError from '../../utils/ApiError.js';
import sendMail from '../../utils/sendMail.js';
import database from '../../config/database.js';
import Sequelize from 'sequelize';
import moment from 'moment';
import { sendRoomStatusChangeWhatsApp, sendFlatStatusChangeWhatsApp, sendUnifiedWhatsApp } from '../../helpers/whatsapp.helper.js';


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

  if (!booking) throw new ApiError(404, ERR_BOOKING_NOT_FOUND);

  const previousStatus = booking.status;
  await userCancelBooking(req.user, booking, t);
  await t.commit();

  if (booking instanceof RoomBooking) {
    try {
      await sendRoomStatusChangeWhatsApp(booking, previousStatus);
    } catch (waErr) {
      console.error("Error sending room cancellation WhatsApp:", waErr);
    }
  } else if (booking instanceof FlatBooking) {
    try {
      await sendFlatStatusChangeWhatsApp(booking, previousStatus);
    } catch (waErr) {
      console.error("Error sending flat cancellation WhatsApp:", waErr);
    }
  }

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

  const userBookingIdMap = {};
  for (const cardno in userBookingIds) {
    userBookingIdMap[cardno] = {
      [TYPE_FLAT]: userBookingIds[cardno]
    };
  }

  // --- WhatsApp notifications ---
  try {
    const bookedByCard = req.user.cardno;
    const allCardnos = Object.keys(userBookingIdMap || {});
    const jobs = [];

    for (const cardno of allCardnos) {
      const flatIds = userBookingIds[cardno] || [];
      const flatBookingDetails = flatIds.length
        ? await FlatBooking.findAll({ where: { bookingid: { [Sequelize.Op.in]: flatIds } } })
        : [];

      jobs.push(sendUnifiedWhatsApp(
        cardno,
        [],
        [],
        flatBookingDetails,
        [],
        [],
        null
      ));

      if (cardno !== bookedByCard) {
        jobs.push(sendUnifiedWhatsApp(
          bookedByCard,
          [],
          [],
          flatBookingDetails,
          [],
          [],
          cardno
        ));
      }
    }

    const results = await Promise.allSettled(jobs);
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.error(`WhatsApp job #${i} failed:`, r.reason);
      } else {
        console.log(`WhatsApp job #${i} succeeded`);
      }
    });
  } catch (waErr) {
    console.error("Unexpected error in WhatsApp notification block:", waErr);
  }

  sendUnifiedEmailForBookedBy(userBookingIdMap, req.user, BOOKING_STATUS_PENDING);

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
