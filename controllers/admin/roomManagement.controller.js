import {
  CardDb,
  RoomDb,
  RoomBooking,
  FlatBooking,
  Transactions,
  FlatDb
} from '../../models/associations.js';
import {
  ROOM_STATUS_PENDING_CHECKIN,
  ROOM_STATUS_CHECKEDIN,
  ROOM_STATUS_CHECKEDOUT,
  ROOM_BLOCKED,
  ROOM_STATUS_AVAILABLE,
  STATUS_INACTIVE,
  STATUS_CANCELLED,
  ERR_BOOKING_NOT_FOUND,
  ERR_ROOM_ALREADY_BOOKED,
  ERR_CARD_NOT_FOUND,
  MSG_BOOKING_SUCCESSFUL,
  MSG_UPDATE_SUCCESSFUL,
  ERR_ROOM_NOT_FOUND,
  STATUS_ADMIN_CANCELLED,
  STATUS_WAITING,
  TYPE_ROOM,
  TYPE_FLAT,
  MSG_CANCEL_SUCCESSFUL,
  ERR_FLAT_ALREADY_BOOKED,
  STATUS_CASH_PENDING,
  STATUS_PAYMENT_PENDING,
  NAC_ROOM_PRICE,
  AC_ROOM_PRICE,
  STATUS_CREDITED,
  STATUS_PAYMENT_COMPLETED,
  ERR_TRANSACTION_NOT_FOUND,
  AMT_TYPE_LATE_CHECKOUT_ROOM,
  STATUS_CONFIRMED
} from '../../config/constants.js';
import {
  checkFlatAlreadyBooked,
  calculateNights,
  validateDate,
  getBlockedDates,
  sendUnifiedEmail
} from '../helper.js';
import {
  bookDayVisit,
  checkRoomAlreadyBooked,
  createFlatBooking,
  createRoomBooking,
  roomCharge
} from '../../helpers/roomBooking.helper.js';
import {
  adminCancelTransaction,
  createPendingTransaction
} from '../../helpers/transactions.helper.js';
import { sendDualUserNotifications } from '../../helpers/notification.helper.js';
import { sendRoomStatusChangeWhatsApp, sendFlatStatusChangeWhatsApp, sendUnifiedWhatsApp, sendLateCheckoutFeeWaivedWhatsApp } from '../../helpers/whatsapp.helper.js';
import { validateCard } from '../../helpers/card.helper.js';
import { v4 as uuidv4 } from 'uuid';
import Sequelize, { Op } from 'sequelize';
import logger from '../../config/logger.js';
import { sendWhatsAppMessage } from '../../utils/sendWhatsAppMessage.js';
import { formatWhatsAppPhone } from '../../utils/phoneFormatter.js';
import moment from 'moment-timezone';
import BlockDates from '../../models/block_dates.model.js';
import RoomBlock from '../../models/room_block.model.js';
import getDates from '../../utils/getDates.js';
import database from '../../config/database.js';
import ApiError from '../../utils/ApiError.js';
import { QueryTypes } from 'sequelize';
import sequelize from '../../config/database.js';

const CHECKOUT_DEADLINE = '11:00:00';
const LATE_CHECKOUT_HALF = '15:00:00';

const calcLateCheckoutFee = (roomType, isHalfDay) => {
  if (roomType === 'nac') {
    return isHalfDay ? NAC_ROOM_PRICE / 2 : NAC_ROOM_PRICE;
  }
  return isHalfDay ? AC_ROOM_PRICE / 2 : AC_ROOM_PRICE;
};

const handleSameDayCheckout = async ({
  booking,
  checkoutTime,
  dbTransaction,
  user
}) => {
  // On-time checkout ⇒ simply mark as checked-out.
  if (checkoutTime <= CHECKOUT_DEADLINE || booking.nights < 1) {
    await booking.update(
      { status: ROOM_STATUS_CHECKEDOUT, updatedBy: user.username },
      { transaction: dbTransaction }
    );
    return;
  }

  // Late checkout ⇒ add fee (half-day if before 3 PM, full-day otherwise).
  const isHalfDay = checkoutTime <= LATE_CHECKOUT_HALF;
  const lateCheckoutAmount = calcLateCheckoutFee(
    booking.roomtype || booking.roomType,
    isHalfDay
  );
  await Transactions.create(
    {
      cardno: booking.cardno, //TODO: should this be booking.cardno or booking.bookedBy?
      bookingid: uuidv4(),
      category: TYPE_ROOM,
      amount: lateCheckoutAmount,
      amt_type: AMT_TYPE_LATE_CHECKOUT_ROOM,
      status: STATUS_CASH_PENDING,
      description: `Late checkout fee for booking ${booking.bookingid} dated ${booking.checkout}`,
      updatedBy: user.username
    },
    { transaction: dbTransaction }
  );

  await booking.update(
    { status: ROOM_STATUS_CHECKEDOUT, updatedBy: user.username },
    { transaction: dbTransaction }
  );

  sendDualUserNotifications({
    primary: {
      token: booking.CardDb.token,
      title: 'Late checkout fee',
      body: `You have been charged for late checkout. Please pay ₹${lateCheckoutAmount}`
    },
    screen: '/pendingPayments'
  });
};

/**
 * Overstay checkout handler (guest stayed beyond original checkout date).
 */
const handleOverstayCheckout = async ({
  booking,
  today,
  dbTransaction,
  user
}) => {
  const totalNights = await calculateNights(booking.checkin, today);
  const newNights = totalNights - booking.nights;
  const guest = await validateCard(booking.cardno);

  const { bookingId } = await createRoomBooking(
    booking.cardno,
    booking.checkout,
    today,
    newNights,
    booking.roomtype,
    booking.gender,
    booking.floor_pref,
    guest,
    dbTransaction,
    true
  );

  // Mark original booking as checked-out.
  await booking.update(
    { status: ROOM_STATUS_CHECKEDOUT, updatedBy: user.username },
    { transaction: dbTransaction }
  );

  // Also mark the auto-created extension booking as checked-out.
  await RoomBooking.update(
    { status: ROOM_STATUS_CHECKEDOUT, updatedBy: user.username },
    { where: { bookingid: bookingId }, transaction: dbTransaction }
  );
};

/**
 * Early checkout handler (guest leaves before planned checkout date).
 */
const handleEarlyCheckout = async ({
  booking,
  transaction,
  today,
  dbTransaction,
  user
}) => {
  const nights = await calculateNights(booking.checkin, today);
  const card = await validateCard(transaction.cardno);

  const newAmount = roomCharge(booking.roomtype) * nights;
  const originalAmount = transaction.amount + transaction.discount;

  if (newAmount > originalAmount) {
    throw new ApiError(
      400,
      'New amount is more than previously paid. This does not seem right.'
    );
  }

  const t = await database.transaction();

  // cancel the original booking and create a new booking
  await booking.update(
    {
      status: STATUS_ADMIN_CANCELLED,
      updatedBy: user.username
    },
    { transaction: t }
  );

  await adminCancelTransaction(user, card, transaction, t);

  // create a new booking with the new booking dates
  let bookingId = uuidv4();
  const newBooking = await RoomBooking.create(
    {
      bookingid: bookingId,
      roomno: booking.roomno,
      cardno: booking.cardno,
      bookedBy: booking.bookedBy,
      checkin: booking.checkin,
      checkout: today,
      nights,
      roomtype: booking.roomtype,
      gender: booking.gender,
      updatedBy: user.username,
      status: ROOM_STATUS_CHECKEDOUT
    },
    { transaction: t }
  );

  if (!newBooking) {
    throw new ApiError(400, ERR_ROOM_FAILED_TO_BOOK);
  }

  const newTransaction = await createPendingTransaction(
    card,
    newBooking,
    TYPE_ROOM,
    newAmount,
    user.username,
    t,
    true
  );

  if (!newTransaction) {
    throw new ApiError(400, ERR_ROOM_FAILED_TO_BOOK);
  }

  // need to commit the transaction before
  // the booking status is updated, as this transaction
  // holds a lock on the booking row
  await t.commit();

  // new booking's status needs to be set to 'checkedout'
  // after `createPendingTransaction` is called
  await newBooking.update(
    {
      status: ROOM_STATUS_CHECKEDOUT
    },
    {
      transaction: dbTransaction
    }
  );

  sendDualUserNotifications({
    primary: {
      token: card.token,
      title: 'Raj Sharan early checkout',
      body: "We noticed you checked out early. Adjustment amount has been credited to payer's account."
    },
    screen: '/bookings'
  });
};

export const manualCheckin = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  req.log.info('manual_checkin_start', { bookingid: req.params.bookingid });

  const today = moment().tz('Asia/Kolkata').format('YYYY-MM-DD');

  const booking = await RoomBooking.findOne({
    where: {
      bookingid: req.params.bookingid,
      status: ROOM_STATUS_PENDING_CHECKIN
    }
  });

  if (!booking) {
    req.log.warn('manual_checkin_not_found', { bookingid: req.params.bookingid });
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  if (booking.checkin > today) {
    req.log.warn('manual_checkin_too_early', { bookingid: booking.bookingid, checkin: booking.checkin, today });
    throw new ApiError(
      404,
      `Cannot check-in until ${booking.checkin}. Please ask the guest to create ` +
      `a new booking on the mobile app or you can create a new booking on admin with the ` +
      `desired check-in date.`
    );
  }

  var transaction = await Transactions.findOne({
    where: { bookingid: booking.bookingid }
  });

  if (
    transaction &&
    [STATUS_PAYMENT_PENDING, STATUS_CASH_PENDING].includes(transaction.status)
  ) {
    req.log.warn('manual_checkin_payment_pending', { bookingid: booking.bookingid, transactionStatus: transaction.status });
    throw new ApiError(400, 'Cannot check-in until payment is completed.');
  }

  const previousStatus = booking.status;
  await booking.update(
    {
      status: ROOM_STATUS_CHECKEDIN,
      updatedBy: req.user.username
    },
    { transaction: t }
  );

  await t.commit();
  req.log.info('manual_checkin_success', { bookingid: booking.bookingid, cardno: booking.cardno });

  try {
    await sendRoomStatusChangeWhatsApp(booking, previousStatus, { updatedBy: req.user.username });
  } catch (waErr) {
    logger.error("Error sending checkin WhatsApp:", waErr);
  }

  return res
    .status(200)
    .send({ message: 'Successfully checked in', data: booking });
};

// TODO: send notifications for additional payments
export const manualCheckout = async (req, res) => {
  const dbTransaction = await database.transaction();
  req.transaction = dbTransaction;

  req.log.info('manual_checkout_start', { bookingid: req.params.bookingid });

  const booking = await RoomBooking.findOne({
    include: [
      {
        model: CardDb,
        attributes: ['issuedto', 'token']
      }
    ],
    where: {
      bookingid: req.params.bookingid,
      status: ROOM_STATUS_CHECKEDIN
    }
  });

  if (!booking) {
    req.log.warn('manual_checkout_not_found', { bookingid: req.params.bookingid });
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  const transaction = await Transactions.findOne({
    where: { bookingid: booking.bookingid }
  });

  const previousStatus = booking.status;
  const nowIST = moment().tz('Asia/Kolkata');
  const today = nowIST.format('YYYY-MM-DD');
  const checkoutTime = nowIST.format('HH:mm:ss');

  req.log.info('manual_checkout_processing', { bookingid: booking.bookingid, cardno: booking.cardno, plannedCheckout: booking.checkout, today, checkoutTime });

  let checkoutOptions = {
    updatedBy: req.user.username,
    checkoutTime: nowIST.format("hh:mm a"),
    lateFee: 0
  };

  if (today === booking.checkout) {
    if (checkoutTime > CHECKOUT_DEADLINE && booking.nights >= 1) {
      const isHalfDay = checkoutTime <= LATE_CHECKOUT_HALF;
      const lateFee = calcLateCheckoutFee(booking.roomtype, isHalfDay);
      checkoutOptions.lateFee = lateFee;
      checkoutOptions.checkoutTime = nowIST.format("hh:mm a");
    }
    await handleSameDayCheckout({
      booking,
      checkoutTime,
      dbTransaction,
      user: req.user
    });
  } else if (today > booking.checkout) {
    // await handleOverstayCheckout({
    //   booking,
    //   today,
    //   dbTransaction,
    //   user: req.user
    // });
    await booking.update(
      {
        status: ROOM_STATUS_CHECKEDOUT,
        updatedBy: req.user.username
      },
      { transaction: dbTransaction }
    );
  } else {
    await handleEarlyCheckout({
      booking,
      transaction,
      today,
      dbTransaction,
      user: req.user
    });
  }

  await dbTransaction.commit();
  req.log.info('manual_checkout_success', { bookingid: booking.bookingid, cardno: booking.cardno, today });

  try {
    if (today < booking.checkout) {
      // Find the new checkout booking created in handleEarlyCheckout
      const newCheckoutBooking = await RoomBooking.findOne({
        where: {
          roomno: booking.roomno,
          cardno: booking.cardno,
          checkout: today,
          status: ROOM_STATUS_CHECKEDOUT
        }
      });
      if (newCheckoutBooking) {
        await sendRoomStatusChangeWhatsApp(newCheckoutBooking, 'checked_in', checkoutOptions);
      }
    } else {
      await sendRoomStatusChangeWhatsApp(booking, previousStatus, checkoutOptions);
    }
  } catch (waErr) {
    logger.error("Error sending checkout WhatsApp:", waErr);
  }

  return res.status(200).send({ message: 'Successfully checked out' });
};

export const cancelFlatBooking = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  req.log.info('cancel_flat_booking_start', { bookingid: req.params.bookingid });

  const booking = await FlatBooking.findOne({
    include: [
      {
        model: CardDb,
        attributes: ['issuedto', 'token']
      }
    ],
    where: {
      bookingid: req.params.bookingid,
      status: {
        [Sequelize.Op.notIn]: [
          ROOM_STATUS_CHECKEDIN,
          ROOM_STATUS_CHECKEDOUT,
          STATUS_ADMIN_CANCELLED,
          STATUS_CANCELLED
        ]
      }
    }
  });

  if (!booking) {
    req.log.warn('cancel_flat_booking_not_found', { bookingid: req.params.bookingid });
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  const originalStatus = booking.status;
  await booking.update(
    {
      status: STATUS_ADMIN_CANCELLED,
      updatedBy: req.user.username
    },
    { transaction: t }
  );

  await t.commit();
  req.log.info('cancel_flat_booking_success', { bookingid: booking.bookingid, cardno: booking.cardno });

  try {
    await sendFlatStatusChangeWhatsApp(booking, originalStatus, { updatedBy: req.user.username });
  } catch (waErr) {
    logger.error('Error sending flat booking cancellation WhatsApp:', waErr);
  }

  sendDualUserNotifications({
    primary: {
      token: booking.CardDb.token,
      title: 'Flat Booking Cancelled by Admin',
      body: `Your flat booking from ${moment(booking.checkin).format(
        'Do MMM, YYYY'
      )} to ${moment(booking.checkout).format(
        'Do MMM, YYYY'
      )} has been cancelled by admin.`
    },
    bookedBy: booking.bookedBy && {
      cardno: booking.bookedBy,
      title: 'Flat Booking Cancelled by Admin',
      body: `Flat booking for ${booking.CardDb.issuedto.split(' ')[0]
        } from ${moment(booking.checkin).format('Do MMM, YYYY')} to ${moment(
          booking.checkout
        ).format('Do MMM, YYYY')} has been cancelled by admin.`
    },
    screen: '/bookings'
  });

  return res
    .status(200)
    .send({ message: MSG_CANCEL_SUCCESSFUL, data: booking });
};

export const flatCheckin = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  req.log.info('flat_checkin_start', { bookingid: req.params.bookingid });

  const today = moment().tz('Asia/Kolkata').format('YYYY-MM-DD');

  const booking = await FlatBooking.findOne({
    where: {
      bookingid: req.params.bookingid,
      status: ROOM_STATUS_PENDING_CHECKIN
    }
  });

  if (!booking) {
    req.log.warn('flat_checkin_not_found', { bookingid: req.params.bookingid });
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  if (booking.checkin > today) {
    req.log.warn('flat_checkin_too_early', { bookingid: booking.bookingid, checkin: booking.checkin, today });
    throw new ApiError(404, `Cannot check-in until ${booking.checkin}.`);
  }

  const originalStatus = booking.status;
  await booking.update(
    {
      status: ROOM_STATUS_CHECKEDIN,
      updatedBy: req.user.username
    },
    { transaction: t }
  );

  await t.commit();
  req.log.info('flat_checkin_success', { bookingid: booking.bookingid, cardno: booking.cardno });

  try {
    await sendFlatStatusChangeWhatsApp(booking, originalStatus, { updatedBy: req.user.username });
  } catch (waErr) {
    logger.error('Error sending flat checkin WhatsApp:', waErr);
  }

  return res
    .status(200)
    .send({ message: 'Successfully checked in', data: booking });
};

export const flatCheckout = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  req.log.info('flat_checkout_start', { bookingid: req.params.bookingid });

  const booking = await FlatBooking.findOne({
    where: {
      bookingid: req.params.bookingid,
      status: ROOM_STATUS_CHECKEDIN
    }
  });

  if (!booking) {
    req.log.warn('flat_checkout_not_found', { bookingid: req.params.bookingid });
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  const today = moment().tz('Asia/Kolkata').format('YYYY-MM-DD');

  if (today > booking.checkout) {
    req.log.warn('flat_checkout_overstay', { bookingid: booking.bookingid, plannedCheckout: booking.checkout, today });
    throw new ApiError(
      404,
      `Original check-out date was ${booking.checkout}. Please create ` +
      `a new booking for the guest for the remaining days and collect the difference.`
    );
  }

  const nights = await calculateNights(booking.checkin, today);
  const originalStatus = booking.status;

  await booking.update(
    {
      nights,
      checkout: today,
      status: ROOM_STATUS_CHECKEDOUT,
      updatedBy: req.user.username
    },
    { transaction: t }
  );

  await t.commit();
  req.log.info('flat_checkout_success', { bookingid: booking.bookingid, cardno: booking.cardno, today });

  try {
    await sendFlatStatusChangeWhatsApp(booking, originalStatus, { updatedBy: req.user.username });
  } catch (waErr) {
    logger.error('Error sending flat checkout WhatsApp:', waErr);
  }

  return res.status(200).send({ message: 'Successfully checked out' });
};

export const roomBooking = async (req, res) => {
  const { mobno, cardno, checkin_date, checkout_date, room_type, floor_pref } =
    req.body;

  req.log.info('room_booking_start', { cardno, mobno, checkin_date, checkout_date, room_type });

  if (checkin_date > checkout_date) {
    throw new ApiError(400, ERR_INVALID_DATE);
  }

  const card = mobno
    ? await CardDb.findOne({ where: { mobno } })
    : await CardDb.findOne({ where: { cardno } });

  if (!card) {
    req.log.warn('room_booking_card_not_found', { cardno, mobno });
    throw new ApiError(400, ERR_CARD_NOT_FOUND);
  }

  if (await checkRoomAlreadyBooked(checkin_date, checkout_date, card.cardno)) {
    req.log.warn('room_booking_already_booked', { cardno: card.cardno, checkin_date, checkout_date });
    throw new ApiError(400, ERR_ROOM_ALREADY_BOOKED);
  }

  const t = await database.transaction();
  req.transaction = t;

  const nights = await calculateNights(checkin_date, checkout_date);

  var booking = undefined;
  if (nights == 0 && room_type === 'NA') {
    booking = await bookDayVisit(
      card.cardno,
      checkin_date,
      checkout_date,
      null,
      card.cardno,
      t
    );
  } else {
    booking = await createRoomBooking(
      card.cardno,
      checkin_date,
      checkout_date,
      nights,
      room_type,
      card.gender,
      floor_pref,
      card,
      t,
      true
    );
  }

  await t.commit();
  const bookingIdToUse = nights === 0 ? booking.bookingid : booking.bookingId;
  if (bookingIdToUse != null) {
    let bookingIds = {};
    bookingIds[TYPE_ROOM] = [bookingIdToUse];
    sendUnifiedEmail(card.cardno, bookingIds, card, STATUS_CONFIRMED, 'unifiedBookingEmail', false);
  }

  if (bookingIdToUse) {
    (async () => {
      try {
        const freshBooking = await RoomBooking.findOne({
          where: { bookingid: bookingIdToUse }
        });
        if (freshBooking) {
          await sendUnifiedWhatsApp(
            card.cardno,
            [],
            [],
            [],
            [],
            [freshBooking],
            null
          );
        }
      } catch (waErr) {
        logger.error('Error sending room booking WhatsApp notification:', waErr);
      }
    })();
  }

  sendDualUserNotifications({
    primary: {
      token: card.token,
      title: 'Raj Sharan Booking by Admin',
      body:
        'Your stay has been booked from ' +
        moment(checkin_date).format('Do MMM, YYYY') +
        ' to ' +
        moment(checkout_date).format('Do MMM, YYYY') +
        ' by admin.'
    },
    screen: '/bookings'
  });
  req.log.info('room_booking_success', { cardno: card.cardno, checkin_date, checkout_date, bookingId: booking.bookingId });
  return res.status(201).send({ message: MSG_BOOKING_SUCCESSFUL });
};

export const flatBooking = async (req, res) => {
  req.log.info('flat_booking_start', { mobno: req.params.mobno, checkin_date: req.body.checkin_date, checkout_date: req.body.checkout_date, flat_no: req.body.flat_no });

  if (req.body.checkin_date > req.body.checkout_date) {
    throw new ApiError(400, ERR_INVALID_DATE);
  }

  const card = await CardDb.findOne({
    attributes: [
      'id',
      'cardno',
      'issuedto',
      'gender',
      'mobno',
      'email',
      'credits',
      'token'
    ],
    where: {
      mobno: req.params.mobno
    }
  });

  if (!card) {
    req.log.warn('flat_booking_card_not_found', { mobno: req.params.mobno });
    throw new ApiError(404, ERR_CARD_NOT_FOUND);
  }

  if (
    await checkFlatAlreadyBooked(
      req.body.checkin_date,
      req.body.checkout_date,
      card.cardno
    )
  ) {
    req.log.warn('flat_booking_already_booked', { cardno: card.cardno, checkin_date: req.body.checkin_date, checkout_date: req.body.checkout_date });
    throw new ApiError(400, ERR_FLAT_ALREADY_BOOKED);
  }

  const nights = await calculateNights(
    req.body.checkin_date,
    req.body.checkout_date
  );

  const t = await database.transaction();
  req.transaction = t;

  const booking = await createFlatBooking(
    card.cardno,
    req.body.checkin_date,
    req.body.checkout_date,
    nights,
    req.body.flat_no,
    card,
    req.user.username,
    t,
    true
  );

  await t.commit();
  if (booking.bookingId != null) {
    let bookingIds = {};
    bookingIds[TYPE_FLAT] = [booking.bookingId];
    sendUnifiedEmail(card.cardno, bookingIds, card, STATUS_CONFIRMED, 'unifiedBookingEmail', false);
  }

  if (booking.bookingId) {
    (async () => {
      try {
        const [freshBooking, flatDetails] = await Promise.all([
          FlatBooking.findOne({
            where: { bookingid: booking.bookingId }
          }),
          FlatDb.findOne({
            where: { flatno: req.body.flat_no }
          })
        ]);
        if (freshBooking) {
          // Notify the attendee
          await sendUnifiedWhatsApp(
            card.cardno,
            [],
            [],
            [freshBooking],
            [],
            [],
            null
          );

          // If flat has an owner and flat owner is different from attendee, notify owner too
          if (flatDetails && flatDetails.owner && flatDetails.owner !== card.cardno) {
            await sendUnifiedWhatsApp(
              flatDetails.owner,
              [],
              [],
              [freshBooking],
              [],
              [],
              card.cardno
            );
          }
        }
      } catch (waErr) {
        logger.error('Error sending flat booking WhatsApp notification:', waErr);
      }
    })();
  }

  sendDualUserNotifications({
    primary: {
      token: card.token,
      title: 'Flat Booking by Admin',
      body:
        'Your flat booking for flat no. ' +
        req.body.flat_no +
        ' has been confirmed from ' +
        moment(booking.checkin).format('Do MMM, YYYY') +
        ' to ' +
        moment(booking.checkout).format('Do MMM, YYYY') +
        ' by admin.'
    },
    screen: '/bookings'
  });

  req.log.info('flat_booking_success', { cardno: card.cardno, flat_no: req.body.flat_no, checkin: req.body.checkin_date, checkout: req.body.checkout_date, bookingId: booking.bookingId });
  return res.status(201).send({ message: MSG_BOOKING_SUCCESSFUL });
};

export const fetchAllRoomBookings = async (req, res) => {
  req.log.info('fetch_all_room_bookings_start');

  const bookings = await RoomBooking.findAll({
    order: [['checkin', 'ASC']]
  });

  req.log.info('fetch_all_room_bookings_success', { count: bookings.length });
  return res.status(200).send({ message: 'Fetched bookings', data: bookings });
};

export const fetchAllFlatBookings = async (req, res) => {
  req.log.info('fetch_all_flat_bookings_start');

  const bookings = await FlatBooking.findAll({
    order: [['checkin', 'ASC']]
  });

  req.log.info('fetch_all_flat_bookings_success', { count: bookings.length });
  return res.status(200).send({ message: 'Fetched bookings', data: bookings });
};

export const fetchRoomBookingsByCard = async (req, res) => {
  const cardno = req.params.cardno;
  req.log.info('fetch_room_bookings_by_card_start', { cardno });

  const bookings = await RoomBooking.findAll({
    where: { cardno },
    order: [['checkin', 'ASC']]
  });

  req.log.info('fetch_room_bookings_by_card_success', { cardno, count: bookings.length });
  return res.status(200).send({ message: 'Fetched bookings', data: bookings });
};

export const fetchFlatBookingsByCard = async (req, res) => {
  const cardno = req.params.cardno;
  req.log.info('fetch_flat_bookings_by_card_start', { cardno });

  const bookings = await FlatBooking.findAll({
    where: { cardno },
    order: [['checkin', 'ASC']]
  });

  req.log.info('fetch_flat_bookings_by_card_success', { cardno, count: bookings.length });
  return res.status(200).send({ message: 'Fetched bookings', data: bookings });
};

export const updateRoomBooking = async (req, res) => {
  const { bookingid, roomno } = req.body;

  req.log.info('update_room_booking_start', { bookingid, roomno });

  const booking = await RoomBooking.findOne({
    include: [
      {
        model: CardDb,
        attributes: ['issuedto', 'token', 'cardno', 'mobno', 'country']
      }
    ],
    where: { bookingid }
  });

  if (!booking) {
    req.log.warn('update_room_booking_not_found', { bookingid });
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  const t = await database.transaction();
  req.transaction = t;

  await booking.update(
    {
      roomno,
      updatedBy: req.user.username
    },
    { transaction: t }
  );

  sendDualUserNotifications({
    primary: {
      token: booking.CardDb.token,
      title: 'Room number changed',
      body: `Your room number has been changed to ${roomno}`
    },
    screen: '/bookings'
  });

  await t.commit();
  req.log.info('update_room_booking_success', { bookingid, oldRoomno: booking.roomno, newRoomno: roomno });

  // --- Send WhatsApp notification for Room Number change ---
  const phone = booking.CardDb?.mobno;
  if (phone) {
    try {
      const formattedPhone = formatWhatsAppPhone(phone, booking.CardDb?.country);

      const checkinFormatted = booking.checkin ? moment(booking.checkin).format("DD-MM-YYYY") : "";
      const checkoutFormatted = booking.checkout ? moment(booking.checkout).format("DD-MM-YYYY") : "";

      const components = [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: booking.CardDb.issuedto || 'Mumukshu' },
            { type: 'text', text: roomno },
            { type: 'text', text: checkinFormatted },
            { type: 'text', text: checkoutFormatted }
          ]
        }
      ];

      await sendWhatsAppMessage(formattedPhone, 'room_number_updated', components);
    } catch (waErr) {
      console.error('Error sending WhatsApp room_number_updated message:', waErr.message || waErr);
    }
  }

  return res.status(200).send({ message: MSG_UPDATE_SUCCESSFUL });
};

export const updateFlatBooking = async (req, res) => {
  const { bookingid, flatno, checkin_date, checkout_date, status } = req.body;

  req.log.info('update_flat_booking_start', { bookingid, flatno, checkin_date, checkout_date, status });

  validateDate(checkin_date, checkout_date);

  const nights = await calculateNights(checkin_date, checkout_date);
  const booking = await FlatBooking.findOne({
    include: [
      {
        model: CardDb,
        attributes: ['issuedto', 'token']
      }
    ],
    where: { bookingid }
  });
  if (!booking) {
    req.log.warn('update_flat_booking_not_found', { bookingid });
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  const originalStatus = booking.status;
  await booking.update({
    flatno,
    checkin: checkin_date,
    checkout: checkout_date,
    nights,
    status,
    updatedBy: req.user.username
  });

  sendDualUserNotifications({
    primary: {
      token: booking.CardDb.token,
      title: 'Flat booking updated',
      body: 'Your flat booking has been updated by admin. Please check your bookings.'
    },
    screen: '/bookings'
  });

  req.log.info('update_flat_booking_success', { bookingid, flatno, status });

  if (status && status !== originalStatus) {
    try {
      await sendFlatStatusChangeWhatsApp(booking, originalStatus, { updatedBy: req.user.username });
    } catch (waErr) {
      logger.error('Error sending flat booking update status WhatsApp:', waErr);
    }
  }

  return res.status(200).send({ message: MSG_UPDATE_SUCCESSFUL });
};

export const roomList = async (req, res) => {
  req.log.info('room_list_start');

  const result = await RoomDb.findAll({
    attributes: ['roomno', 'roomtype', 'gender', 'roomstatus'],
    where: {
      roomno: {
        [Sequelize.Op.notIn]: ['NA', 'WL']
      }
    },
    include: [
      {
        model: RoomBlock,
        as: 'blocks',
        where: { status: 'active' },
        required: false,
        attributes: ['id', 'start_date', 'end_date', 'reason']
      }
    ]
  });

  req.log.info('room_list_success', { count: result.length });
  return res.status(200).send({ message: 'Success', data: result });
};

export const flatList = async (req, res) => {
  req.log.info('flat_list_start');

  const flats = await FlatDb.findAll({
    attributes: [[Sequelize.fn('DISTINCT', Sequelize.col('flatno')), 'flatno']]
  });

  req.log.info('flat_list_success', { count: flats.length });
  return res.status(200).send({ message: 'Success', data: flats });
};

export const availableRooms = async (req, res) => {
  const bookingid = req.params.bookingid;
  req.log.info('available_rooms_start', { bookingid });

  const booking = await RoomBooking.findOne({
    where: { bookingid }
  });

  if (!booking) {
    req.log.warn('available_rooms_booking_not_found', { bookingid });
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  const rooms = await findAllRoomsUnfiltered(booking.roomtype, booking.gender);

  req.log.info('available_rooms_success', { bookingid, roomtype: booking.roomtype, count: rooms.length });
  return res
    .status(200)
    .send({ message: 'Fetched available rooms', data: rooms });
};

export const availableRoomsForDay = async (req, res) => {
  const { date, roomtype, gender } = req.query;
  req.log.info('available_rooms_for_day_start', { date, roomtype, gender });

  const rooms = await findAllRoomsForDay(date, roomtype, gender);

  req.log.info('available_rooms_for_day_success', { date, roomtype, count: rooms.length });
  return res.status(200).send({
    message: 'Fetched available rooms',
    data: rooms
  });
};

export const blockRoom = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  req.log.info('block_room_start', { roomno: req.params.roomno });

  const rooms = await RoomDb.findAll({
    where: {
      roomno: {
        [Sequelize.Op.like]: `${req.params.roomno}%`
      },
      roomstatus: { [Sequelize.Op.not]: ROOM_BLOCKED }
    }
  });

  if (rooms.length == 0) {
    req.log.warn('block_room_not_found', { roomno: req.params.roomno });
    throw new ApiError(400, ERR_ROOM_NOT_FOUND);
  }

  for (const room of rooms) {
    await room.update(
      {
        roomstatus: ROOM_BLOCKED,
        updatedBy: req.user.username
      },
      { transaction: t }
    );
  }

  await t.commit();
  req.log.info('block_room_success', { roomno: req.params.roomno, count: rooms.length });
  return res.status(200).send({ message: MSG_UPDATE_SUCCESSFUL });
};

export const unblockRoom = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  req.log.info('unblock_room_start', { roomno: req.params.roomno });

  const rooms = await RoomDb.findAll({
    where: {
      roomno: {
        [Sequelize.Op.like]: `${req.params.roomno}%`
      },
      roomstatus: ROOM_BLOCKED
    }
  });

  if (rooms.length == 0) {
    req.log.warn('unblock_room_not_found', { roomno: req.params.roomno });
    throw new ApiError(400, ERR_ROOM_NOT_FOUND);
  }

  for (const room of rooms) {
    await room.update(
      {
        roomstatus: ROOM_STATUS_AVAILABLE,
        updatedBy: req.user.username
      },
      { transaction: t }
    );
  }

  await t.commit();
  req.log.info('unblock_room_success', { roomno: req.params.roomno, count: rooms.length });
  return res.status(200).send({ message: MSG_UPDATE_SUCCESSFUL });
};

// ─── Room Block (date-range / permanent) ─────────────────────────────────────

export const createRoomBlock = async (req, res) => {
  const { roomno, start_date, end_date, reason, blockAllBeds = true } = req.body;
  req.log.info('create_room_block_start', { roomno, start_date, end_date, blockAllBeds });

  if (!roomno || !start_date) {
    throw new ApiError(400, 'roomno and start_date are required');
  }
  if (end_date && end_date <= start_date) {
    throw new ApiError(400, 'end_date must be after start_date');
  }

  // Resolve room beds to block
  let roomsToBlock = [];
  if (Array.isArray(roomno)) {
    const rooms = await RoomDb.findAll({
      attributes: ['roomno'],
      where: { roomno: { [Op.in]: roomno } }
    });
    roomsToBlock = rooms;
  } else if (blockAllBeds) {
    const baseRoomNo = roomno.slice(0, -1);
    const rooms = await RoomDb.findAll({
      attributes: ['roomno'],
      where: { roomno: { [Op.like]: `${baseRoomNo}%` } }
    });
    roomsToBlock = rooms.filter(r => {
      const suffix = r.roomno.slice(baseRoomNo.length);
      return /^[a-zA-Z]$/.test(suffix);
    });
  } else {
    const room = await RoomDb.findOne({
      attributes: ['roomno'],
      where: { roomno }
    });
    if (room) roomsToBlock = [room];
  }

  if (roomsToBlock.length === 0) {
    throw new ApiError(404, ERR_ROOM_NOT_FOUND);
  }

  const roomNosToBlock = roomsToBlock.map(r => r.roomno);

  // Check for conflicting bookings in the date range and warn
  const conflictWhere = {
    roomno: { [Op.in]: roomNosToBlock },
    status: { [Op.notIn]: [STATUS_CANCELLED, STATUS_ADMIN_CANCELLED] },
    checkin: { [Op.lt]: end_date || '9999-12-31' },
    checkout: { [Op.gt]: start_date }
  };
  const conflictingBookings = await RoomBooking.findAll({
    attributes: ['bookingid', 'roomno', 'checkin', 'checkout'],
    where: conflictWhere
  });

  const blocks = await Promise.all(
    roomsToBlock.map((room) =>
      RoomBlock.create({
        roomno: room.roomno,
        start_date,
        end_date: end_date || null,
        reason: reason || null,
        status: 'active',
        createdBy: req.user.username,
        updatedBy: req.user.username
      })
    )
  );

  req.log.info('create_room_block_success', { roomno, count: blocks.length });
  return res.status(201).send({
    message: 'Room blocked successfully',
    data: blocks,
    warnings:
      conflictingBookings.length > 0
        ? {
            message: `${conflictingBookings.length} existing booking(s) overlap this block. Please reassign affected guests.`,
            bookings: conflictingBookings
          }
        : null
  });
};

export const listRoomBlocks = async (req, res) => {
  const { roomno } = req.query;
  req.log.info('list_room_blocks_start', { roomno });

  const where = { status: 'active' };
  if (roomno) where.roomno = { [Op.like]: `${roomno}%` };

  const blocks = await RoomBlock.findAll({
    where,
    order: [['start_date', 'ASC'], ['roomno', 'ASC']]
  });

  req.log.info('list_room_blocks_success', { count: blocks.length });
  return res.status(200).send({ message: 'Success', data: blocks });
};

export const cancelRoomBlock = async (req, res) => {
  const { id } = req.params;
  const { allBeds } = req.query;
  req.log.info('cancel_room_block_start', { id, allBeds });

  const block = await RoomBlock.findOne({ where: { id, status: 'active' } });
  if (!block) throw new ApiError(404, 'Room block not found or already cancelled');

  if (allBeds === 'true') {
    const baseRoomNo = block.roomno.slice(0, -1);
    // Find all active blocks for rooms starting with baseRoomNo on the same dates
    const blocks = await RoomBlock.findAll({
      where: {
        status: 'active',
        start_date: block.start_date,
        end_date: block.end_date,
        roomno: { [Op.like]: `${baseRoomNo}%` }
      }
    });

    // Filter to only match suffix like A, B, C, D (exclude rooms like 11A when baseRoomNo is 1)
    const filteredBlocks = blocks.filter(b => {
      const suffix = b.roomno.slice(baseRoomNo.length);
      return /^[a-zA-Z]$/.test(suffix);
    });

    await Promise.all(
      filteredBlocks.map(b =>
        b.update({ status: 'cancelled', updatedBy: req.user.username })
      )
    );

    req.log.info('cancel_room_block_success_all_beds', { baseRoomNo, count: filteredBlocks.length });
    return res.status(200).send({ message: 'Room blocks cancelled successfully for all beds' });
  } else {
    await block.update({ status: 'cancelled', updatedBy: req.user.username });
    req.log.info('cancel_room_block_success', { id });
    return res.status(200).send({ message: 'Room block cancelled successfully' });
  }
};

export const bulkCancelRoomBlocks = async (req, res) => {
  const { roomnos } = req.body;
  req.log.info('bulk_cancel_room_blocks_start', { count: roomnos ? roomnos.length : 0 });

  if (!roomnos || !Array.isArray(roomnos) || roomnos.length === 0) {
    throw new ApiError(400, 'roomnos array is required');
  }

  const [affectedCount] = await RoomBlock.update(
    { status: 'cancelled', updatedBy: req.user.username },
    {
      where: {
        status: 'active',
        roomno: { [Op.in]: roomnos }
      }
    }
  );

  req.log.info('bulk_cancel_room_blocks_success', { affected: affectedCount });
  return res.status(200).send({ message: `Successfully cancelled blocks for ${affectedCount} beds` });
};

export const updateRoom = async (req, res) => {
  const { roomtype, gender } = req.body;
  const roomno = req.params.roomno;

  req.log.info('update_room_start', { roomno, roomtype, gender });

  // Get base room number (e.g. "1" from "1A" or "1")
  const baseRoomNo = /^[0-9]+[a-zA-Z]$/.test(roomno) ? roomno.slice(0, -1) : roomno;

  const t = await database.transaction();
  req.transaction = t;

  // Find all beds of this base room (e.g., 1A, 1B, 1C, 1D)
  const rooms = await RoomDb.findAll({
    where: {
      roomno: { [Op.like]: `${baseRoomNo}%` }
    }
  });

  // Filter to avoid matching rooms like 11A when baseRoomNo is 1
  const roomsToUpdate = rooms.filter(r => {
    const suffix = r.roomno.slice(baseRoomNo.length);
    return /^[a-zA-Z]?$/.test(suffix); // matching suffix like "", "A", "B", etc.
  });

  if (roomsToUpdate.length === 0) {
    req.log.warn('update_room_not_found', { roomno });
    throw new ApiError(400, ERR_ROOM_NOT_FOUND);
  }

  for (const room of roomsToUpdate) {
    await room.update(
      {
        roomtype,
        gender,
        updatedBy: req.user.username
      },
      { transaction: t }
    );
  }

  await t.commit();
  req.log.info('update_room_success', { baseRoomNo, count: roomsToUpdate.length, roomtype, gender });
  return res.status(200).send({ message: MSG_UPDATE_SUCCESSFUL });
};

export const rcBlockList = async (req, res) => {
  req.log.info('rc_block_list_start');

  const today = moment().tz('Asia/Kolkata').format('YYYY-MM-DD');
  const blocked = await BlockDates.findAll({
    attributes: ['id', 'checkin', 'checkout', 'comments', 'status'],
    where: {
      checkout: { [Sequelize.Op.gte]: today }
    },
    order: [['checkin', 'ASC']]
  });

  req.log.info('rc_block_list_success', { count: blocked.length });
  return res
    .status(200)
    .send({ message: 'Fetched RC block list', data: blocked });
};

export const blockRC = async (req, res) => {
  const { checkin_date, checkout_date, comments } = req.body;
  req.log.info('block_rc_start', { checkin_date, checkout_date, comments });

  const blockedDates = await getBlockedDates(checkin_date, checkout_date);

  if (blockedDates.length > 0) {
    req.log.warn('block_rc_already_blocked', { checkin_date, checkout_date, conflictCount: blockedDates.length });
    throw new ApiError(
      400,
      'Already blocked on one or more of the given dates',
      blockedDates
    );
  }

  const block = await BlockDates.create({
    checkin: checkin_date,
    checkout: checkout_date,
    comments,
    updatedBy: req.user.username
  });

  if (!block) {
    throw new ApiError(400, 'Error occured while blocking RC');
  }

  req.log.info('block_rc_success', { checkin_date, checkout_date });
  return res.status(200).send({ message: 'Blocked RC successfully' });
};

export const unblockRC = async (req, res) => {
  req.log.info('unblock_rc_start', { id: req.params.id });

  const blocked = await BlockDates.findByPk(req.params.id);

  if (!blocked) {
    req.log.warn('unblock_rc_not_found', { id: req.params.id });
    throw new ApiError(404, 'Block record not found');
  }

  await blocked.update({
    status: STATUS_INACTIVE,
    updatedBy: req.user.username
  });

  req.log.info('unblock_rc_success', { id: req.params.id });
  return res.status(200).send({ message: 'Unblocked RC successfully' });
};

export const occupancyReport = async (req, res) => {
  const { date } = req.query;
  const targetDate = date || moment().tz('Asia/Kolkata').format('YYYY-MM-DD');

  req.log.info('occupancy_report_start', { targetDate });

  const rooms = await RoomBooking.findAll({
    attributes: [
      'bookingid',
      'roomtype',
      'roomno',
      'checkin',
      'checkout',
      'bookedBy',
      'status',
      'nights'
    ],
    include: [
      {
        model: CardDb,
        attributes: ['cardno', 'issuedto', 'mobno', 'center']
      }
    ],
    where: {
      [Op.or]: [
        {
          status: ROOM_STATUS_CHECKEDIN,
          checkin: { [Op.lte]: targetDate },
          checkout: { [Op.gte]: targetDate }
        },
        {
          status: ROOM_STATUS_CHECKEDOUT,
          checkout: targetDate
        },
        {
          status: ROOM_STATUS_PENDING_CHECKIN,
          checkin: targetDate
        }
      ]
    }
  });

  const combined = rooms
    .filter(r => r.nights > 0 && r.checkin !== r.checkout && r.roomno && String(r.roomno).trim().toUpperCase() !== 'NA')
    .map(r => ({
      ...r.toJSON(),
      type: 'Room'
    }));

  combined.sort((a, b) => String(a.roomno).localeCompare(String(b.roomno), undefined, { numeric: true }));

  req.log.info('occupancy_report_success', { count: combined.length });
  return res.status(200).send({ message: 'Success', data: combined });
};

export const ReservationReport = async (req, res) => {
  const { start_date, end_date, statuses } = req.query;
  req.log.info('reservation_report_start', { start_date, end_date, statuses });

  // Pagination is optional: the admin report UI fetches the full result set,
  // so we only paginate when the caller explicitly provides a valid page_size.
  const page = parseInt(req.query.page) || req.body.page || 1;
  const rawPageSize = req.query.page_size || req.body.page_size;
  let pageSize = rawPageSize ? parseInt(rawPageSize) : null;
  if (pageSize !== null && (Number.isNaN(pageSize) || pageSize <= 0)) {
    req.log.warn('reservation_report_invalid_page_size', { page_size: rawPageSize });
    pageSize = null;
  }

  const reservations = await roomBookingReport(
    start_date,
    end_date,
    page,
    pageSize,
    statuses
  );

  req.log.info('reservation_report_success', { start_date, end_date, count: reservations.length });
  return res
    .status(200)
    .send({ message: 'Fetched room reservation report', data: reservations });
};

export const flatReservationReport = async (req, res) => {
  const { start_date, end_date, statuses } = req.query;
  req.log.info('flat_reservation_report_start', { start_date, end_date, statuses });

  // Handle if `statuses` is not provided or is a single value
  const statusArray = Array.isArray(statuses)
    ? statuses
    : statuses
      ? [statuses]
      : null;

  const whereClause = {
    [Sequelize.Op.or]: [
      { checkin: { [Sequelize.Op.between]: [start_date, end_date] } },
      { checkout: { [Sequelize.Op.between]: [start_date, end_date] } }
    ]
  };

  if (statusArray) {
    whereClause.status = { [Sequelize.Op.in]: statusArray };
  }

  let bookings = await FlatBooking.findAll({
    include: [
      {
        model: CardDb,
        attributes: ['cardno', 'issuedto', 'mobno', 'center'],
        required: true
      }
    ],
    attributes: [
      'bookingid',
      'flatno',
      'checkin',
      'checkout',
      'status',
      'nights'
    ],
    where: whereClause,
    order: [['checkin', 'ASC']]
  });

  bookings = await attachLatestTransactions(bookings);

  req.log.info('flat_reservation_report_success', { start_date, end_date, count: bookings.length });
  return res
    .status(200)
    .send({ message: 'Fetched flat reservation report', data: bookings });
};

export const dayWiseGuestCountReport = async (req, res) => {
  const { start_date, end_date } = req.query;
  req.log.info('day_wise_guest_count_report_start', { start_date, end_date });

  const allDates = getDates(start_date, end_date);

  const data = [];

  for (let date of allDates) {
    // Get total confirmed bookings for this date
    const report = await RoomBooking.findOne({
      attributes: [
        [
          Sequelize.fn(
            'SUM',
            Sequelize.literal(`CASE WHEN roomtype = 'nac' THEN 1 ELSE 0 END`)
          ),
          'nac'
        ],
        [
          Sequelize.fn(
            'SUM',
            Sequelize.literal(`CASE WHEN roomtype = 'ac' THEN 1 ELSE 0 END`)
          ),
          'ac'
        ]
      ],
      where: {
        checkin: { [Sequelize.Op.lte]: date },
        checkout: { [Sequelize.Op.gt]: date },
        status: [
          ROOM_STATUS_PENDING_CHECKIN,
          ROOM_STATUS_CHECKEDIN,
          STATUS_PAYMENT_PENDING
        ]
      },
      raw: true
    });

    const acRooms = await findAllRoomsForDay(date, 'ac');
    const nacRooms = await findAllRoomsForDay(date, 'nac');

    data.push({
      date: date,
      ac: parseInt(report.ac) || 0,
      nac: parseInt(report.nac) || 0,
      ac_available: acRooms.length,
      nac_available: nacRooms.length
    });
  }

  req.log.info('day_wise_guest_count_report_success', { start_date, end_date, dateCount: data.length });
  return res.status(200).send({ message: 'Fetched daywise report', data });
};

async function roomBookingReport(startDate, endDate, page, pageSize, statuses) {
  const queryOptions = {
    include: [
      {
        model: CardDb,
        attributes: ['cardno', 'issuedto', 'mobno', 'center', 'credits'],
        required: true
      }
    ],
    attributes: [
      'bookingid',
      'roomno',
      'roomtype',
      'checkin',
      'checkout',
      'bookedBy',
      'status',
      'nights'
    ],
    where: {
      status: statuses,
      [Sequelize.Op.or]: [
        { checkin: { [Sequelize.Op.between]: [startDate, endDate] } },
        { checkout: { [Sequelize.Op.between]: [startDate, endDate] } }
      ]
    },
    order: [['checkin', 'ASC']]
  };

  // Only apply limit/offset when the caller explicitly requested pagination.
  if (pageSize) {
    queryOptions.limit = pageSize;
    queryOptions.offset = ((page || 1) - 1) * pageSize;
  }

  const bookings = await RoomBooking.findAll(queryOptions);
  return attachLatestTransactions(bookings);
}

// Attach each booking's most recent transaction as a single-element
// `transactions` array (or []), matching the shape the admin report UI reads
// (`booking.transactions[0]`). Uses one batched query instead of Sequelize's
// per-row `separate: true` + `limit: 1` include, which fires one query per
// booking — the N+1 that exhausted the DB connection pool on large reports.
async function attachLatestTransactions(bookings) {
  const bookingIds = bookings.map((b) => b.bookingid);
  if (bookingIds.length === 0) return bookings;

  const txns = await Transactions.findAll({
    attributes: ['bookingid', 'status', 'description'],
    where: { bookingid: { [Op.in]: bookingIds } },
    order: [['createdAt', 'DESC']]
  });

  // Rows are newest-first, so the first row seen per booking is its latest.
  const latestByBooking = new Map();
  for (const txn of txns) {
    if (!latestByBooking.has(txn.bookingid)) {
      latestByBooking.set(txn.bookingid, {
        status: txn.status,
        description: txn.description
      });
    }
  }

  for (const booking of bookings) {
    const latest = latestByBooking.get(booking.bookingid);
    booking.setDataValue('transactions', latest ? [latest] : []);
  }

  return bookings;
}

export const updateBookingStatus = async (req, res) => {
  const { bookingid, status, description } = req.body;

  req.log.info('update_room_booking_status_start', { bookingid, status });

  const booking = await RoomBooking.findOne({
    include: [
      {
        model: CardDb,
        attributes: ['issuedto', 'token']
      }
    ],
    where: { bookingid }
  });
  if (!booking) {
    req.log.warn('update_room_booking_status_not_found', { bookingid });
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  const t = await database.transaction();
  req.transaction = t;

  const originalStatus = booking.status;
  let newStatus = originalStatus;

  if (!status || status === originalStatus) {
    req.log.warn('update_room_booking_status_same_or_missing', { bookingid, status, originalStatus });
    throw new ApiError(400, 'Status is same as before or missing');
  }

  if (originalStatus === STATUS_ADMIN_CANCELLED) {
    req.log.warn('update_room_booking_status_already_cancelled', { bookingid });
    throw new ApiError(400, ERR_BOOKING_ALREADY_CANCELLED);
  }

  switch (status) {
    case STATUS_PAYMENT_PENDING: {
      if (originalStatus !== STATUS_WAITING) {
        throw new ApiError(400, 'Pending can only be set from waiting status');
      }

      const cardno = booking.bookedBy || booking.cardno;
      const card = await validateCard(cardno);

      const rate = booking.roomtype?.toLowerCase() === 'ac' ? 1100 : 700;
      const baseAmount = rate * booking.nights;

      let discount = 0;
      let finalAmount = baseAmount;
      let txDescription = description || 'Payment pending for room booking';
      let txStatus = STATUS_PAYMENT_PENDING;

      let updatedCredits = card.credits || {};
      const currentRoomCredits = parseInt(updatedCredits.room || 0);

      if (currentRoomCredits > 0) {
        discount = Math.min(currentRoomCredits, baseAmount);
        finalAmount = baseAmount - discount;
        txDescription += ` | Credits used: ₹${discount}`;

        updatedCredits.room = currentRoomCredits - discount;

        await CardDb.update(
          { credits: updatedCredits },
          { where: { cardno }, transaction: t }
        );
      }

      if (finalAmount === 0) {
        newStatus = ROOM_STATUS_PENDING_CHECKIN;
        txStatus = STATUS_PAYMENT_COMPLETED;
      } else {
        newStatus = STATUS_PAYMENT_PENDING;
        txStatus = STATUS_CASH_PENDING;
      }

      await booking.update(
        {
          amount: finalAmount,
          status: newStatus,
          updatedBy: req.user.username
        },
        { transaction: t }
      );

      await Transactions.create(
        {
          bookingid,
          cardno,
          category: TYPE_ROOM,
          amount: finalAmount,
          discount,
          razorpay_order_id: null,
          description: txDescription,
          status: txStatus,
          updatedBy: req.user.username
        },
        { transaction: t }
      );

      break;
    }

    case ROOM_STATUS_PENDING_CHECKIN: {
      if (originalStatus !== STATUS_PAYMENT_PENDING) {
        throw new ApiError(
          400,
          'Can only mark pending checkin from payment pending'
        );
      }

      const tx = await Transactions.findOne({
        where: { bookingid },
        order: [['createdAt', 'DESC']],
        transaction: t
      });

      if (!tx) {
        throw new ApiError(400, ERR_TRANSACTION_NOT_FOUND);
      }

      await tx.update(
        {
          status: STATUS_PAYMENT_COMPLETED,
          updatedBy: req.user.username,
          description: description || tx.description
        },
        { transaction: t }
      );

      newStatus = ROOM_STATUS_PENDING_CHECKIN;
      await booking.update(
        {
          status: newStatus,
          updatedBy: req.user.username
        },
        { transaction: t }
      );

      break;
    }

    case STATUS_ADMIN_CANCELLED: {
      if (![STATUS_WAITING, STATUS_PAYMENT_PENDING].includes(originalStatus)) {
        throw new ApiError(
          400,
          'Admin Cancelled allowed only from waiting or pending'
        );
      }

      const tx = await Transactions.findOne({
        where: { bookingid },
        order: [['createdAt', 'DESC']],
        transaction: t
      });

      if (
        tx &&
        ![
          STATUS_CREDITED,
          STATUS_CANCELLED,
          STATUS_ADMIN_CANCELLED,
          STATUS_PAYMENT_COMPLETED
        ].includes(tx.status)
      ) {
        await tx.update(
          {
            status: STATUS_ADMIN_CANCELLED,
            updatedBy: req.user.username,
            description: description || tx.description
          },
          { transaction: t }
        );
      }

      newStatus = STATUS_ADMIN_CANCELLED;

      await booking.update(
        {
          status: newStatus,
          updatedBy: req.user.username
        },
        { transaction: t }
      );

      break;
    }

    case STATUS_WAITING:
      throw new ApiError(400, 'Cannot revert back to waiting');

    default:
      throw new ApiError(400, 'Invalid status provided');
  }

  switch (newStatus) {
    case STATUS_ADMIN_CANCELLED: {
      sendDualUserNotifications({
        primary: {
          token: booking.CardDb.token,
          title: 'Raj Sharan Cancelled',
          body: 'Your room booking has been cancelled by admin.'
        },
        bookedBy: booking.bookedBy && {
          cardno: booking.bookedBy,
          title: 'Raj Sharan Cancelled',
          body: `Stay for ${booking.CardDb.issuedto.split(' ')[0]
            } has been cancelled by admin.`
        },
        screen: '/bookings'
      });
      break;
    }
    case STATUS_PAYMENT_PENDING: {
      sendDualUserNotifications({
        primary: {
          token: booking.CardDb.token,
          title: 'Raj Sharan booking status update',
          body: 'Raj Sharan status has been updated to payment pending. Please complete payment within 24 hours.'
        },
        bookedBy: booking.bookedBy && {
          cardno: booking.bookedBy,
          title: 'Raj Sharan booking status update',
          body: `Payment is required for stay of ${booking.CardDb.issuedto.split(' ')[0]
            }. Please complete payment within 24 hours.`
        },
        screen: '/bookings'
      });
      break;
    }
    case ROOM_STATUS_PENDING_CHECKIN: {
      sendDualUserNotifications({
        primary: {
          token: booking.CardDb.token,
          title: 'Raj Sharan booking confirmed',
          body: 'Your room booking has been confirmed and is ready for check-in.'
        },
        bookedBy: booking.bookedBy && {
          cardno: booking.bookedBy,
          title: 'Raj Sharan booking confirmed',
          body: `Room booking for ${booking.CardDb.issuedto.split(' ')[0]
            } has been confirmed by admin.`
        },
        screen: '/bookings'
      });
      break;
    }
    default:
      break;
  }

  await t.commit();
  req.log.info('update_room_booking_status_transition', { bookingid, fromStatus: originalStatus, toStatus: newStatus });

  try {
    await sendRoomStatusChangeWhatsApp(booking, originalStatus, { updatedBy: req.user.username });
  } catch (waErr) {
    logger.error("Error sending room status update WhatsApp:", waErr);
  }

  return res.status(200).send({ message: MSG_UPDATE_SUCCESSFUL });
};

export async function findAllRoomsForDay(date, room_type, gender) {
  // Step 1: Determine which roomnos are booked (pending checkin or checkedin)
  const bookings = await RoomBooking.findAll({
    attributes: ['roomno'],
    where: {
      [Sequelize.Op.and]: [
        { checkin: { [Sequelize.Op.lte]: date } },
        { checkout: { [Sequelize.Op.gt]: date } } // i.e., date ∈ [checkin, checkout)
      ],
      status: {
        [Sequelize.Op.in]: [
          ROOM_STATUS_PENDING_CHECKIN,
          ROOM_STATUS_CHECKEDIN,
          STATUS_PAYMENT_PENDING
        ]
      }
    }
  });

  const bookedRoomNos = bookings.map((b) => b.roomno);

  // Step 2: Determine which roomnos are admin-blocked on this date
  const blocks = await RoomBlock.findAll({
    attributes: ['roomno'],
    where: {
      status: 'active',
      start_date: { [Sequelize.Op.lte]: date },
      [Sequelize.Op.or]: [
        { end_date: null },                              // permanent block
        { end_date: { [Sequelize.Op.gt]: date } }        // date-range block overlapping
      ]
    }
  });

  const blockedRoomNos = blocks.map((b) => b.roomno);
  const excludedRooms = [...new Set([...bookedRoomNos, ...blockedRoomNos])];

  // Step 3: Get rooms from roomdb excluding booked + blocked ones
  return RoomDb.findAll({
    where: {
      roomtype: room_type,
      roomno: {
        [Sequelize.Op.notIn]: excludedRooms.length > 0 ? excludedRooms : ['']
      },
      ...(gender && { gender })
    },
    order: [
      Sequelize.literal(
        `CAST(SUBSTRING(roomno, 1, LENGTH(roomno) - 1) AS UNSIGNED)`
      ),
      Sequelize.literal(`SUBSTRING(roomno, LENGTH(roomno))`)
    ]
  });
}

export const guestsByDateAndRoomtype = async (req, res) => {
  const { date, roomtype } = req.query;
  req.log.info('guests_by_date_and_roomtype_start', { date, roomtype });

  const guests = await RoomBooking.findAll({
    where: {
      roomtype,
      checkin: { [Sequelize.Op.lte]: date },
      checkout: { [Sequelize.Op.gt]: date },
      status: [
        ROOM_STATUS_PENDING_CHECKIN,
        ROOM_STATUS_CHECKEDIN,
        STATUS_PAYMENT_PENDING
      ]
    },
    include: [
      {
        model: CardDb,
        attributes: ['cardno', 'issuedto', 'mobno', 'gender', 'center']
      }
    ],
    order: [['roomno', 'ASC']]
  });

  req.log.info('guests_by_date_and_roomtype_success', { date, roomtype, count: guests.length });
  return res
    .status(200)
    .send({ message: 'Fetched guests for the day', data: guests });
};

export async function findAllRoomsUnfiltered(room_type, gender) {
  // Get rooms blocked for any date (permanent blocks only affect this unfiltered list)
  const blocks = await RoomBlock.findAll({
    attributes: ['roomno'],
    where: {
      status: 'active',
      end_date: null  // only permanently blocked rooms are excluded from unfiltered list
    }
  });
  const blockedRoomNos = blocks.map((b) => b.roomno);

  return RoomDb.findAll({
    where: {
      roomno: {
        [Sequelize.Op.notLike]: 'NA%',
        [Sequelize.Op.notLike]: 'WL%',
        [Sequelize.Op.notIn]: blockedRoomNos.length > 0 ? blockedRoomNos : ['']
      },
      roomtype: room_type,
      ...(gender && { gender })
    },
    order: [
      Sequelize.literal(
        `CAST(SUBSTRING(roomno, 1, LENGTH(roomno) - 1) AS UNSIGNED)`
      ),
      Sequelize.literal(`SUBSTRING(roomno, LENGTH(roomno))`)
    ]
  });
}

export const updateFlatBookingStatus = async (req, res) => {
  const { bookingid, status, description } = req.body;

  req.log.info('update_flat_booking_status_start', { bookingid, status });

  const booking = await FlatBooking.findOne({
    include: [
      {
        model: CardDb,
        attributes: ['issuedto', 'token']
      }
    ],
    where: { bookingid }
  });
  if (!booking) {
    req.log.warn('update_flat_booking_status_not_found', { bookingid });
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  const t = await database.transaction();
  req.transaction = t;

  const originalStatus = booking.status;
  let newStatus = originalStatus;

  if (!status || status === originalStatus) {
    req.log.warn('update_flat_booking_status_same_or_missing', { bookingid, status, originalStatus });
    throw new ApiError(400, 'Status is same as before or missing');
  }

  if (originalStatus === STATUS_ADMIN_CANCELLED) {
    req.log.warn('update_flat_booking_status_already_cancelled', { bookingid });
    throw new ApiError(400, ERR_BOOKING_ALREADY_CANCELLED);
  }

  switch (status) {
    case STATUS_PAYMENT_PENDING: {
      if (originalStatus !== STATUS_WAITING) {
        throw new ApiError(400, 'Pending can only be set from waiting status');
      }

      const cardno = booking.bookedBy || booking.cardno;
      const card = await validateCard(cardno);

      const rate = 700; // flat rate per night
      const baseAmount = rate * booking.nights;

      let discount = 0;
      let finalAmount = baseAmount;
      let txDescription = description || 'Payment pending for flat booking';
      let txStatus = STATUS_PAYMENT_PENDING;

      let updatedCredits = card.credits || {};
      const currentFlatCredits = parseInt(updatedCredits.room || 0);

      if (currentFlatCredits > 0) {
        discount = Math.min(currentFlatCredits, baseAmount);
        finalAmount = baseAmount - discount;
        txDescription += ` | Credits used: ₹${discount}`;
        updatedCredits.room = currentFlatCredits - discount;

        await CardDb.update(
          { credits: updatedCredits },
          { where: { cardno }, transaction: t }
        );
      }

      if (finalAmount === 0) {
        newStatus = ROOM_STATUS_PENDING_CHECKIN;
        txStatus = STATUS_PAYMENT_COMPLETED;
      } else {
        newStatus = STATUS_PAYMENT_PENDING;
        txStatus = STATUS_CASH_PENDING;
      }

      await booking.update(
        {
          amount: finalAmount,
          status: newStatus,
          updatedBy: req.user.username
        },
        { transaction: t }
      );

      await Transactions.create(
        {
          bookingid,
          cardno,
          category: TYPE_FLAT,
          amount: finalAmount,
          discount,
          razorpay_order_id: null,
          description: txDescription,
          status: txStatus,
          updatedBy: req.user.username
        },
        { transaction: t }
      );

      break;
    }

    case ROOM_STATUS_PENDING_CHECKIN: {
      if (originalStatus !== STATUS_PAYMENT_PENDING) {
        throw new ApiError(
          400,
          'Can only mark pending checkin from payment pending'
        );
      }

      const tx = await Transactions.findOne({
        where: { bookingid },
        order: [['createdAt', 'DESC']],
        transaction: t
      });

      if (!tx) {
        throw new ApiError(400, ERR_TRANSACTION_NOT_FOUND);
      }

      await tx.update(
        {
          status: STATUS_PAYMENT_COMPLETED,
          updatedBy: req.user.username,
          description: description || tx.description
        },
        { transaction: t }
      );

      newStatus = ROOM_STATUS_PENDING_CHECKIN;
      await booking.update(
        {
          status: newStatus,
          updatedBy: req.user.username
        },
        { transaction: t }
      );

      break;
    }

    case STATUS_ADMIN_CANCELLED: {
      if (![STATUS_WAITING, STATUS_PAYMENT_PENDING].includes(originalStatus)) {
        throw new ApiError(
          400,
          'Admin Cancelled allowed only from waiting or pending'
        );
      }

      const tx = await Transactions.findOne({
        where: { bookingid },
        order: [['createdAt', 'DESC']],
        transaction: t
      });

      if (
        tx &&
        ![
          STATUS_CREDITED,
          STATUS_CANCELLED,
          STATUS_ADMIN_CANCELLED,
          STATUS_PAYMENT_COMPLETED
        ].includes(tx.status)
      ) {
        await tx.update(
          {
            status: STATUS_ADMIN_CANCELLED,
            updatedBy: req.user.username,
            description: description || tx.description
          },
          { transaction: t }
        );
      }

      newStatus = STATUS_ADMIN_CANCELLED;

      await booking.update(
        {
          status: newStatus,
          updatedBy: req.user.username
        },
        { transaction: t }
      );

      break;
    }

    case STATUS_WAITING:
      throw new ApiError(400, 'Cannot revert back to waiting');

    default:
      throw new ApiError(400, 'Invalid status provided');
  }

  switch (newStatus) {
    case STATUS_ADMIN_CANCELLED: {
      sendDualUserNotifications({
        primary: {
          token: booking.CardDb.token,
          title: 'Flat Booking Cancelled',
          body: 'Your flat booking has been cancelled by admin.'
        },
        bookedBy: booking.bookedBy && {
          cardno: booking.bookedBy,
          title: 'Flat Booking Cancelled by Admin',
          body: `Flat booking for ${booking.CardDb.issuedto.split(' ')[0]
            } has been cancelled by admin.`
        },
        screen: '/bookings'
      });
      break;
    }
    case STATUS_PAYMENT_PENDING: {
      sendDualUserNotifications({
        primary: {
          token: booking.CardDb.token,
          title: 'Flat Booking status update',
          body: 'Flat booking status has been updated to payment pending. Please complete payment within 24 hours.'
        },
        bookedBy: booking.bookedBy && {
          cardno: booking.bookedBy,
          title: 'Flat Booking status update',
          body: `Payment is required for stay of ${booking.CardDb.issuedto.split(' ')[0]
            }. Please complete payment within 24 hours.`
        },
        screen: '/bookings'
      });
      break;
    }
    case ROOM_STATUS_PENDING_CHECKIN: {
      sendDualUserNotifications({
        primary: {
          token: booking.CardDb.token,
          title: 'Flat Booking confirmed',
          body: 'Your flat booking has been confirmed and is ready for check-in.'
        },
        bookedBy: booking.bookedBy && {
          cardno: booking.bookedBy,
          title: 'Flat Booking confirmed',
          body: `Flat booking for ${booking.CardDb.issuedto.split(' ')[0]
            } has been confirmed and is ready for check-in.`
        },
        screen: '/bookings'
      });
      break;
    }
    default:
      break;
  }

  await t.commit();
  req.log.info('update_flat_booking_status_transition', { bookingid, fromStatus: originalStatus, toStatus: newStatus });

  try {
    await sendFlatStatusChangeWhatsApp(booking, originalStatus, { updatedBy: req.user.username });
  } catch (waErr) {
    logger.error('Error sending flat booking update status WhatsApp:', waErr);
  }

  return res.status(200).send({ message: MSG_UPDATE_SUCCESSFUL });
};


export const fetchLateCheckoutFees = async (req, res) => {
  const { payment_type } = req.query;
  req.log.info('fetch_late_checkout_fees_start', { payment_type });

  const statusMap = {
    payment_pending: ['cash pending'],
    payment_done: ['completed'],
    fees_revoked: ['admin cancelled']
  };

  const statuses = statusMap[payment_type];

  if (!statuses) {
    req.log.warn('fetch_late_checkout_fees_invalid_payment_type', { payment_type });
    return res.status(400).json({
      success: false,
      message: `Invalid payment_type: ${payment_type}`
    });
  }

  try {
    const rows = await sequelize.query(
      `
      SELECT
        t.id,
        t.amount,

        /* which booking id we finally used */
        COALESCE(
          rb_from_desc.bookingid,
          rb_from_txn.bookingid
        ) AS bookingid,

        COALESCE(
          rb_from_desc.roomno,
          rb_from_txn.roomno
        ) AS roomno,

        COALESCE(
          rb_from_desc.roomtype,
          rb_from_txn.roomtype
        ) AS roomtype,

        COALESCE(
          rb_from_desc.checkin,
          rb_from_txn.checkin
        ) AS checkin,

        COALESCE(
          rb_from_desc.checkout,
          rb_from_txn.checkout
        ) AS checkout,

        c.issuedto AS guest_name,
        c.mobno    AS mobile

      FROM transactions t

      /* 🔹 Join using bookingid FROM DESCRIPTION (newer data) */
      LEFT JOIN room_booking rb_from_desc
  ON rb_from_desc.bookingid =
     CASE
       WHEN t.description LIKE 'Late checkout fee for booking %'
       THEN SUBSTRING_INDEX(
              SUBSTRING_INDEX(t.description, 'booking ', -1),
              ' ',
              1
            )
       ELSE NULL
     END

      /* 🔹 Join using transaction.bookingid (legacy data) */
      LEFT JOIN room_booking rb_from_txn
        ON rb_from_txn.bookingid = t.bookingid

      /* card from whichever booking we got */
      LEFT JOIN card_db c
        ON c.cardno = COALESCE(
          rb_from_desc.cardno,
          rb_from_txn.cardno
        )

      WHERE t.amt_type = 'late_checkout_room'
        AND t.status IN (:statuses)

      ORDER BY t.createdAt DESC
      `,
      {
        replacements: { statuses },
        type: QueryTypes.SELECT
      }
    );

    const data = rows.map(row => {
      let nights = null;
      if (row.checkin && row.checkout) {
        nights =
          (new Date(row.checkout) - new Date(row.checkin)) /
          (1000 * 60 * 60 * 24);
      }

      return {
        id: row.id,
        amount: row.amount,
        bookingid: row.bookingid || '—',

        guest_name: row.guest_name || '—',
        mobile: row.mobile || '—',

        roomno: row.roomno || '—',
        roomtype: row.roomtype || '—',
        nights,
        checkin: row.checkin,
        checkout: row.checkout
      };
    });

    req.log.info('fetch_late_checkout_fees_success', { payment_type, count: data.length });
    res.json({
      success: true,
      data,
      meta: {
        count: data.length,
        payment_type
      }
    });
  } catch (error) {
    req.log.error('fetch_late_checkout_fees_error', { payment_type, error: error.message });
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};


export const revokeLateCheckoutFee = async (req, res) => {
  const { transactionId, status } = req.body;
  req.log.info('revoke_late_checkout_fee_start', { transactionId, status });

  try {
    const result = await Transactions.update(
      { status },
      { where: { id: transactionId } }
    );

    if (result[0] === 0) {
      req.log.warn('revoke_late_checkout_fee_not_found', { transactionId });
      return res.status(404).json({
        success: false,
        message: 'Transaction not found or already updated'
      });
    }

    if (status === 'admin cancelled') {
      try {
        const txn = await Transactions.findByPk(transactionId);
        if (txn) {
          await sendLateCheckoutFeeWaivedWhatsApp(txn);
        }
      } catch (waErr) {
        req.log.error('Error sending late checkout fee waived WhatsApp:', waErr);
      }
    }

    req.log.info('revoke_late_checkout_fee_success', { transactionId, status });
    res.json({ success: true, message: 'Transaction updated successfully' });
  } catch (error) {
    req.log.error('revoke_late_checkout_fee_error', { transactionId, error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
};

export const bulkRoomBooking = async (req, res) => {
  const { checkin_date, checkout_date, floor_pref, bookings } = req.body;
  req.log.info('bulk_room_booking_start', { checkin_date, checkout_date, floor_pref, count: bookings ? bookings.length : 0 });

  if (!checkin_date || !checkout_date) {
    throw new ApiError(400, 'Check-in and Check-out dates are required');
  }
  if (checkin_date > checkout_date) {
    throw new ApiError(400, ERR_INVALID_DATE);
  }
  if (!bookings || !Array.isArray(bookings) || bookings.length === 0) {
    throw new ApiError(400, 'Bookings array is required and cannot be empty');
  }

  const nights = await calculateNights(checkin_date, checkout_date);
  const t = await database.transaction();
  req.transaction = t;

  try {
    const excludeRooms = [];
    const results = [];

    for (const b of bookings) {
      const { cardno, room_type } = b;
      if (!cardno) {
        throw new ApiError(400, 'Card number is required for each booking row');
      }

      const card = await CardDb.findOne({ where: { cardno } });
      if (!card) {
        throw new ApiError(400, `Card not found for card number: ${cardno}`);
      }

      if (await checkRoomAlreadyBooked(checkin_date, checkout_date, card.cardno)) {
        throw new ApiError(400, `Guest ${card.issuedto} (${card.cardno}) already has an active booking for these dates.`);
      }

      let bookingResult;
      if (nights === 0 && room_type === 'NA') {
        bookingResult = await bookDayVisit(
          card.cardno,
          checkin_date,
          checkout_date,
          null,
          card.cardno,
          t
        );
      } else {
        bookingResult = await createRoomBooking(
          card.cardno,
          checkin_date,
          checkout_date,
          nights,
          room_type || 'nac',
          card.gender,
          floor_pref || null,
          card,
          t,
          false,
          excludeRooms
        );
      }

      results.push({
        cardno: card.cardno,
        name: card.issuedto,
        roomno: bookingResult.roomno || 'NA'
      });
    }

    await t.commit();
    req.log.info('bulk_room_booking_success', { count: results.length });
    return res.status(201).send({
      message: `Successfully booked rooms for ${results.length} guests`,
      data: results
    });

  } catch (err) {
    await t.rollback();
    req.log.error('bulk_room_booking_failed', err);
    throw err;
  }
};

