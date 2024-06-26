import {
  CardDb,
  RoomDb,
  RoomBooking,
  RoomBookingTransaction,
  FlatBooking
} from '../../models/associations.js';
import BlockDates from '../../models/block_dates.model.js';
import {
  STATUS_MUMUKSHU,
  ROOM_STATUS_PENDING_CHECKIN,
  ROOM_STATUS_CHECKEDIN,
  ROOM_STATUS_CHECKEDOUT,
  TYPE_EXPENSE,
  ROOM_PRICE,
  STATUS_PAYMENT_PENDING,
  ROOM_BLOCKED,
  ROOM_STATUS_AVAILABLE,
  STATUS_INACTIVE,
  STATUS_WAITING,
  STATUS_CANCELLED
} from '../../config/constants.js';
import {
  checkRoomAlreadyBooked,
  checkFlatAlreadyBooked,
  calculateNights,
  validateDate
} from '../helper.js';
import getDates from '../../utils/getDates.js';
import Sequelize from 'sequelize';
import moment from 'moment';
import { v4 as uuidv4 } from 'uuid';
import SendMail from '../../utils/sendMail.js';
import database from '../../config/database.js';
import ApiError from '../../utils/ApiError.js';

export const manualCheckin = async (req, res) => {
  const today = moment().format('YYYY-MM-DD');

  const booking = await RoomBooking.findOne({
    where: {
      cardno: req.params.cardno,
      status: ROOM_STATUS_PENDING_CHECKIN,
      checkin: { [Sequelize.Op.lte]: today },
      checkout: { [Sequelize.Op.gte]: today }
    }
  });

  if (!booking) {
    throw new ApiError(404, 'Booking not found');
  }

  booking.status = ROOM_STATUS_CHECKEDIN;
  booking.updatedBy = req.user.username;
  await booking.save();

  return res.status(200).send({ message: 'User Checked in', data: booking });
};

export const manualCheckout = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const booking = await RoomBooking.findOne({
    where: {
      cardno: req.params.cardno,
      status: ROOM_STATUS_CHECKEDIN
    },
    order: [['checkin', 'ASC']]
  });

  const today = moment().format('YYYY-MM-DD');

  if (today != booking.dataValues.checkout) {
    const nights = await calculateNights(booking.dataValues.checkin, today);

    booking.checkout = today;
    booking.nights = nights;
    booking.status = ROOM_STATUS_CHECKEDOUT;
    booking.updatedBy = req.user.username;
    await booking.save({ transaction: t });

    const [transactionItemsUpdated] = await RoomBookingTransaction.update(
      {
        amount: ROOM_PRICE * nights,
        updatedBy: req.user.username
      },
      {
        where: {
          bookingid: booking.dataValues.bookingid
        },
        transaction: t
      }
    );

    if (transactionItemsUpdated != 1) {
      throw new ApiError(500, 'Unexpected error occured in checkout');
    }
  } else {
    booking.status = ROOM_STATUS_CHECKEDOUT;
    booking.updatedBy = req.user.username;
    await booking.save({ transaction: t });
  }

  await t.commit();
  return res.status(200).send({ message: 'Successfully checkedout' });
};

export const roomBooking = async (req, res) => {
  validateDate(req.body.checkin_date, req.body.checkout_date);

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

  const gender = req.user.gender;
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
          [Sequelize.Op.notIn]: Sequelize.literal(`(
                    SELECT roomno 
                    FROM room_booking 
                    WHERE NOT (checkout <= ${req.body.checkin_date} OR checkin >= ${req.body.checkout_date})
                )`)
        },
        roomstatus: 'available',
        roomtype: req.body.room_type,
        gender: req.body.floor_pref + gender
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
        status: ROOM_STATUS_CHECKEDIN,
        gender: gender,
        updatedBy: req.user.username
      },
      { transaction: t }
    );

    if (booking == undefined) {
      throw new ApiError(400, 'Failed to book a bed');
    }

    const transaction = await RoomBookingTransaction.create(
      {
        cardno: req.user.cardno,
        bookingid: booking.dataValues.bookingid,
        type: TYPE_EXPENSE,
        amount: ROOM_PRICE * nights,
        description: `Room Booked for ${nights} nights`,
        status: STATUS_PAYMENT_PENDING,
        updatedBy: req.user.username
      },
      { transaction: t }
    );

    if (transaction == undefined) {
      throw new ApiError(400, 'Failed to book a bed');
    }
  } else {
    roomno = await RoomDb.findOne({
      where: {
        roomno: { [Sequelize.Op.like]: 'NA%' },
        roomtype: req.body.room_type,
        gender: req.body.floor_pref + gender,
        roomstatus: ROOM_STATUS_AVAILABLE
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
        roomtype: req.body.room_type,
        status: ROOM_STATUS_PENDING_CHECKIN,
        gender: gender,
        updatedBy: req.user.username
      },
      { transaction: t }
    );

    if (booking == undefined) {
      throw new ApiError(400, 'Failed to book a bed');
    }
  }

  await t.commit();

  const message = `
      Dear ${req.user.issuedto},<br><br>

    	We are pleased to confirm your booking for ${booking.dataValues.roomtype} room as per following details:<br><br>

    	<b>Booking id:</b> ${booking.dataValues.bookingid}<br>
    	<b>Check-in Date:</b> ${booking.dataValues.checkin}<br>
    	<b>Check-out Date:</b> ${booking.dataValues.checkout}<br><br>

    	Your Room Number will be provided from office upon checkin.<br><br>

    	<a href='http://datachef.in/sratrc/rajsharan/guidelines/rc_guidelines.pdf' target='_blank'>Please Click Here to Read</a> the guidelines for your stay at Research Centre
    	We hope you have a spiritually blissful stay. <br><br>

    	Research Centre Admin office, <br>
    	7875432613 / 9004273512`;

  SendMail({
    email: req.user.email,
    subject: `Your Booking Confirmation for Stay at SRATRC`,
    message
  });

  return res.status(201).send({ message: 'booked successfully' });
};

export const flatBooking = async (req, res) => {
  validateDate(req.body.checkin_date, req.body.checkout_date);

  const user_data = await CardDb.findOne({
    attributes: ['cardno', 'issuedto', 'gender', 'mobno', 'email'],
    where: {
      mobno: req.params.mobno
    }
  });

  if (!user_data) {
    throw new ApiError(404, 'User not found');
  }

  if (
    await checkFlatAlreadyBooked(
      req.body.checkin_date,
      req.body.checkout_date,
      user_data.dataValues.cardno
    )
  ) {
    throw new ApiError(400, 'Already Booked');
  }

  const nights = await calculateNights(
    req.body.checkin_date,
    req.body.checkout_date
  );

  const booking = await FlatBooking.create({
    bookingid: uuidv4(),
    cardno: user_data.dataValues.cardno,
    flatno: req.body.flat_no,
    checkin: req.body.checkin_date,
    checkout: req.body.checkout_date,
    nights: nights,
    status: ROOM_STATUS_PENDING_CHECKIN
  });

  if (booking == undefined) {
    throw new ApiError(400, 'Failed to book your flat');
  }

  const message = `
      Dear ${user_data.dataValues.issuedto},<br><br>

			We are pleased to confirm your Flat booking as per following details:<br><br>
			
			<b>Booking id:</b> ${booking.dataValues.id}<br>
			<b>Check-in Date:</b> ${booking.dataValues.checkin}<br>
			<b>Check-out Date:</b> ${booking.dataValues.checkout}<br><br>
			
			Your Room Number will be provided from office upon checkin.<br><br>

			<a href='http://datachef.in/sratrc/rajsharan/guidelines/rc_guidelines.pdf' target='_blank'>Please Click Here to Read</a> the guidelines for your stay at Research Centre
			We hope you have a spiritually blissful stay. <br><br>
			
			Research Centre Admin office, <br>
			7875432613 / 9004273512`;

  SendMail({
    email: user_data.dataValues.email,
    subject: `Your Booking Confirmation for Stay at SRATRC`,
    message
  });

  return res.status(201).send({ message: 'booked successfully' });
};

export const fetchAllRoomBookings = async (req, res) => {
  const page = req.body.page || 1;
  const pageSize = req.body.page_size || 10;
  const offset = (page - 1) * pageSize;

  const bookings = await RoomBooking.findAll({
    offset,
    limit: pageSize,
    order: [['checkin', 'ASC']]
  });

  return res.status(200).send({ message: 'Fetched bookings', data: bookings });
};

export const fetchAllFlatBookings = async (req, res) => {
  const page = req.body.page || 1;
  const pageSize = req.body.page_size || 10;
  const offset = (page - 1) * pageSize;

  const bookings = await FlatBooking.findAll({
    offset,
    limit: pageSize,
    order: [['checkin', 'ASC']]
  });

  return res.status(200).send({ message: 'Fetched bookings', data: bookings });
};

export const fetchRoomBookingsByCard = async (req, res) => {
  const page = req.body.page || 1;
  const pageSize = req.body.page_size || 10;
  const offset = (page - 1) * pageSize;

  const bookings = await RoomBooking.findAll({
    where: {
      cardno: req.params.cardno
    },
    offset,
    limit: pageSize,
    order: [['checkin', 'ASC']]
  });

  return res.status(200).send({ message: 'Fetched bookings', data: bookings });
};

export const fetchFlatBookingsByCard = async (req, res) => {
  const page = req.body.page || 1;
  const pageSize = req.body.page_size || 10;
  const offset = (page - 1) * pageSize;

  const bookings = await FlatBooking.findAll({
    where: {
      cardno: req.params.cardno
    },
    offset,
    limit: pageSize,
    order: [['checkin', 'ASC']]
  });

  return res.status(200).send({ message: 'Fetched bookings', data: bookings });
};

// TODO: update room should be able to change dates too
export const updateRoomBooking = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const {
    bookingid,
    cardno,
    roomno,
    checkout_date,
    room_type,
    gender,
    status
  } = req.body;

  const old_booking = await RoomBooking.findOne({
    where: { bookingid: bookingid }
  });

  // TODO: check if roomno is not taken
  var room_no;
  if (roomno) {
    room_no = await RoomDb.findOne({
      where: {
        roomno: roomno,
        gender: gender,
        roomtype: room_type
      }
    });
    if (!room_no)
      throw new ApiError(404, 'unable to find room with that number');
    if (room_no == ROOM_BLOCKED)
      throw new ApiError(403, 'selected room is blocked');
  }

  const updatedBooking = await RoomBooking.update(
    {
      roomno: roomno,
      checkout_date: checkout_date,
      roomtype: room_type,
      status: status,
      updatedBy: req.user.username
    },
    { where: { bookingid: bookingid, cardno: cardno }, transaction: t }
  );

  if (updatedBooking != 1) {
    throw new ApiError(500, 'Failed to update booking');
  }

  await t.commit();

  return res.status(200).send({ message: 'updated booking successfully' });
};

export const updateFlatBooking = async (req, res) => {
  const { bookingid, cardno, flatno, checkin_date, checkout_date, status } =
    req.body;

  if (await checkFlatAlreadyBooked(req, cardno)) {
    throw new ApiError(400, 'Already Booked');
  }

  const today = moment().format('YYYY-MM-DD');
  const checkinDate = new Date(req.body.checkin_date);
  const checkoutDate = new Date(req.body.checkout_date);
  if (
    today > req.body.checkin_date ||
    today > req.body.checkout_date ||
    checkinDate > checkoutDate
  ) {
    throw new ApiError(400, 'Invalid Date');
  }

  const nights = await calculateNights(
    req.body.checkin_date,
    req.body.checkout_date
  );

  const booking = await FlatBooking.findByPk(bookingid);

  if (!booking) {
    throw new ApiError(404, 'booking not found');
  }

  booking.flatno = flatno;
  booking.checkin = checkin_date;
  booking.checkout = checkout_date;
  booking.nights = nights;
  booking.status = status;
  booking.updatedBy = req.user.username;
  await booking.save();

  return res.status(201).send({ message: 'booking updated successfully' });
};

export const checkinReport = async (req, res) => {
  const page = req.body.page || 1;
  const pageSize = req.body.page_size || 10;
  const offset = (page - 1) * pageSize;

  const today = moment().format('YYYY-MM-DD');

  const checkedin = await RoomBooking.findAll({
    include: [CardDb],
    where: {
      checkin: today,
      status: ROOM_STATUS_CHECKEDIN
    },
    offset,
    limit: pageSize
  });

  return res
    .status(200)
    .send({ message: 'fetched checkin report', data: checkedin });
};

export const checkoutReport = async (req, res) => {
  const page = req.body.page || 1;
  const pageSize = req.body.page_size || 10;
  const offset = (page - 1) * pageSize;

  const today = moment().format('YYYY-MM-DD');

  const checkedout = await RoomBooking.findAll({
    include: [CardDb],
    where: {
      checkout: today,
      status: ROOM_STATUS_CHECKEDOUT
    },
    offset,
    limit: pageSize
  });

  return res
    .status(200)
    .send({ message: 'fetched checkout report', data: checkedout });
};

export const blockRoom = async (req, res) => {
  const isBlocked = await RoomDb.findOne({
    where: {
      roomno: req.params.roomno
    }
  });
  if (isBlocked.dataValues.roomstatus == ROOM_BLOCKED) {
    return res.status(200).send({ message: 'blocked room successfully' });
  } else {
    isBlocked.roomstatus = ROOM_BLOCKED;
    isBlocked.updatedBy = req.user.username;
    await isBlocked.save();
  }

  return res.status(200).send({ message: 'blocked room successfully' });
};

export const unblockRoom = async (req, res) => {
  const isunBlocked = await RoomDb.findOne({
    where: {
      roomno: req.params.roomno
    }
  });
  if (isunBlocked.dataValues.roomstatus == ROOM_STATUS_AVAILABLE) {
    return res.status(200).send({ message: 'unblocking room successfully' });
  } else {
    isunBlocked.roomstatus = ROOM_STATUS_AVAILABLE;
    isunBlocked.updatedBy = req.user.username;
    await isunBlocked.save();
  }

  return res.status(200).send({ message: 'unblocking room successfully' });
};

export const blockRC = async (req, res) => {
  const alreadyBlocked = await BlockDates.findOne({
    where: {
      checkin: req.body.checkin_date,
      checkout: req.body.checkout_date
    }
  });

  if (alreadyBlocked)
    throw new ApiError(500, 'Already blocked on mentioned dates');

  const block = await BlockDates.create({
    checkin: req.body.checkin_date,
    checkout: req.body.checkout_date,
    comments: req.body.comments,
    updatedBy: req.user.username
  });

  if (!block) {
    throw new ApiError(500, 'Error occured while blocking RC');
  }

  return res.status(200).send({ message: 'Blocked RC Successfully' });
};

export const unblockRC = async (req, res) => {
  const blocked = await BlockDates.findByPk(req.params.id);
  blocked.updatedBy = req.user.username;
  blocked.status = STATUS_INACTIVE;
  await blocked.save();
  return res.status(200).send({ message: 'Unblocked RC' });
};

export const occupancyReport = async (req, res) => {
  const page = req.body.page || 1;
  const pageSize = req.body.page_size || 10;
  const offset = (page - 1) * pageSize;

  const result = await RoomBooking.findAll({
    attributes: ['bookingid', 'roomno', 'checkin', 'checkout', 'nights'],
    include: [
      {
        model: CardDb,
        attributes: ['cardno', 'issuedto', 'mobno', 'centre'],
        where: {
          res_status: STATUS_MUMUKSHU
        }
      }
    ],
    where: {
      status: ROOM_STATUS_CHECKEDIN
    },
    offset,
    limit: pageSize
  });

  return res.status(200).send({ message: 'Success', data: result });
};

export const ReservationReport = async (req, res) => {
  const { start_date, end_date } = req.query;

  const reservations = await RoomBooking.findAll({
    attributes: [
      'bookingid',
      'roomtype',
      'roomno',
      'checkin',
      'checkout',
      'status',
      'nights'
    ],
    where: {
      checkin: { [Sequelize.Op.between]: [start_date, end_date] },
      status: { [Sequelize.Op.not]: STATUS_WAITING }
    },
    order: [
      ['checkin', 'ASC'],
      ['roomno', 'ASC']
    ],
    include: [
      {
        model: CardDb,
        attributes: ['issuedto', 'mobno', 'centre'],
        required: true
      }
    ]
  });

  return res
    .status(200)
    .send({ message: 'fetched room reservation report', data: reservations });
};

export const CancellationReport = async (req, res) => {
  const { start_date, end_date } = req.query;

  const cancellations = await RoomBooking.findAll({
    attributes: [
      'bookingid',
      'roomtype',
      'checkin',
      'checkout',
      'status',
      'nights',
      'updatedAt'
    ],
    where: {
      checkin: { [Sequelize.Op.between]: [start_date, end_date] },
      status: { [Sequelize.Op.eq]: STATUS_CANCELLED }
    },
    order: [['checkin', 'ASC']],
    include: [
      {
        model: CardDb,
        attributes: ['issuedto', 'mobno', 'centre'],
        required: true
      }
    ]
  });

  return res
    .status(200)
    .send({ message: 'fetched room cancellation report', data: cancellations });
};

export const WaitlistReport = async (req, res) => {
  const { start_date, end_date } = req.query;

  const waiting = await RoomBooking.findAll({
    attributes: [
      'bookingid',
      'roomtype',
      'checkin',
      'checkout',
      'status',
      'nights'
    ],
    where: {
      checkin: { [Sequelize.Op.between]: [start_date, end_date] },
      status: { [Sequelize.Op.eq]: STATUS_WAITING }
    },
    order: [['checkin', 'ASC']],
    include: [
      {
        model: CardDb,
        attributes: ['issuedto', 'mobno', 'centre'],
        required: true
      }
    ]
  });

  return res
    .status(200)
    .send({ message: 'fetched room waiting report', data: waiting });
};

export const dayWiseGuestCountReport = async (req, res) => {
  const { start_date, end_date } = req.query;
  const allDates = getDates(start_date, end_date);

  var data = [];

  for (let i of allDates) {
    const daywise_report = await RoomBooking.findAll({
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
        }
      },
      group: 'checkin'
    });
    if (daywise_report[0]) {
      data.push({
        date: i,
        nac: daywise_report[0].dataValues.nac,
        ac: daywise_report[0].dataValues.ac
      });
    }
  }
  return res
    .status(200)
    .send({ message: 'fetched daywise report', data: data });
};
