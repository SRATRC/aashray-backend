import database from '../../config/database.js';
import Sequelize from 'sequelize';
import moment from 'moment';
import {
  STATUS_WAITING,
  STATUS_CANCELLED,
  TYPE_EXPENSE,
  STATUS_PAYMENT_PENDING,
  STATUS_PAYMENT_COMPLETED,
  STATUS_AWAITING_REFUND,
  TYPE_REFUND,
  STATUS_CONFIRMED,
  STATUS_OPEN
} from '../../config/constants.js';
import {
  UtsavDb,
  UtsavPackagesDb,
  UtsavBooking,
  UtsavBookingTransaction,
  UtsavGuestBooking,
  UtsavGuestBookingTransaction
} from '../../models/associations.js';
import ApiError from '../../utils/ApiError.js';
import { v4 as uuidv4 } from 'uuid';
import SendMail from '../../utils/sendMail.js';

// TODO: sending mails

export const FetchUpcoming = async (req, res) => {
  const utsav_bookings = await UtsavDb.findAll({
    include: [
      {
        model: UtsavPackagesDb,
        on: {
          id: Sequelize.col('UtsavDb.id')
        }
      }
    ],
    where: {
      start_date: {
        [Sequelize.Op.gte]: moment().format('YYYY-MM-DD')
      },
      status: STATUS_OPEN
    }
  });
  return res
    .status(200)
    .send({ message: 'Fetched data', data: utsav_bookings });
};

export const BookUtsav = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const utsav = await UtsavDb.findOne({
    where: {
      id: req.body.utsavid,
      status: STATUS_OPEN
    },
    lock: t.LOCK.UPDATE
  });

  const utsav_package = await UtsavPackagesDb.findOne({
    where: {
      id: req.body.packageid
    }
  });

  if (utsav == undefined || utsav_package == undefined) {
    throw new ApiError(500, 'Utsav or package not found');
  }

  const isBooked = await UtsavBooking.findOne({
    where: {
      cardno: req.user.cardno,
      utsavid: req.body.utsavid,
      status: { [Sequelize.Op.in]: [STATUS_WAITING, STATUS_CONFIRMED] }
    }
  });
  if (isBooked) {
    throw new ApiError(200, 'Already booked');
  }

  var status = STATUS_WAITING;

  if (utsav.dataValues.max_guests > 0) {
    status = STATUS_CONFIRMED;
  } else {
    status = STATUS_WAITING;
  }

  const utsav_booking = await UtsavBooking.create(
    {
      bookingid: uuidv4(),
      cardno: req.user.cardno,
      utsavid: req.body.utsavid,
      packageid: req.body.packageid,
      status: status
    },
    { transaction: t }
  );

  if (utsav.dataValues.max_guests > 0) {
    utsav.max_guests -= 1;
    await utsav.save({ transaction: t });
  }

  const utsav_transaction = await UtsavBookingTransaction.create(
    {
      bookingid: utsav_booking.dataValues.bookingid,
      cardno: req.user.cardno,
      type: TYPE_EXPENSE,
      amount: utsav_package.dataValues.amount,
      status: STATUS_PAYMENT_PENDING
    },
    { transaction: t }
  );

  if (utsav_booking == undefined || utsav_transaction == undefined) {
    throw new ApiError(500, 'Failed to book utsav');
  }

  await t.commit();

  return res.status(200).send({ message: 'Booking successful' });
};

export const BookGuestUtsav = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const utsav = await UtsavDb.findOne({
    where: {
      id: req.body.utsavid,
      status: STATUS_OPEN
    },
    lock: t.LOCK.UPDATE
  });

  const utsav_package = await UtsavPackagesDb.findOne({
    where: {
      id: req.body.packageid
    }
  });

  if (utsav == undefined || utsav_package == undefined) {
    throw new ApiError(500, 'Utsav or package not found');
  }

  var status = STATUS_WAITING;

  if (utsav.dataValues.max_guests > 0) {
    status = STATUS_CONFIRMED;
  } else {
    status = STATUS_WAITING;
  }

  const utsav_booking = await UtsavGuestBooking.create(
    {
      bookingid: uuidv4(),
      utsavid: req.body.utsavid,
      packageid: req.body.packageid,
      cardno: req.user.cardno,
      name: req.body.name,
      gender: req.body.gender,
      dob: req.body.dob,
      mobno: req.body.mobno,
      email: req.body.email,
      idType: req.body.idType,
      idNo: req.body.idNo,
      address: req.body.address,
      status: status
    },
    { transaction: t }
  );

  if (utsav.dataValues.max_guests > 0) {
    utsav.max_guests -= 1;
    await utsav.save({ transaction: t });
  }

  const utsav_transaction = await UtsavGuestBookingTransaction.create(
    {
      bookingid: utsav_booking.dataValues.bookingid,
      cardno: req.user.cardno,
      type: TYPE_EXPENSE,
      amount: utsav_package.dataValues.amount,
      status: STATUS_PAYMENT_PENDING
    },
    { transaction: t }
  );

  if (utsav_booking == undefined || utsav_transaction == undefined) {
    throw new ApiError(500, 'Failed to book utsav');
  }

  await t.commit();

  return res.status(200).send({ message: 'Booking Successful' });
};

export const ViewUtsavBookings = async (req, res) => {
  const user_bookings = await UtsavBooking.findAll({
    where: {
      cardno: req.user.cardno
    }
  });

  return res.status(200).send({ message: 'Fetched data', data: user_bookings });
};

export const CancelUtsavBooking = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const utsav_booking = await UtsavBooking.findOne({
    where: {
      cardno: req.user.cardno
    }
  });

  if (utsav_booking == undefined) {
    throw new ApiError(500, 'Booking not found');
  }

  utsav_booking.status = STATUS_CANCELLED;
  await utsav_booking.save({ transaction: t });

  const utsav_transaction = await UtsavBookingTransaction.findOne({
    where: {
      bookingid: utsav_booking.dataValues.bookingid,
      type: TYPE_EXPENSE
    }
  });

  if (utsav_transaction.dataValues.status == STATUS_PAYMENT_PENDING) {
    utsav_transaction.status = STATUS_CANCELLED;
    await utsav_transaction.save({ transaction: t });
  } else if (utsav_transaction.dataValues.status == STATUS_PAYMENT_COMPLETED) {
    utsav_transaction.status = STATUS_CANCELLED;
    await utsav_transaction.save({ transaction: t });

    await UtsavBookingTransaction.create(
      {
        bookingid: utsav_booking.dataValues.bookingid,
        cardno: req.user.cardno,
        type: TYPE_REFUND,
        amount: utsav_transaction.dataValues.amount,
        status: STATUS_AWAITING_REFUND
      },
      { transaction: t }
    );
  }

  await t.commit();
  return res.status(200).send({ message: 'Booking cancelled' });
};

export const ViewUtsavGuestBookings = async (req, res) => {
  const guest_bookings = await UtsavGuestBooking.findAll({
    where: {
      cardno: req.user.cardno
    }
  });

  return res
    .status(200)
    .send({ message: 'Fetched data', data: guest_bookings });
};

export const CancelUtsavGuestBooking = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const utsav_booking = await UtsavGuestBooking.findOne({
    where: {
      bookingid: req.body.bookingid
    }
  });

  if (utsav_booking == undefined) {
    throw new ApiError(500, 'Booking not found');
  }

  utsav_booking.status = STATUS_CANCELLED;
  await utsav_booking.save({ transaction: t });

  const utsav_transaction = await UtsavGuestBookingTransaction.findOne({
    where: {
      bookingid: req.body.bookingid,
      type: TYPE_EXPENSE
    }
  });

  if (utsav_transaction.dataValues.status == STATUS_PAYMENT_PENDING) {
    utsav_transaction.status = STATUS_CANCELLED;
    await utsav_transaction.save({ transaction: t });
  } else if (utsav_transaction.dataValues.status == STATUS_PAYMENT_COMPLETED) {
    utsav_transaction.status = STATUS_CANCELLED;
    await utsav_transaction.save({ transaction: t });

    await UtsavGuestBookingTransaction.create(
      {
        bookingid: utsav_booking.dataValues.bookingid,
        cardno: req.user.cardno,
        type: TYPE_REFUND,
        amount: utsav_transaction.dataValues.amount,
        status: STATUS_AWAITING_REFUND
      },
      { transaction: t }
    );
  }

  await t.commit();
  return res.status(200).send({ message: 'Booking cancelled' });
};
