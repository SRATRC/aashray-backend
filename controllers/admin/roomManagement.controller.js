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
  ROOM_STATUS_AVAILABLE
} from '../../config/constants.js';
import {
  checkRoomAlreadyBooked,
  checkFlatAlreadyBooked,
  calculateNights
} from '../helper.js';
import Sequelize from 'sequelize';
import moment from 'moment';
import { v4 as uuidv4 } from 'uuid';
import SendMail from '../../utils/sendMail.js';
import database from '../../config/database.js';
import ApiError from '../../utils/ApiError.js';

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
    await booking.save({ transaction: t });

    const [transactionItemsUpdated] = await RoomBookingTransaction.update(
      {
        amount: ROOM_PRICE * nights
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
    await booking.save({ transaction: t });
  }

  await t.commit();
  return res.status(200).send({ message: 'Successfully checkedout' });
};

export const roomBooking = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

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
    await checkRoomAlreadyBooked(
      req.body.checkin_date,
      req.body.checkout_date,
      user_data.dataValues.cardno
    )
  ) {
    throw new ApiError(200, 'Already Booked');
  }

  const today = moment().format('YYYY-MM-DD');
  const checkinDate = new Date(req.body.checkin_date);
  const checkoutDate = new Date(req.body.checkout_date);
  if (
    today > req.body.checkin_date ||
    today > req.body.checkout_date ||
    checkinDate > checkoutDate
  ) {
    throw new ApiError(200, 'Invalid Date');
  }

  const gender = user_data.dataValues.gender;
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
      throw new ApiError(200, 'No Beds Available');
    }

    booking = await RoomBooking.create(
      {
        bookingid: uuidv4(),
        cardno: user_data.dataValues.cardno,
        roomno: roomno.dataValues.roomno,
        checkin: req.body.checkin_date,
        checkout: req.body.checkout_date,
        nights: nights,
        roomtype: req.body.room_type,
        status: ROOM_STATUS_CHECKEDIN,
        gender: gender
      },
      { transaction: t }
    );

    if (booking == undefined) {
      throw new ApiError(200, 'Failed to book a bed');
    }

    const transaction = await RoomBookingTransaction.create(
      {
        cardno: user_data.dataValues.cardno,
        bookingid: booking.dataValues.bookingid,
        type: TYPE_EXPENSE,
        amount: ROOM_PRICE * nights,
        status: STATUS_PAYMENT_PENDING
      },
      { transaction: t }
    );

    if (transaction == undefined) {
      throw new ApiError(200, 'Failed to book a bed');
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
        cardno: user_data.dataValues.cardno,
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

    if (booking == undefined) {
      throw new ApiError(200, 'Failed to book a bed');
    }
  }

  await t.commit();

  const message = `
      Dear ${user_data.dataValues.issuedto},<br><br>

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
    email: user_data.dataValues.email,
    subject: `Your Booking Confirmation for Stay at SRATRC`,
    message
  });

  return res.status(201).send({ message: 'booked successfully' });
};

export const flatBooking = async (req, res) => {
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
    throw new ApiError(200, 'Already Booked');
  }

  const today = moment().format('YYYY-MM-DD');
  const checkinDate = new Date(req.body.checkin_date);
  const checkoutDate = new Date(req.body.checkout_date);
  if (
    today > req.body.checkin_date ||
    today > req.body.checkout_date ||
    checkinDate > checkoutDate
  ) {
    throw new ApiError(200, 'Invalid Date');
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
    throw new ApiError(200, 'Failed to book your flat');
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

// TODO: Deprecate this as update booking exists
export const manualRoomAllocation = async (req, res) => {
  const booking = await RoomBooking.findOne({
    where: {
      cardno: req.params.cardno,
      status: ROOM_STATUS_CHECKEDIN
    }
  });

  if (!booking) {
    throw new ApiError(404, 'booking not found');
  }

  booking.roomno = req.body.roomno;
  await booking.save();

  return res.status(200).send({ message: 'Updated roomno' });
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

  const { bookingid, cardno, roomno, gender, status } = req.body;

  // const result = await RoomBookingTransaction.findOne({
  //   attributes: [
  //     [
  //       Sequelize.fn(
  //         'SUM',
  //         Sequelize.literal(
  //           "CASE WHEN status = 'payment completed' AND type = 'expense' THEN amount ELSE 0 END"
  //         )
  //       ),
  //       'totalPaidExpense'
  //     ],
  //     [
  //       Sequelize.fn(
  //         'SUM',
  //         Sequelize.literal(
  //           "CASE WHEN status = 'payment completed' AND type = 'refund' THEN amount ELSE 0 END"
  //         )
  //       ),
  //       'totalPaidRefund'
  //     ],
  //     [
  //       Sequelize.fn(
  //         'SUM',
  //         Sequelize.literal(
  //           "CASE WHEN status IN ('payment pending', 'awaiting_refund') AND type = 'expense' THEN amount ELSE 0 END"
  //         )
  //       ),
  //       'totalUnPaidExpense'
  //     ],
  //     [
  //       Sequelize.fn(
  //         'SUM',
  //         Sequelize.literal(
  //           "CASE WHEN status IN ('payment pending', 'awaiting_refund') AND type = 'refund' THEN amount ELSE 0 END"
  //         )
  //       ),
  //       'totalUnPaidRefund'
  //     ]
  //   ],
  //   where: {
  //     bookingid: bookingid
  //   },
  //   raw: true // Ensures the result is plain JSON
  // });

  const room_no = await RoomDb.findOne({
    where: {
      roomno: roomno,
      gender: gender
    }
  });

  if (!room_no) throw new ApiError(404, 'unable to find room with that number');
  if (room_no == ROOM_BLOCKED)
    throw new ApiError(403, 'selected room is blocked');

  const updatedBooking = await RoomBooking.update(
    {
      roomno: roomno,
      roomtype: room_no.dataValues.roomtype,
      status: status
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
    throw new ApiError(200, 'Already Booked');
  }

  const today = moment().format('YYYY-MM-DD');
  const checkinDate = new Date(req.body.checkin_date);
  const checkoutDate = new Date(req.body.checkout_date);
  if (
    today > req.body.checkin_date ||
    today > req.body.checkout_date ||
    checkinDate > checkoutDate
  ) {
    throw new ApiError(200, 'Invalid Date');
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
    isBlocked.dataValues.roomstatus = ROOM_BLOCKED;
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
    isunBlocked.dataValues.roomstatus = ROOM_STATUS_AVAILABLE;
    await isunBlocked.save();
  }

  return res.status(200).send({ message: 'unblocking room successfully' });
};

export const blockRC = async (req, res) => {
  const block = await BlockDates.create({
    checkin: req.body.checkin_date,
    checkout: req.body.checkout_date,
    comments: req.body.comments
  });

  if (!block) {
    throw new ApiError(500, 'Error occured while blocking RC');
  }

  return res.status(200).send({ message: 'Blocked RC Successfully' });
};

export const unblockRC = async (req, res) => {
  const blocked = await BlockDates.destroy({
    where: {
      id: req.params.id
    }
  });

  if (blocked != 1) {
    throw new ApiError(500, 'Error in unblocking RC');
  }

  return res.status(200).send({ message: 'Unblocked RC' });
};
