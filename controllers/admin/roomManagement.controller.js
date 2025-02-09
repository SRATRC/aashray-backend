import {
  CardDb,
  RoomDb,
  RoomBooking,
  FlatBooking,
  Transactions
} from '../../models/associations.js';
import BlockDates from '../../models/block_dates.model.js';
import {
  STATUS_MUMUKSHU,
  ROOM_STATUS_PENDING_CHECKIN,
  ROOM_STATUS_CHECKEDIN,
  ROOM_STATUS_CHECKEDOUT,
  ROOM_BLOCKED,
  ROOM_STATUS_AVAILABLE,
  STATUS_INACTIVE,
  STATUS_WAITING,
  STATUS_CANCELLED,
  ERR_BOOKING_NOT_FOUND,
  ERR_ROOM_ALREADY_BOOKED,
  ERR_CARD_NOT_FOUND,
  MSG_BOOKING_SUCCESSFUL,
  MSG_UPDATE_SUCCESSFUL,
  ERR_TRANSACTION_NOT_FOUND,
  ERR_ROOM_NOT_FOUND,
  STATUS_ADMIN_CANCELLED
} from '../../config/constants.js';
import {
  checkFlatAlreadyBooked,
  calculateNights,
  validateDate,
  getBlockedDates
} from '../helper.js';
import {
  bookDayVisit,
  checkRoomAlreadyBooked,
  createRoomBooking,
  roomCharge
} from '../../helpers/roomBooking.helper.js';
import getDates from '../../utils/getDates.js';
import Sequelize, { where } from 'sequelize';
import moment from 'moment';
import { v4 as uuidv4 } from 'uuid';
import SendMail from '../../utils/sendMail.js';
import database from '../../config/database.js';
import ApiError from '../../utils/ApiError.js';
import sendMail from '../../utils/sendMail.js';

// TODO: early checkin??
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

  // TODO: should the transaction be marked as payment complete here?
  if (!booking) {
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  booking.status = ROOM_STATUS_CHECKEDIN;
  booking.updatedBy = req.user.username;
  await booking.save();

  return res.status(200).send({ message: 'Successfully checked in', data: booking });
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

  if (!booking) {
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  const today = moment().format('YYYY-MM-DD');

  if (today != booking.checkout) {
    // TODO: Throw error if checkout after booking's original checkout date
    const nights = await calculateNights(booking.checkin, today);

    booking.checkout = today;
    booking.nights = nights;

    // TODO: Do we need to add credits here or take balance payment here?
    const [transactionItemsUpdated] = await Transactions.update(
      {
        amount: roomCharge(booking.roomtype) * nights,
        updatedBy: req.user.username
      },
      {
        where: {
          bookingid: booking.bookingid
        },
        transaction: t
      }
    );

    if (transactionItemsUpdated != 1) {
      throw new ApiError(404, ERR_TRANSACTION_NOT_FOUND);
    }
  }

  booking.status = ROOM_STATUS_CHECKEDOUT;
  booking.updatedBy = req.user.username;
  await booking.save({ transaction: t });

  await t.commit();
  return res.status(200).send({ message: 'Successfully checked out' });
};

export const roomBooking = async (req, res) => {
  const { mobno, cardno, checkin_date, checkout_date, room_type, floor_pref } =
    req.body;
  validateDate(checkin_date, checkout_date);

  const card = mobno ? 
    await CardDb.findOne({ where: { mobno } }) :
    await CardDb.findOne({ where: { cardno } });

  if (!card) {
    throw new ApiError(400, ERR_CARD_NOT_FOUND);
  }

  if (
    await checkRoomAlreadyBooked(
      checkin_date,
      checkout_date,
      card.cardno
    )
  ) {
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
      req.user.username,
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
      req.user.username,
      t
    );
  }

  sendMail({
    email: card.email,
    subject: `Your Booking Confirmation for Stay at SRATRC`,
    template: 'rajSharan',
    context: {
      name: card.issuedto,
      bookingid: booking.bookingid,
      checkin: booking.checkin,
      checkout: booking.checkout
    }
  });

  await t.commit();
  return res.status(201).send({ message: MSG_BOOKING_SUCCESSFUL });
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

			<a href='http://datachef.in/sratrc/rajsharan/guidelines/rc_guidelines.pdf' target='_blank'>Please Click Here to Read</a> the guidelines for your stay at Research Center
			We hope you have a spiritually blissful stay. <br><br>
			
			Research Center Admin office, <br>
			7875432613 / 9004273512`;

  SendMail({
    email: user_data.dataValues.email,
    subject: `Your Booking Confirmation for Stay at SRATRC`,
    message
  });

  return res.status(201).send({ message: MSG_BOOKING_SUCCESSFUL });
};

export const fetchAllRoomBookings = async (req, res) => {
  const page = parseInt(req.query.page) || req.body.page || 1;
  const pageSize = parseInt(req.query.page_size) || req.body.page_size || 10;
  const offset = (page - 1) * pageSize;

  const bookings = await RoomBooking.findAll({
    offset,
    limit: pageSize,
    order: [['checkin', 'ASC']]
  });

  return res.status(200).send({ message: 'Fetched bookings', data: bookings });
};

export const fetchAllFlatBookings = async (req, res) => {
  const page = parseInt(req.query.page) || req.body.page || 1;
  const pageSize = parseInt(req.query.page_size) || req.body.page_size || 10;
  const offset = (page - 1) * pageSize;

  const bookings = await FlatBooking.findAll({
    offset,
    limit: pageSize,
    order: [['checkin', 'ASC']]
  });

  return res.status(200).send({ message: 'Fetched bookings', data: bookings });
};

export const fetchRoomBookingsByCard = async (req, res) => {
  const page = parseInt(req.query.page) || req.body.page || 1;
  const pageSize = parseInt(req.query.page_size) || req.body.page_size || 10;
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
  const page = parseInt(req.query.page) || req.body.page || 1;
  const pageSize = parseInt(req.query.page_size) || req.body.page_size || 10;
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
  const {
    bookingid,
    cardno,
    roomno,
    checkout_date,
    room_type,
    gender,
    status
  } = req.body;

  const booking = await RoomBooking.findOne({
    where: { 
      cardno: cardno,
      bookingid: bookingid 
    }
  });

  if (!booking) {
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  const t = await database.transaction();
  req.transaction = t;

  // TODO: check if roomno is not taken
  if (roomno) {
    const room = await RoomDb.findOne({
      where: {
        roomno: roomno,
        gender: gender,
        roomtype: room_type
      }
    });

    if (!room) {
      throw new ApiError(404, 'Unable to find room with that room number, gender and type.');
    }
    
    if (room.roomstatus == ROOM_BLOCKED)
      throw new ApiError(403, 'Selected room is blocked.');
  }

  await booking.update(
    {
      roomno,
      // TODO: do we need to update the transaction
      // to give refunds or take more payment
      checkout: checkout_date,
      roomtype: room_type,
      // Same - if the booking gets cancelled, do we need to handle that
      status,
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

  await booking.update(
    {
      flatno,
      checkin: checkin_date,
      checkout: checkout_date,
      nights,
      status,
      updatedBy: req.user.username
    }
  );

  return res.status(200).send({ message: MSG_UPDATE_SUCCESSFUL });
};

export const checkinReport = async (req, res) => {
  const page = parseInt(req.query.page) || req.body.page || 1;
  const pageSize = parseInt(req.query.page_size) || req.body.page_size || 10;
  const offset = (page - 1) * pageSize;

  const today = moment().format('YYYY-MM-DD');

  // TODO: include Guest information
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
    .send({ message: 'Fetched check in report', data: checkedin });
};

export const checkoutReport = async (req, res) => {
  const page = parseInt(req.query.page) || req.body.page || 1;
  const pageSize = parseInt(req.query.page_size) || req.body.page_size || 10;
  const offset = (page - 1) * pageSize;

  const today = moment().format('YYYY-MM-DD');

  // TODO: include Guest information
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

export const roomList = async (req, res) => {
  const page = parseInt(req.query.page) || req.body.page || 1;
  const pageSize = parseInt(req.query.page_size) || req.body.page_size || 10;
  const offset = (page - 1) * pageSize;

  const result = await RoomDb.findAll({
    attributes: ['roomno', 'roomtype', 'gender', 'roomstatus'],
    where: {
      roomno: {
        [Sequelize.Op.notLike]: 'NA%',
        [Sequelize.Op.notLike]: 'WL%'
      }
    },
    offset,
    limit: pageSize
  });

  return res.status(200).send({ message: 'Success', data: result });
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

export const rcBlockList = async (req, res) => {
  const today = moment().format('YYYY-MM-DD');
  const blocked = await BlockDates.findAll({
    attributes: ['id', 'checkin', 'checkout', 'comments', 'status'],
    where: {
      checkin: { [Sequelize.Op.gte]: today }
    }
  });

  return res
    .status(200)
    .send({ message: 'Fetched RC block list', data: blocked });
};

export const blockRC = async (req, res) => {
  const { checkin_date, checkout_date, comments } = req.body;

  const blockedDates = await getBlockedDates(checkin_date, checkout_date);

  if (blockedDates.length > 0) {
    throw new ApiError(400, 
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

  await blocked.update(
    {
      status: STATUS_INACTIVE,
      updatedBy: req.user.username
    },
  );

  return res.status(200).send({ message: 'Unblocked RC successfully' });
};

export const occupancyReport = async (req, res) => {
  const page = parseInt(req.query.page) || req.body.page || 1;
  const pageSize = parseInt(req.query.page_size) || req.body.page_size || 10;
  const offset = (page - 1) * pageSize;

  // TODO: include guest information
  const result = await RoomBooking.findAll({
    attributes: ['bookingid', 'roomno', 'checkin', 'checkout', 'nights'],
    include: [
      {
        model: CardDb,
        attributes: ['cardno', 'issuedto', 'mobno', 'center'],
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
  const page = parseInt(req.query.page) || req.body.page || 1;
  const pageSize = parseInt(req.query.page_size) || req.body.page_size || 10;

  const reservations = await roomBookingReport(
    start_date,
    end_date,
    page,
    pageSize,
    // STATUS_WAITING,
    ROOM_STATUS_PENDING_CHECKIN,
    ROOM_STATUS_CHECKEDIN,
    // TODO: should we include this?
    ROOM_STATUS_CHECKEDOUT 
    // STATUS_CANCELLED,
    // STATUS_ADMIN_CANCELLED
  )

  return res
    .status(200)
    .send({ message: 'Fetched room reservation report', data: reservations });
};

export const CancellationReport = async (req, res) => {
  const { start_date, end_date } = req.query;
  const page = parseInt(req.query.page) || req.body.page || 1;
  const pageSize = parseInt(req.query.page_size) || req.body.page_size || 10;
  
  const cancellations = await roomBookingReport(
    start_date,
    end_date,
    page,
    pageSize,
    STATUS_CANCELLED, 
    STATUS_ADMIN_CANCELLED
  )

  return res
    .status(200)
    .send({ message: 'Fetched room cancellation report', data: cancellations });
};

export const WaitlistReport = async (req, res) => {
  const { start_date, end_date } = req.query;
  const page = parseInt(req.query.page) || req.body.page || 1;
  const pageSize = parseInt(req.query.page_size) || req.body.page_size || 10;

  const waiting = await roomBookingReport(
    start_date,
    end_date,
    page,
    pageSize,
    STATUS_WAITING
  )

  return res
    .status(200)
    .send({ message: 'Fetched room waiting report', data: waiting });
};

export const dayWiseGuestCountReport = async (req, res) => {
  const { start_date, end_date } = req.query;
  const allDates = getDates(start_date, end_date);
  const page = parseInt(req.query.page) || req.body.page || 1;
  const pageSize = parseInt(req.query.page_size) || req.body.page_size || 10;
  const offset = (page - 1) * pageSize;

  var data = [];

  for (let date of allDates) {
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
        checkin: { [Sequelize.Op.lte]: date },
        checkout: { [Sequelize.Op.gt]: date },
        status: [
          ROOM_STATUS_PENDING_CHECKIN,
          ROOM_STATUS_CHECKEDIN,
          ROOM_STATUS_CHECKEDOUT
        ]
      },
      group: 'checkin',
      offset,
      limit: pageSize
    });

    if (daywise_report[0]) {
      data.push({
        date: date,
        nac: daywise_report[0].dataValues.nac,
        ac: daywise_report[0].dataValues.ac
      });
    }
  }

  return res
    .status(200)
    .send({ message: 'Fetched daywise report', data: data });
};

async function roomBookingReport(
  startDate, 
  endDate,
  page, 
  pageSize,
  ...statuses
) {
  const offset = (page - 1) * pageSize;
  
  const data = await RoomBooking.findAll({
    include: [
      {
        // TODO: include guest information
        model: CardDb,
        attributes: ['cardno', 'issuedto', 'mobno', 'center'],
        required: true
      }
    ],
    attributes: [
      'bookingid',
      'roomtype',
      'checkin',
      'checkout',
      'status',
      'nights'
    ],
    where: {
      checkin: { [Sequelize.Op.between]: [startDate, endDate] },
      status: statuses
    },
    order: [['checkin', 'ASC']],
    offset,
    limit: pageSize
  });

  return data;
}