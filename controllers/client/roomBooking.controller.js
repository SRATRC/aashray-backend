import {
  RoomDb,
  RoomBooking,
  RoomBookingTransaction,
  FlatDb,
  FlatBooking,
  CardDb,
  GuestRoomBooking
} from '../../models/associations.js';
import {
  ROOM_STATUS_AVAILABLE,
  STATUS_WAITING,
  STATUS_CANCELLED,
  ROOM_WL,
  ROOM_STATUS_PENDING_CHECKIN,
  STATUS_PAYMENT_PENDING,
  TYPE_EXPENSE,
  STATUS_PAYMENT_COMPLETED,
  STATUS_AVAILABLE,
  NAC_ROOM_PRICE,
  AC_ROOM_PRICE,
  TYPE_ROOM,
  STATUS_CASH_COMPLETED,
  STATUS_CASH_PENDING,
  TYPE_GUEST_ROOM,
  STATUS_CREDITED
} from '../../config/constants.js';
import database from '../../config/database.js';
import Sequelize from 'sequelize';
import { v4 as uuidv4 } from 'uuid';
import {
  checkFlatAlreadyBooked,
  calculateNights,
  validateDate
} from '../helper.js';
import {
  checkRoomAlreadyBooked
} from '../../helpers/roomBooking.helper.js';
import ApiError from '../../utils/ApiError.js';
import sendMail from '../../utils/sendMail.js';
import getDates from '../../utils/getDates.js';
import Transactions from '../../models/transactions.model.js';

// TODO: DEPRECATE THIS ENDPOINT
export const AvailabilityCalender = async (req, res) => {
  const startDate = new Date(req.body.checkin_date);
  const endDate = new Date(req.body.checkout_date);
  if (startDate != endDate) endDate.setDate(endDate.getDate() - 1);

  validateDate(req.body.checkin_date, req.body.checkout_date);

  const allDates = getDates(startDate, endDate);

  const gender = req.body.gender || req.user.gender;
  const total_beds = await RoomDb.count({
    where: {
      roomtype: req.body.room_type,
      gender: req.body.floor_pref + gender,
      roomstatus: ROOM_STATUS_AVAILABLE
    }
  });

  var beds_occupied = [];
  for (const i of allDates) {
    const res = await RoomBooking.findAll({
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
        checkin: { [Sequelize.Op.lte]: i },
        checkout: { [Sequelize.Op.gt]: i },
        status: {
          [Sequelize.Op.in]: ['pending checkin', 'checkedin', 'checkedout']
        },
        gender: gender
      },
      group: 'checkin'
    });
    beds_occupied.push({
      dtbooked: i,
      count: res[0]
    });
  }
  return res.status(200).send({
    message: 'fetched availiblity calender',
    data: { total_beds: total_beds, beds_occupied: beds_occupied }
  });
};

// TODO: DEPRECATE THIS ENDPOINT
export const BookingForMumukshu = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  if (
    await checkRoomAlreadyBooked(
      req.body.checkin_date,
      req.body.checkout_date,
      req.user.cardno
    )
  ) {
    throw new ApiError(400, 'Already Booked');
  }

  validateDate(req.body.checkin_date, req.body.checkout_date);

  const gender = req.body.floor_pref
    ? req.body.floor_pref + req.user.gender
    : req.user.gender;
  const nights = await calculateNights(
    req.body.checkin_date,
    req.body.checkout_date
  );
  var roomno = undefined;
  var booking = undefined;

  if (nights > 0) {
    roomno = await RoomDb.findOne({
      attributes: ['roomno'],
      where: {
        roomno: {
          [Sequelize.Op.notLike]: 'NA%',
          [Sequelize.Op.notLike]: 'WL%',
          [Sequelize.Op.notIn]: Sequelize.literal(`(
                    SELECT roomno 
                    FROM room_booking 
                    WHERE NOT (checkout <= ${req.body.checkin_date} OR checkin >= ${req.body.checkout_date})
                )`)
        },
        roomstatus: STATUS_AVAILABLE,
        roomtype: req.body.room_type,
        gender: gender
      },
      order: [
        Sequelize.literal(
          `CAST(SUBSTRING(roomno, 1, LENGTH(roomno) - 1) AS UNSIGNED)`
        ),
        Sequelize.literal(`SUBSTRING(roomno, LENGTH(roomno))`)
      ],
      limit: 1
    });
    if (roomno == undefined) {
      throw new ApiError(400, 'No Beds Available');
    }

    booking = await RoomBooking.create(
      {
        bookingid: uuidv4(),
        cardno: req.user.cardno,
        roomno: roomno.dataValues.roomno,
        checkin: req.body.checkin_date,
        checkout: req.body.checkout_date,
        nights: nights,
        roomtype: req.body.room_type,
        status: ROOM_STATUS_PENDING_CHECKIN,
        gender: gender
      },
      { transaction: t }
    );

    if (!booking) {
      throw new ApiError(400, 'Failed to book a bed');
    }

    const transaction = await RoomBookingTransaction.create(
      {
        cardno: req.user.cardno,
        bookingid: booking.dataValues.bookingid,
        type: TYPE_EXPENSE,
        amount:
          req.body.room_type == 'nac'
            ? NAC_ROOM_PRICE * nights
            : AC_ROOM_PRICE * nights,
        description: `Room Booked for ${nights} nights`,
        status: STATUS_PAYMENT_PENDING
      },
      { transaction: t }
    );

    if (!transaction) {
      throw new ApiError(400, 'Failed to book a bed');
    }
  } else {
    roomno = await RoomDb.findOne({
      where: {
        roomno: { [Sequelize.Op.eq]: 'NA' }
      },
      attributes: ['roomno']
    });

    booking = await RoomBooking.create(
      {
        bookingid: uuidv4(),
        cardno: req.user.cardno,
        roomno: roomno.dataValues.roomno,
        checkin: req.body.checkin_date,
        checkout: req.body.checkout_date,
        nights: nights,
        roomtype: 'NA',
        status: ROOM_STATUS_PENDING_CHECKIN,
        gender: gender
      },
      { transaction: t }
    );

    if (!booking) {
      throw new ApiError(400, 'Failed to book a bed');
    }
  }

  await t.commit();

  sendMail({
    email: req.user.email,
    subject: `Your Booking Confirmation for Stay at SRATRC`,
    template: 'rajSharan',
    context: {
      name: req.user.issuedto,
      bookingid: booking.dataValues.bookingid,
      checkin: booking.dataValues.checkin,
      checkout: booking.dataValues.checkout
    }
  });

  return res.status(201).send({ message: 'booked successfully' });
};

// TODO: DEPRECATE THIS ENDPOINT
export const BookingForGuest = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;
};

export const FlatBookingForMumukshu = async (req, res) => {
  const { flat_no, mobno, checkin_date, checkout_date } = req.body;
  const ownFlat = await FlatDb.findOne({
    where: {
      flatno: flat_no,
      owner: req.user.cardno
    }
  });
  if (!ownFlat) throw new ApiError(404, 'Flat not owned by you');

  const user_data = await CardDb.findOne({
    where: {
      mobno: mobno
    }
  });
  if (!user_data) throw new ApiError(404, 'user not found');

  if (
    await checkFlatAlreadyBooked(checkin_date, checkout_date, req.user.cardno)
  ) {
    throw new ApiError(400, 'Already Booked');
  }

  validateDate(checkin_date, checkout_date);

  const nights = await calculateNights(checkin_date, checkout_date);

  const booking = await FlatBooking.create({
    bookingid: uuidv4(),
    cardno: user_data.dataValues.cardno,
    flatno: flat_no,
    checkin: checkin_date,
    checkout: checkout_date,
    nights: nights
  });

  if (!booking) {
    throw new ApiError(500, 'Failed to book your flat');
  }

  sendMail({
    email: req.user.email,
    subject: `Your Booking Confirmation for Stay at SRATRC`,
    template: 'rajSharan',
    context: {
      name: req.user.issuedto,
      bookingid: booking.dataValues.id,
      checkin: booking.dataValues.checkin,
      checkout: booking.dataValues.checkout
    }
  });

  return res.status(201).send({ message: 'booked successfully' });
};

export const ViewAllBookings = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;
  const offset = (page - 1) * pageSize;

  const user_bookings = await database.query(
    `SELECT 
    t1.bookingid, 
    NULL AS bookedFor,
    NULL AS name,
    t1.roomno, 
    t1.checkin, 
    t1.checkout, 
    t1.nights, 
    t1.roomtype, 
    t1.status, 
    t1.gender, 
    COALESCE(t2.amount, 0) AS amount, 
    t2.status AS transaction_status
FROM room_booking t1
LEFT JOIN transactions t2 
    ON t1.bookingid = t2.bookingid AND t2.category = :category
WHERE t1.cardno = :cardno

UNION ALL

SELECT 
    t1.bookingid, 
    COALESCE(t1.guest, 'NA') AS bookedFor,
    t3.name AS name,
    t1.roomno, 
    t1.checkin, 
    t1.checkout, 
    t1.nights, 
    t1.roomtype, 
    t1.status, 
    t1.gender, 
    COALESCE(t2.amount, 0) AS amount, 
    t2.status AS transaction_status
FROM guest_room_booking t1
LEFT JOIN transactions t2 
    ON t1.bookingid = t2.bookingid AND t2.category = :guest_category
LEFT JOIN guest_db t3 
    ON t3.id = t1.guest
WHERE t1.cardno = :cardno

ORDER BY checkin DESC
LIMIT :limit OFFSET :offset;
`,
    {
      replacements: {
        cardno: req.user.cardno,
        category: TYPE_ROOM,
        guest_category: TYPE_GUEST_ROOM,
        limit: pageSize,
        offset: offset
      },
      type: Sequelize.QueryTypes.SELECT
    }
  );
  return res.status(200).send(user_bookings);
};

export const CancelBooking = async (req, res) => {
  const { bookingid, bookedFor } = req.body;

  const t = await database.transaction();
  req.transaction = t;

  var booking = undefined;

  if (bookedFor !== null) {
    booking = await GuestRoomBooking.findOne({
      where: {
        bookingid: bookingid,
        cardno: req.user.cardno,
        guest: bookedFor
      }
    });
    if (booking == undefined) {
      throw new ApiError(404, 'unable to find selected booking');
    }

    booking.status = STATUS_CANCELLED;
    await booking.save({ transaction: t });

    const guestRoomBookingTransaction = await Transactions.findOne({
      where: {
        cardno: req.user.cardno,
        bookingid: bookingid,
        category: TYPE_GUEST_ROOM,
        status: {
          [Sequelize.Op.in]: [
            STATUS_PAYMENT_PENDING,
            STATUS_PAYMENT_COMPLETED,
            STATUS_CASH_PENDING,
            STATUS_CASH_COMPLETED
          ]
        }
      }
    });

    if (guestRoomBookingTransaction == undefined) {
      throw new ApiError(404, 'unable to find selected booking transaction');
    }

    if (
      guestRoomBookingTransaction.status == STATUS_PAYMENT_PENDING ||
      guestRoomBookingTransaction.status == STATUS_CASH_PENDING
    ) {
      guestRoomBookingTransaction.status = STATUS_CANCELLED;
      await guestRoomBookingTransaction.save({ transaction: t });
    } else if (
      guestRoomBookingTransaction.status == STATUS_PAYMENT_COMPLETED ||
      guestRoomBookingTransaction.status == STATUS_CASH_COMPLETED
    ) {
      guestRoomBookingTransaction.status = STATUS_CREDITED;
      // TODO: add credited transaction to its table
      await guestRoomBookingTransaction.save({ transaction: t });
    }
  } else {
    booking = await RoomBooking.findOne({
      where: { bookingid: bookingid, cardno: req.user.cardno }
    });

    if (booking == undefined) {
      throw new ApiError(404, 'unable to find selected booking');
    }

    booking.status = STATUS_CANCELLED;
    await booking.save({ transaction: t });

    const roomBookingTransaction = await Transactions.findOne({
      where: {
        cardno: req.user.cardno,
        bookingid: bookingid,
        category: TYPE_ROOM,
        status: {
          [Sequelize.Op.in]: [
            STATUS_PAYMENT_PENDING,
            STATUS_PAYMENT_COMPLETED,
            STATUS_CASH_PENDING,
            STATUS_CASH_COMPLETED
          ]
        }
      }
    });

    if (roomBookingTransaction == undefined) {
      throw new ApiError(404, 'unable to find selected booking');
    }

    if (
      roomBookingTransaction.status == STATUS_PAYMENT_PENDING ||
      roomBookingTransaction.status == STATUS_CASH_PENDING
    ) {
      roomBookingTransaction.status = STATUS_CANCELLED;
      await roomBookingTransaction.save({ transaction: t });
    } else if (
      roomBookingTransaction.status == STATUS_PAYMENT_COMPLETED ||
      roomBookingTransaction.status == STATUS_CASH_COMPLETED
    ) {
      roomBookingTransaction.status = STATUS_CREDITED;
      // TODO: add credited transaction to its table
      await roomBookingTransaction.save({ transaction: t });
    }
  }

  await t.commit();

  sendMail({
    email: req.user.email,
    subject: `Your Booking for Stay at SRATRC has been Canceled`,
    template: 'rajSharanCancellation',
    context: {
      name: req.user.issuedto,
      bookingid: booking.dataValues.bookingid,
      checkin: booking.dataValues.checkin,
      checkout: booking.dataValues.checkout
    }
  });

  res.status(200).send({ message: 'booking canceled' });
};

// TODO: DEPRECATE THIS ENDPOINT
export const AddWaitlist = async (req, res) => {
  if (
    await checkRoomAlreadyBooked(
      req.body.checkin_date,
      req.body.checkout_date,
      req.user.cardno
    )
  ) {
    return res.status(200).send({ message: 'Already Booked' });
  }

  validateDate(req.body.checkin_date, req.body.checkout_date);

  const nights = await calculateNights(
    req.body.checkin_date,
    req.body.checkout_date
  );

  const roomno = await RoomDb.findOne({
    attributes: ['roomno'],
    where: {
      roomtype: req.body.room_type,
      gender: req.user.gender,
      roomno: { [Sequelize.Op.like]: ROOM_WL + '%' }
    }
  });

  const booking = await RoomBooking.create({
    cardno: req.user.cardno,
    guest_name: req.user.issuedto,
    roomno: roomno.dataValues.roomno,
    checkin: req.body.checkin_date,
    checkout: req.body.checkout_date,
    nights: nights,
    roomtype: req.body.room_type,
    status: STATUS_WAITING,
    gender: req.user.gender,
    bookingid: uuidv4()
  });

  sendMail({
    email: req.user.email,
    subject: `You have been added to Waitlist for Stay at SRATRC`,
    template: 'rajSharanWaitlist',
    context: {
      name: req.user.issuedto,
      bookingid: booking.dataValues.bookingid,
      checkin: booking.dataValues.checkin,
      checkout: booking.dataValues.checkout
    }
  });

  return res.status(200).send({ message: 'waitlist added' });
};
