import database from '../../config/database.js';
import Sequelize from 'sequelize';
import moment from 'moment';
import {
  STATUS_CANCELLED,
  STATUS_PAYMENT_PENDING,
  STATUS_CONFIRMED,
  STATUS_OPEN,
  TYPE_UTSAV,
  TYPE_GUEST_UTSAV,
  STATUS_CASH_PENDING,
  STATUS_PAYMENT_COMPLETED,
  STATUS_CASH_COMPLETED,
  STATUS_CREDITED
} from '../../config/constants.js';
import {
  UtsavDb,
  UtsavPackagesDb,
  UtsavBooking,
  UtsavGuestBooking
} from '../../models/associations.js';
import ApiError from '../../utils/ApiError.js';
import { v4 as uuidv4 } from 'uuid';
import Transactions from '../../models/transactions.model.js';

// TODO: sending mails

export const FetchUpcoming = async (req, res) => {
  const today = moment().format('YYYY-MM-DD');

  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;

  const offset = (page - 1) * pageSize;

  const utsavs = await UtsavDb.findAll({
    attributes: ['id', 'name', 'start_date', 'end_date', 'month'],
    include: [
      {
        model: UtsavPackagesDb,
        on: {
          id: Sequelize.col('UtsavDb.id')
        },
        attributes: [
          'id',
          'utsavid',
          'name',
          'start_date',
          'end_date',
          'amount'
        ]
      }
    ],
    where: {
      start_date: {
        [Sequelize.Op.gt]: today
      },
      status: STATUS_OPEN
    },
    offset,
    limit: pageSize,
    order: [['start_date', 'ASC']]
  });

  const groupedByMonth = utsavs.reduce((acc, event) => {
    const month = event.month;
    if (!acc[month]) {
      acc[month] = [];
    }
    acc[month].push(event);
    return acc;
  }, {});

  const formattedResponse = {
    message: 'fetched results',
    data: Object.keys(groupedByMonth).map((month) => ({
      title: month,
      data: groupedByMonth[month]
    }))
  };

  return res.status(200).send(formattedResponse);
};

export const BookUtsav = async (req, res) => {
  const { utsavid, packageid } = req.body;

  const t = await database.transaction();
  req.transaction = t;

  const utsav = await UtsavDb.findOne({
    where: {
      id: utsavid,
      status: STATUS_OPEN
    }
  });

  const utsav_package = await UtsavPackagesDb.findOne({
    where: {
      id: packageid
    }
  });

  if (utsav == undefined || utsav_package == undefined) {
    throw new ApiError(500, 'Utsav or package not found');
  }

  const isBooked = await UtsavBooking.findOne({
    where: {
      cardno: req.user.cardno,
      utsavid: utsavid,
      status: { [Sequelize.Op.in]: [STATUS_PAYMENT_PENDING, STATUS_CONFIRMED] }
    }
  });
  if (isBooked) {
    throw new ApiError(400, 'Already booked');
  }

  const utsav_booking = await UtsavBooking.create(
    {
      bookingid: uuidv4(),
      cardno: req.user.cardno,
      utsavid: utsavid,
      packageid: packageid,
      status: STATUS_PAYMENT_PENDING
    },
    { transaction: t }
  );

  const utsav_transaction = await Transactions.create(
    {
      cardno: req.user.cardno,
      bookingid: utsav_booking.dataValues.bookingid,
      category: TYPE_UTSAV,
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
  const { utsavid, packageid, guest } = req.body;

  const t = await database.transaction();
  req.transaction = t;

  const utsav = await UtsavDb.findOne({
    where: {
      id: utsavid,
      status: STATUS_OPEN
    }
  });

  const utsav_package = await UtsavPackagesDb.findOne({
    where: {
      id: packageid
    }
  });

  if (utsav == undefined || utsav_package == undefined) {
    throw new ApiError(500, 'Utsav or package not found');
  }

  const isBooked = await UtsavGuestBooking.findOne({
    where: {
      cardno: req.user.cardno,
      utsavid: utsavid,
      guest: guest,
      status: { [Sequelize.Op.in]: [STATUS_PAYMENT_PENDING, STATUS_CONFIRMED] }
    }
  });
  if (isBooked) {
    throw new ApiError(400, 'Already booked');
  }

  const utsav_booking = await UtsavGuestBooking.create(
    {
      bookingid: uuidv4(),
      utsavid: utsavid,
      packageid: packageid,
      cardno: req.user.cardno,
      guest: guest,
      status: STATUS_PAYMENT_PENDING
    },
    { transaction: t }
  );

  const utsav_transaction = await Transactions.create(
    {
      bookingid: utsav_booking.dataValues.bookingid,
      cardno: req.user.cardno,
      category: TYPE_GUEST_UTSAV,
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
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;

  const offset = (page - 1) * pageSize;

  const utsavs = await database.query(
    `
    WITH combined_results AS (
    SELECT 
        t1.bookingid,
        t1.utsavid, 
        t2.name AS utsav_name, 
        t2.start_date AS utsav_start_date, 
        t2.end_date AS utsav_end_date, 
        t2.month,
        t1.packageid, 
        t3.name AS package_name, 
        t3.start_date AS package_start, 
        t3.end_date AS package_end, 
        NULL AS bookedFor, 
        NULL AS guest_name, 
        t1.status AS booking_status,
        t4.status AS transaction_status,
        t2.createdAt AS created_at
    FROM 
        utsav_booking t1
    JOIN 
        utsav_db t2 ON t1.utsavid = t2.id
    JOIN 
        utsav_packages_db t3 ON t3.id = t1.packageid
    JOIN 
        transactions t4 ON t4.bookingid = t1.bookingid
    WHERE 
        t1.cardno = :cardno

    UNION ALL

    SELECT 
        t1.bookingid,
        t1.utsavid, 
        t2.name AS utsav_name, 
        t2.start_date AS utsav_start_date, 
        t2.end_date AS utsav_end_date, 
        t2.month,
        t1.packageid, 
        t3.name AS package_name, 
        t3.start_date AS package_start, 
        t3.end_date AS package_end, 
        t4.id AS bookedFor, 
        t4.name AS guest_name, 
        t1.status AS booking_status,
        t5.status AS transaction_status,
        t2.createdAt AS created_at
    FROM 
        utsav_guest_booking t1
    JOIN 
        utsav_db t2 ON t1.utsavid = t2.id
    JOIN 
        utsav_packages_db t3 ON t3.id = t1.packageid
    JOIN 
        guest_db t4 ON t1.guest = t4.id
    JOIN 
        transactions t5 ON t5.bookingid = t1.bookingid
    WHERE 
        t1.cardno = :cardno
)
SELECT *
FROM combined_results
ORDER BY created_at DESC
LIMIT :limit OFFSET :offset
  `,
    {
      replacements: {
        cardno: req.user.cardno,
        limit: pageSize,
        offset: offset
      },
      type: database.QueryTypes.SELECT,
      raw: true
    }
  );

  const groupedByMonth = utsavs.reduce((acc, event) => {
    const month = event.month;
    if (!acc[month]) {
      acc[month] = [];
    }
    acc[month].push(event);
    return acc;
  }, {});

  const formattedResponse = {
    message: 'fetched results',
    data: Object.keys(groupedByMonth).map((month) => ({
      title: month,
      data: groupedByMonth[month]
    }))
  };

  return res.status(200).send(formattedResponse);
};

export const CancelUtsavBooking = async (req, res) => {
  const { bookingid, bookedFor } = req.body;

  const t = await database.transaction();
  req.transaction = t;

  var booking = undefined;

  if (bookedFor !== null) {
    booking = await UtsavGuestBooking.findOne({
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

    const guestUtsavBookingTransaction = await Transactions.findOne({
      where: {
        cardno: req.user.cardno,
        bookingid: bookingid,
        category: TYPE_GUEST_UTSAV,
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

    if (guestUtsavBookingTransaction == undefined) {
      throw new ApiError(404, 'unable to find selected booking transaction');
    }

    if (
      guestUtsavBookingTransaction.status == STATUS_PAYMENT_PENDING ||
      guestUtsavBookingTransaction.status == STATUS_CASH_PENDING
    ) {
      guestUtsavBookingTransaction.status = STATUS_CANCELLED;
      await guestUtsavBookingTransaction.save({ transaction: t });
    } else if (
      guestUtsavBookingTransaction.status == STATUS_PAYMENT_COMPLETED ||
      guestUtsavBookingTransaction.status == STATUS_CASH_COMPLETED
    ) {
      guestUtsavBookingTransaction.status = STATUS_CREDITED;
      // TODO: add credited transaction to its table
      await guestUtsavBookingTransaction.save({ transaction: t });
    }
  } else {
    booking = await UtsavBooking.findOne({
      where: { bookingid: bookingid, cardno: req.user.cardno }
    });

    if (booking == undefined) {
      throw new ApiError(404, 'unable to find selected booking');
    }

    booking.status = STATUS_CANCELLED;
    await booking.save({ transaction: t });

    const guestUtsavBookingTransaction = await Transactions.findOne({
      where: {
        cardno: req.user.cardno,
        bookingid: bookingid,
        category: TYPE_UTSAV,
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

    if (guestUtsavBookingTransaction == undefined) {
      throw new ApiError(404, 'unable to find selected booking');
    }

    if (
      guestUtsavBookingTransaction.status == STATUS_PAYMENT_PENDING ||
      guestUtsavBookingTransaction.status == STATUS_CASH_PENDING
    ) {
      guestUtsavBookingTransaction.status = STATUS_CANCELLED;
      await guestUtsavBookingTransaction.save({ transaction: t });
    } else if (
      guestUtsavBookingTransaction.status == STATUS_PAYMENT_COMPLETED ||
      guestUtsavBookingTransaction.status == STATUS_CASH_COMPLETED
    ) {
      guestUtsavBookingTransaction.status = STATUS_CREDITED;
      // TODO: add credited transaction to its table
      await guestUtsavBookingTransaction.save({ transaction: t });
    }
  }

  await t.commit();
  return res.status(200).send({ message: 'Booking cancelled' });
};
