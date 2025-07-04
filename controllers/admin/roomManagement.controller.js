import {
  CardDb,
  RoomDb,
  RoomBooking,
  FlatBooking,
  Transactions,
  FlatDb
} from '../../models/associations.js';
import BlockDates from '../../models/block_dates.model.js';
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
  STATUS_PAYMENT_COMPLETED
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
  findAllRooms,
  roomCharge
} from '../../helpers/roomBooking.helper.js';
import { adminCancelTransaction, createPendingTransaction } from '../../helpers/transactions.helper.js';
import { validateCard } from '../../helpers/card.helper.js';
import getDates from '../../utils/getDates.js';
import Sequelize from 'sequelize';
import moment from 'moment';
import database from '../../config/database.js';
import ApiError from '../../utils/ApiError.js';
import { v4 as uuidv4 } from 'uuid';

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
  if (checkoutTime <= CHECKOUT_DEADLINE) {
    await booking.update(
      { status: ROOM_STATUS_CHECKEDOUT, updatedBy: user.username },
      { transaction: dbTransaction }
    );
    return;
  }

  // Late checkout ⇒ add fee (half-day if before 3 PM, full-day otherwise).
  const isHalfDay = checkoutTime <= LATE_CHECKOUT_HALF;
  await Transactions.create(
    {
      cardno: booking.cardno,
      bookingid: booking.bookingid,
      category: TYPE_ROOM,
      amount: calcLateCheckoutFee(
        booking.roomtype || booking.roomType,
        isHalfDay
      ),
      status: STATUS_CASH_PENDING,
      description: 'Late checkout fee',
      updatedBy: user.username
    },
    { transaction: dbTransaction }
  );

  await booking.update(
    { status: ROOM_STATUS_CHECKEDOUT, updatedBy: user.username },
    { transaction: dbTransaction }
  );
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

  await adminCancelTransaction(
    user, 
    card,
    transaction,
    t
  );

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
      status: ROOM_STATUS_CHECKEDOUT,
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
};

export const manualCheckin = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const today = moment().format('YYYY-MM-DD');

  const booking = await RoomBooking.findOne({
    where: {
      bookingid: req.params.bookingid,
      status: ROOM_STATUS_PENDING_CHECKIN
    }
  });

  if (!booking) {
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  if (booking.checkin > today) {
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
    throw new ApiError(400, 'Cannot check-in until payment is completed.');
  }

  await booking.update(
    {
      status: ROOM_STATUS_CHECKEDIN,
      updatedBy: req.user.username
    },
    { transaction: t }
  );

  await t.commit();
  return res
    .status(200)
    .send({ message: 'Successfully checked in', data: booking });
};

export const manualCheckout = async (req, res) => {
  const dbTransaction = await database.transaction();
  req.transaction = dbTransaction;

  const booking = await RoomBooking.findOne({
    where: {
      bookingid: req.params.bookingid,
      status: ROOM_STATUS_CHECKEDIN
    }
  });

  if (!booking) {
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  const transaction = await Transactions.findOne({
    where: { bookingid: booking.bookingid }
  });

  const today = moment().format('YYYY-MM-DD');
  const checkoutTime = moment().format('HH:mm:ss');

  if (today === booking.checkout) {
    await handleSameDayCheckout({
      booking,
      checkoutTime,
      dbTransaction,
      user: req.user
    });
  } else if (today > booking.checkout) {
    await handleOverstayCheckout({
      booking,
      today,
      dbTransaction,
      user: req.user
    });
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
  return res.status(200).send({ message: 'Successfully checked out' });
};

export const cancelFlatBooking = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const booking = await FlatBooking.findOne({
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
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  await booking.update(
    {
      status: STATUS_ADMIN_CANCELLED,
      updatedBy: req.user.username
    },
    { transaction: t }
  );

  await t.commit();
  return res
    .status(200)
    .send({ message: MSG_CANCEL_SUCCESSFUL, data: booking });
};

export const flatCheckin = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const today = moment().format('YYYY-MM-DD');

  const booking = await FlatBooking.findOne({
    where: {
      bookingid: req.params.bookingid,
      status: ROOM_STATUS_PENDING_CHECKIN
    }
  });

  if (!booking) {
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  if (booking.checkin > today) {
    throw new ApiError(404, `Cannot check-in until ${booking.checkin}.`);
  }

  await booking.update(
    {
      status: ROOM_STATUS_CHECKEDIN,
      updatedBy: req.user.username
    },
    { transaction: t }
  );

  await t.commit();
  return res
    .status(200)
    .send({ message: 'Successfully checked in', data: booking });
};

export const flatCheckout = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const booking = await FlatBooking.findOne({
    where: {
      bookingid: req.params.bookingid,
      status: ROOM_STATUS_CHECKEDIN
    }
  });

  if (!booking) {
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  const today = moment().format('YYYY-MM-DD');

  if (today > booking.checkout) {
    throw new ApiError(
      404,
      `Original check-out date was ${booking.checkout}. Please create ` +
        `a new booking for the guest for the remaining days and collect the difference.`
    );
  }

  const nights = await calculateNights(booking.checkin, today);

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
  return res.status(200).send({ message: 'Successfully checked out' });
};

export const roomBooking = async (req, res) => {
  const { mobno, cardno, checkin_date, checkout_date, room_type, floor_pref } =
    req.body;
  validateDate(checkin_date, checkout_date);

  const card = mobno
    ? await CardDb.findOne({ where: { mobno } })
    : await CardDb.findOne({ where: { cardno } });

  if (!card) {
    throw new ApiError(400, ERR_CARD_NOT_FOUND);
  }

  if (await checkRoomAlreadyBooked(checkin_date, checkout_date, card.cardno)) {
    throw new ApiError(400, ERR_ROOM_ALREADY_BOOKED);
  }

  const t = await database.transaction();
  req.transaction = t;

  const nights = await calculateNights(checkin_date, checkout_date);

  var booking = undefined;
  if (nights == 0) {
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
  if (booking.bookingId != null) {
    let bookingIds = {};
    bookingIds[TYPE_ROOM] = [booking.bookingId];
    sendUnifiedEmail(card.cardno, bookingIds, card);
  }
  return res.status(201).send({ message: MSG_BOOKING_SUCCESSFUL });
};

export const flatBooking = async (req, res) => {
  validateDate(req.body.checkin_date, req.body.checkout_date);

  const card = await CardDb.findOne({
    attributes: ['id', 'cardno', 'issuedto', 'gender', 'mobno', 'email', 'credits'],
    where: {
      mobno: req.params.mobno
    }
  });

  if (!card) {
    throw new ApiError(404, ERR_CARD_NOT_FOUND);
  }

  if (
    await checkFlatAlreadyBooked(
      req.body.checkin_date,
      req.body.checkout_date,
      card.cardno
    )
  ) {
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
    t,
    true
  );

  await t.commit();
  if (booking.bookingId != null) {
    let bookingIds = {};
    bookingIds[TYPE_FLAT] = [booking.bookingId];
    sendUnifiedEmail(card.cardno, bookingIds, card);
  }

  return res.status(201).send({ message: MSG_BOOKING_SUCCESSFUL });
};

export const fetchAllRoomBookings = async (req, res) => {
  const bookings = await RoomBooking.findAll({
    order: [['checkin', 'ASC']]
  });

  return res.status(200).send({ message: 'Fetched bookings', data: bookings });
};

export const fetchAllFlatBookings = async (req, res) => {
  const bookings = await FlatBooking.findAll({
    order: [['checkin', 'ASC']]
  });

  return res.status(200).send({ message: 'Fetched bookings', data: bookings });
};

export const fetchRoomBookingsByCard = async (req, res) => {
  const bookings = await RoomBooking.findAll({
    where: {
      cardno: req.params.cardno
    },
    order: [['checkin', 'ASC']]
  });

  return res.status(200).send({ message: 'Fetched bookings', data: bookings });
};

export const fetchFlatBookingsByCard = async (req, res) => {
  const bookings = await FlatBooking.findAll({
    where: {
      cardno: req.params.cardno
    },
    order: [['checkin', 'ASC']]
  });

  return res.status(200).send({ message: 'Fetched bookings', data: bookings });
};

export const updateRoomBooking = async (req, res) => {
  const { bookingid, roomno } = req.body;

  const booking = await RoomBooking.findOne({
    where: { bookingid }
  });

  if (!booking) {
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

  await t.commit();
  return res.status(200).send({ message: MSG_UPDATE_SUCCESSFUL });
};

export const updateFlatBooking = async (req, res) => {
  const { bookingid, cardno, flatno, checkin_date, checkout_date, status } =
    req.body;

  validateDate(checkin_date, checkout_date);

  const nights = await calculateNights(checkin_date, checkout_date);
  const booking = await FlatBooking.findByPk(bookingid);
  if (!booking) {
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  await booking.update({
    flatno,
    checkin: checkin_date,
    checkout: checkout_date,
    nights,
    status,
    updatedBy: req.user.username
  });

  return res.status(200).send({ message: MSG_UPDATE_SUCCESSFUL });
};

export const roomList = async (req, res) => {
  const result = await RoomDb.findAll({
    attributes: ['roomno', 'roomtype', 'gender', 'roomstatus'],
    where: {
      roomno: {
        [Sequelize.Op.notIn]: ['NA', 'WL']
      }
    }
  });

  return res.status(200).send({ message: 'Success', data: result });
};

export const flatList = async (req, res) => {
  const flats = await FlatDb.findAll({
    attributes: [[Sequelize.fn('DISTINCT', Sequelize.col('flatno')), 'flatno']]
  });
  return res.status(200).send({ message: 'Success', data: flats });
};

export const availableRooms = async (req, res) => {
  const bookingid = req.params.bookingid;

  const booking = await RoomBooking.findOne({
    where: { bookingid }
  });

  if (!booking) {
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  const today = moment().format('YYYY-MM-DD');

  const rooms = await findAllRooms(
    today,
    booking.checkout,
    booking.roomtype,
    booking.gender
  );

  return res
    .status(200)
    .send({ message: 'Fetched available rooms', data: rooms });
};

export const availableRoomsForDay = async (req, res) => {
  const { date, roomtype } = req.query;

  const rooms = await findAllRooms(date, date, roomtype);

  return res
    .status(200)
    .send({ message: 'Fetched available rooms', data: rooms });
};

export const blockRoom = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const rooms = await RoomDb.findAll({
    where: {
      roomno: {
        [Sequelize.Op.like]: `${req.params.roomno}%`
      },
      roomstatus: { [Sequelize.Op.not]: ROOM_BLOCKED }
    }
  });

  if (rooms.length == 0) {
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
  return res.status(200).send({ message: MSG_UPDATE_SUCCESSFUL });
};

export const unblockRoom = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const rooms = await RoomDb.findAll({
    where: {
      roomno: {
        [Sequelize.Op.like]: `${req.params.roomno}%`
      },
      roomstatus: ROOM_BLOCKED
    }
  });

  if (rooms.length == 0) {
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
  return res.status(200).send({ message: MSG_UPDATE_SUCCESSFUL });
};

export const updateRoom = async (req, res) => {
  const { roomtype, gender } = req.body;
  const roomno = req.params.roomno;

  const t = await database.transaction();
  req.transaction = t;

  const room = await RoomDb.findOne({
    where: { roomno }
  });

  if (!room) {
    throw new ApiError(400, ERR_ROOM_NOT_FOUND);
  }

  await room.update(
    {
      roomtype,
      gender,
      updatedBy: req.user.username
    },
    { transaction: t }
  );

  await t.commit();
  return res.status(200).send({ message: MSG_UPDATE_SUCCESSFUL });
};

export const rcBlockList = async (req, res) => {
  const today = moment().format('YYYY-MM-DD');
  const blocked = await BlockDates.findAll({
    attributes: ['id', 'checkin', 'checkout', 'comments', 'status'],
    where: {
      checkout: { [Sequelize.Op.gte]: today }
    },
    order: [['checkin', 'ASC']]
  });

  return res
    .status(200)
    .send({ message: 'Fetched RC block list', data: blocked });
};

export const blockRC = async (req, res) => {
  const { checkin_date, checkout_date, comments } = req.body;

  const blockedDates = await getBlockedDates(checkin_date, checkout_date);

  if (blockedDates.length > 0) {
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

  return res.status(200).send({ message: 'Blocked RC successfully' });
};

export const unblockRC = async (req, res) => {
  const blocked = await BlockDates.findByPk(req.params.id);

  await blocked.update({
    status: STATUS_INACTIVE,
    updatedBy: req.user.username
  });

  return res.status(200).send({ message: 'Unblocked RC successfully' });
};

import { Op } from 'sequelize';
// import moment from 'moment';

export const occupancyReport = async (req, res) => {
  const today = moment().startOf('day').toDate(); // today's 00:00
  const tomorrow = moment().add(1, 'day').startOf('day').toDate(); // tomorrow 00:00

  const result = await RoomBooking.findAll({
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
      status: ROOM_STATUS_CHECKEDIN,
      checkin: { [Op.lte]: today },
      checkout: { [Op.gt]: today }
    }
  });

  return res.status(200).send({ message: 'Success', data: result });
};

export const ReservationReport = async (req, res) => {
  const { start_date, end_date, statuses } = req.query;

  const page = parseInt(req.query.page) || req.body.page || 1;
  const pageSize = parseInt(req.query.page_size) || req.body.page_size || 1000;

  const reservations = await roomBookingReport(
    start_date,
    end_date,
    page,
    pageSize,
    statuses
  );

  return res
    .status(200)
    .send({ message: 'Fetched room reservation report', data: reservations });
};

export const flatReservationReport = async (req, res) => {
  const { start_date, end_date } = req.query;

  const bookings = await FlatBooking.findAll({
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
    where: {
      [Sequelize.Op.or]: [
        { checkin: { [Sequelize.Op.between]: [start_date, end_date] } },
        { checkout: { [Sequelize.Op.between]: [start_date, end_date] } }
      ]
    },
    order: [['checkin', 'ASC']]
  });

  return res
    .status(200)
    .send({ message: 'Fetched flat reservation report', data: bookings });
};

export const dayWiseGuestCountReport = async (req, res) => {
  const { start_date, end_date } = req.query;
  const allDates = getDates(start_date, end_date);

  const allRooms = await database.query(
    `SELECT
      SUM(CASE WHEN roomtype = 'nac' THEN 1 ELSE 0 END) as nac,
      SUM(CASE WHEN roomtype = 'ac' THEN 1 ELSE 0 END) as ac
    FROM
      roomdb
    WHERE roomstatus <> 'blocked'
      AND roomtype <> 'NA'
    `,
    {
      type: Sequelize.QueryTypes.SELECT
    }
  );

  var data = [];
  for (let date of allDates) {
    const report = (
      await RoomBooking.findAll({
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
            ROOM_STATUS_CHECKEDOUT
          ]
        },
        group: 'checkin'
      })
    )[0];

    if (report) {
      data.push({
        date: date,
        ac: report.dataValues.ac,
        nac: report.dataValues.nac,
        ac_available: allRooms[0].ac - report.dataValues.ac,
        nac_available: allRooms[0].nac - report.dataValues.nac
      });
    }
  }

  return res
    .status(200)
    .send({ message: 'Fetched daywise report', data: data });
};

async function roomBookingReport(startDate, endDate, page, pageSize, statuses) {
  const data = await RoomBooking.findAll({
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
  });

  return data;
}

export const updateBookingStatus = async (req, res) => {
  const { bookingid, status, description } = req.body;

  const booking = await RoomBooking.findOne({ where: { bookingid } });
  if (!booking) throw new ApiError(404, ERR_BOOKING_NOT_FOUND);

  const t = await database.transaction();
  req.transaction = t;

  const originalStatus = booking.status;
  let newStatus = originalStatus;

  if (!status || status === originalStatus) {
    throw new ApiError(400, 'Status is same as before or missing');
  }

  if (originalStatus === STATUS_ADMIN_CANCELLED) {
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

      await Transactions.create({
        bookingid,
        cardno,
        category: TYPE_ROOM,
        amount: finalAmount,
        discount,
        razorpay_order_id: null,
        description: txDescription,
        status: txStatus,
        updatedBy: req.user.username
      }, { transaction: t });

      break;
    }

    case ROOM_STATUS_PENDING_CHECKIN: {
      if (originalStatus !== STATUS_PAYMENT_PENDING) {
        throw new ApiError(400, 'Can only mark pending checkin from payment pending');
      }

      const tx = await Transactions.findOne({
        where: { bookingid },
        order: [['createdAt', 'DESC']],
        transaction: t
      });

      if (!tx) {
        throw new ApiError(400, ERR_TRANSACTION_NOT_FOUND);
      }

      await tx.update({
  status: STATUS_PAYMENT_COMPLETED,
  updatedBy: req.user.username,
  description: description || tx.description
}, { transaction: t });

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
        throw new ApiError(400, 'Admin Cancelled allowed only from waiting or pending');
      }

      const tx = await Transactions.findOne({
        where: { bookingid },
        order: [['createdAt', 'DESC']],
        transaction: t
      });

      if (tx && ![STATUS_CREDITED, STATUS_CANCELLED, STATUS_ADMIN_CANCELLED, STATUS_PAYMENT_COMPLETED].includes(tx.status)) {
      await tx.update({
  status: STATUS_ADMIN_CANCELLED,
  updatedBy: req.user.username,
  description: description || tx.description
}, { transaction: t });
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

  await t.commit();
  return res.status(200).send({ message: MSG_UPDATE_SUCCESSFUL });
};
