import {
  RoomDb,
  RoomBooking,
  RoomBookingTransaction
} from '../../models/associations.js';
import getDates from '../../utils/getDates.js';
import database from '../../config/database.js';
import SendMail from '../../utils/sendMail.js';
import {
  ROOM_STATUS_AVAILABLE,
  STATUS_WAITING,
  ROOM_PRICE,
  ROOM_STATUS_CHECKEDIN,
  STATUS_CANCELLED,
  ROOM_WL,
  ROOM_STATUS_PENDING_CHECKIN,
  STATUS_PAYMENT_PENDING,
  TYPE_EXPENSE,
  STATUS_AWAITING_REFUND,
  STATUS_PAYMENT_COMPLETED
} from '../../config/constants.js';
import Sequelize from 'sequelize';
import { v4 as uuidv4 } from 'uuid';
import ApiError from '../../utils/ApiError.js';

export const AvailabilityCalender = async (req, res) => {
  const availabilityCalender = await checkBedAvailability(req);
  return res.status(200).send(availabilityCalender);
};

export const BookingForMumukshu = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  if (await checkAlreadyBooked(req)) {
    throw new ApiError(200, 'Already Booked');
  }

  const gender = req.body.gender || req.user.gender;
  const nights = await calculateNights(req);
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

    if (booking == undefined) {
      throw new ApiError(200, 'Failed to book a bed');
    }

    const transaction = await RoomBookingTransaction.create(
      {
        cardno: req.user.cardno,
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

    await t.commit();
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
        gender: gender
      },
      { transaction: t }
    );

    if (booking == undefined) {
      throw new ApiError(200, 'Failed to book a bed');
    }
  }

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

// TODO: flat booking button should only be shown on frontend if the person is a PR
export const FlatBooking = async (req, res) => {
  if (await checkAlreadyBooked(req)) {
    throw new ApiError(200, 'Already Booked');
  }

  const nights = await calculateNights(req);

  const booking = await RoomBooking.create({
    bookingid: uuidv4(),
    cardno: req.user.cardno,
    roomno: req.body.flat_no,
    checkin: req.body.checkin_date,
    checkout: req.body.checkout_date,
    nights: nights,
    roomtype: req.body.room_type,
    status: ROOM_STATUS_PENDING_CHECKIN,
    gender: gender
  });

  if (booking == undefined) {
    throw new ApiError(200, 'Failed to book your flat');
  }

  const message = `
      Dear ${booking.dataValues.guest_name},<br><br>

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
    email: req.user.email,
    subject: `Your Booking Confirmation for Stay at SRATRC`,
    message
  });

  return res.status(201).send({ message: 'booked successfully' });
};

export const ViewAllBookings = async (req, res) => {
  const page = req.body.page || 1;
  const pageSize = req.body.page_size || 10;
  const offset = (page - 1) * pageSize;

  const user_bookings = await RoomBooking.findAll({
    where: {
      cardno: req.params.cardno
    },
    offset,
    limit: pageSize,
    order: [['checkin', 'ASC']]
  });
  return res.status(200).send(user_bookings);
};

export const CancelBooking = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const booking = await RoomBooking.findOne({
    where: { bookingid: req.body.bookingid }
  });

  if (booking == undefined) {
    throw new ApiError(404, 'unable to find selected booking');
  }

  booking.status = STATUS_CANCELLED;
  await booking.save({ transaction: t });

  const roomBookingTransaction = await RoomBookingTransaction.findOne({
    where: {
      cardno: req.user.cardno,
      bookingid: req.body.bookingid,
      type: TYPE_EXPENSE,
      status: {
        [Sequelize.Op.in]: [STATUS_PAYMENT_PENDING, STATUS_PAYMENT_COMPLETED]
      }
    }
  });

  if (roomBookingTransaction == undefined) {
    throw new ApiError(404, 'unable to find selected booking');
  }

  if (roomBookingTransaction.status == STATUS_PAYMENT_PENDING) {
    roomBookingTransaction.status = STATUS_CANCELLED;
    await roomBookingTransaction.save({ transaction: t });
  } else if (roomBookingTransaction.status == STATUS_PAYMENT_COMPLETED) {
    roomBookingTransaction.status = STATUS_AWAITING_REFUND;
    await roomBookingTransaction.save({ transaction: t });
  }

  await t.commit();

  var message = `Dear ${req.user.issuedto},<br><br>
  Your booking for stay at Research Center as per following details has been canceled:<br><br>
  <b>Booking id:</b> ${booking.dataValues.bookingid}<br>
  <b>Check-in Date:</b> ${booking.dataValues.checkin}<br>
  <b>Check-out Date:</b> ${booking.dataValues.checkout}<br><br>

  Research Centre Admin office, <br>
  7875432613 / 9004273512`;

  SendMail({
    email: req.user.email,
    subject: `Your Booking for Stay at SRATRC has been Canceled`,
    message
  });

  res.status(200).send({ message: 'booking canceled' });
};

export const AddWaitlist = async (req, res) => {
  if (await checkAlreadyBooked(req)) {
    return res.status(200).send({ message: 'Already Booked' });
  }

  const nights = await calculateNights(req);

  const booking = await RoomBooking.create({
    cardno: req.user.cardno,
    guest_name: req.user.issuedto,
    centre: req.user.centre,
    roomno: ROOM_WL,
    checkin: req.body.checkin_date,
    checkout: req.body.checkout_date,
    nights: nights,
    roomtype: req.body.room_type,
    status: STATUS_WAITING,
    gender: req.user.gender,
    bookingid: uuidv4()
  });

  const message = `
      Dear ${booking.dataValues.guest_name},<br><br>

			You have been added to <b>waitlist</b> as per following details:<br><br>
			
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
    subject: `You have been added to waitlist for your stay at SRATRC`,
    message
  });

  return res.status(200).send({ message: 'booked successfully' });
};

async function checkBedAvailability(req) {
  const startDate = new Date(req.body.checkin_date);
  const endDate = new Date(req.body.checkout_date);
  if (startDate != endDate) endDate.setDate(endDate.getDate() - 1);

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
    const res = await RoomBooking.count({
      where: {
        checkin: { [Sequelize.Op.lte]: i },
        checkout: { [Sequelize.Op.gt]: i },
        status: {
          [Sequelize.Op.in]: [
            ROOM_STATUS_CHECKEDIN,
            ROOM_STATUS_PENDING_CHECKIN
          ]
        },
        gender: gender
      }
    });
    beds_occupied.push({
      dtbooked: i,
      count: res
    });
  }
  return { total_beds: total_beds, beds_occupied: beds_occupied };
}

async function checkAlreadyBooked(req) {
  const startDate = new Date(req.body.checkin_date);
  const endDate = new Date(req.body.checkout_date);
  if (startDate != endDate) endDate.setDate(endDate.getDate() - 1);

  const allDates = getDates(startDate, endDate);

  const user_bookings = await RoomBooking.findAll({
    where: {
      cardno: req.body.cardno || req.user.cardno,
      status: {
        [Sequelize.Op.in]: [ROOM_STATUS_CHECKEDIN, ROOM_STATUS_PENDING_CHECKIN]
      }
    }
  });

  for (var booking of user_bookings) {
    var chk_in = new Date(booking.dataValues.checkin);
    var chk_out = new Date(booking.dataValues.checkout);
    for (var date of allDates) {
      var dt3 = new Date(date);
      if (chk_in <= dt3 && chk_out > dt3) {
        return true;
      }
    }
  }
  return false;
}

async function calculateNights(req) {
  const date1 = new Date(req.body.checkin_date);
  const date2 = new Date(req.body.checkout_date);

  // Calculate the difference in days
  const timeDifference = date2.getTime() - date1.getTime();
  const nights = Math.ceil(timeDifference / (1000 * 3600 * 24));

  return nights;
}
