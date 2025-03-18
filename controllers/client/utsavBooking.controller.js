import {
  STATUS_PAYMENT_PENDING,
  STATUS_CONFIRMED,
  STATUS_OPEN,
  TYPE_UTSAV,
  TYPE_GUEST_UTSAV,
  MSG_BOOKING_SUCCESSFUL,
  STATUS_CLOSED,
  ERR_BOOKING_NOT_FOUND,
  MSG_CANCEL_SUCCESSFUL
} from '../../config/constants.js';
import {
  UtsavDb,
  UtsavPackagesDb,
  UtsavBooking
} from '../../models/associations.js';
import { v4 as uuidv4 } from 'uuid';
import {
  createPendingTransaction,
  generateOrderId,
  userCancelBooking
} from '../../helpers/transactions.helper.js';
import { createGuestsHelper } from '../helper.js';
import moment from 'moment';
import Sequelize from 'sequelize';
import database from '../../config/database.js';
import ApiError from '../../utils/ApiError.js';

// TODO: sending mails

export const FetchUpcoming = async (req, res) => {
  const today = moment().format('YYYY-MM-DD');

  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;

  const offset = (page - 1) * pageSize;

  const utsavs = await database.query(
    `
    SELECT t1.id AS utsav_id,
       t1.name AS utsav_name,
       t1.start_date AS utsav_start,
       t1.end_date AS utsav_end,
       t1.month AS utsav_month,
       JSON_ARRAYAGG(
           JSON_OBJECT(
               'package_id', t2.id,
               'package_name', t2.name,
               'package_start', t2.start_date,
               'package_end', t2.end_date,
               'package_amount', t2.amount
           )
       ) AS packages
    FROM utsav_db t1
    JOIN utsav_packages_db t2 ON t1.id = t2.utsavid
    WHERE t1.status = 'open'
      AND t1.start_date > :today
    GROUP BY t1.id
    ORDER BY t1.start_date ASC
    LIMIT :limit
    OFFSET :offset;
  `,
    {
      replacements: {
        today,
        limit: pageSize,
        offset: offset
      },
      type: database.QueryTypes.SELECT,
      raw: true
    }
  );

  const groupedByMonth = utsavs.reduce((acc, event) => {
    const month = event.utsav_month;
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

  const booking = await UtsavBooking.create(
    {
      bookingid: uuidv4(),
      cardno: req.user.cardno,
      utsavid: utsavid,
      packageid: packageid,
      status: STATUS_PAYMENT_PENDING,
      updatedBy: req.user.cardno
    },
    { transaction: t }
  );

  const transaction = await createPendingTransaction(
    req.user.cardno,
    booking,
    TYPE_UTSAV,
    utsav_package.amount,
    req.user.cardno,
    t
  );

  if (booking == undefined || transaction == undefined) {
    throw new ApiError(500, 'Failed to book utsav');
  }

  const order = await generateOrderId(utsav_package.amount);

  await t.commit();

  return res.status(200).send({ message: MSG_BOOKING_SUCCESSFUL, data: order });
};

export const BookGuestUtsav = async (req, res) => {
  const { utsavid, guests } = req.body;
  const { cardno } = req.user;

  const t = await database.transaction();
  req.transaction = t;

  const utsav = await UtsavDb.findOne({
    where: {
      id: utsavid
    }
  });
  if (!utsav) throw new ApiError(400, 'Utsav not found');
  if (utsav.status === STATUS_CLOSED)
    throw new ApiError(400, 'Utsav is closed');

  const packages = await UtsavPackagesDb.findAll({
    where: { utsavid }
  });

  const allGuests = await createGuestsHelper(cardno, guests, t);

  let total_amount = 0;
  const bookings = [];

  for (const guest of allGuests) {
    const bookingid = uuidv4();

    const package_info = packages.find((p) => p.id === guest.packageid);
    if (!package_info) {
      throw new ApiError(400, `Package ${guest.packageid} not found`);
    }

    const booking = await UtsavBooking.create(
      {
        bookingid,
        cardno: guest.cardno,
        bookedBy: cardno,
        utsavid,
        packageid: guest.packageid,
        status: STATUS_PAYMENT_PENDING,
        updatedBy: cardno
      },
      { transaction: t }
    );

    await createPendingTransaction(
      cardno,
      booking,
      TYPE_GUEST_UTSAV,
      package_info.amount,
      cardno,
      t
    );

    total_amount += package_info.amount;
    bookings.push(booking);
  }

  const order = await generateOrderId(total_amount);

  await t.commit();
  res.status(200).send({
    message: MSG_BOOKING_SUCCESSFUL,
    data: order
  });
};

export const BookMumukshuUtsav = async (req, res) => {
  const { utsavid, mumukshus } = req.body;
  const { cardno } = req.user;

  const t = await database.transaction();
  req.transaction = t;

  const utsav = await UtsavDb.findOne({
    where: {
      id: utsavid
    }
  });
  if (!utsav) throw new ApiError(400, 'Utsav not found');
  if (utsav.status === STATUS_CLOSED)
    throw new ApiError(400, 'Utsav is closed');

  const packages = await UtsavPackagesDb.findAll({
    where: { utsavid }
  });

  const mumukshu_cardnos = mumukshus.map((mumukshu) => mumukshu.cardno);
  const alreadyBooked = await UtsavBooking.findAll({
    where: {
      cardno: mumukshu_cardnos,
      utsavid: utsavid,
      status: { [Sequelize.Op.in]: [STATUS_PAYMENT_PENDING, STATUS_CONFIRMED] }
    }
  });

  if (alreadyBooked.length > 0) throw new ApiError(400, 'Already booked');

  let total_amount = 0;
  const bookings = [];

  for (const mumukshu of mumukshus) {
    const bookingid = uuidv4();

    const package_info = packages.find((p) => p.id === mumukshu.packageid);
    if (!package_info) {
      throw new ApiError(400, `Package ${mumukshu.packageid} not found`);
    }

    const booking = await UtsavBooking.create(
      {
        bookingid,
        utsavid,
        cardno: mumukshu.cardno,
        bookedBy: cardno,
        packageid: mumukshu.packageid,
        status: STATUS_PAYMENT_PENDING,
        updatedBy: cardno
      },
      { transaction: t }
    );

    await createPendingTransaction(
      cardno,
      booking,
      TYPE_UTSAV,
      package_info.amount,
      cardno,
      t
    );

    total_amount += package_info.amount;
    bookings.push(booking);
  }

  const order = await generateOrderId(total_amount);

  await t.commit();
  res.status(200).send({ message: MSG_BOOKING_SUCCESSFUL, data: order });
};

export const ViewUtsavBookings = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;

  const offset = (page - 1) * pageSize;

  const utsavs = await database.query(
    `
    SELECT t1.bookingid,
       t1.utsavid,
       t2.name AS utsav_name,
       t2.start_date AS utsav_start_date,
       t2.end_date AS utsav_end_date,
       t2.month,
       t1.packageid,
       t3.name AS package_name,
       t3.start_date AS package_start,
       t3.end_date AS package_end,
       t1.cardno,
       t1.bookedBy,
       t5.issuedto AS user_name,
       t1.status,
       t4.status AS transaction_status,
       t4.amount,
       t2.createdAt AS created_at
    FROM utsav_booking t1
    LEFT JOIN utsav_db t2 ON t1.utsavid = t2.id
    LEFT JOIN utsav_packages_db t3 ON t3.id = t1.packageid
    LEFT JOIN card_db t5 ON t5.cardno = t1.cardno
    LEFT JOIN transactions t4 ON t4.bookingid = t1.bookingid
    WHERE t1.cardno = :cardno OR t1.bookedBy = :cardno
    ORDER BY created_at DESC
    LIMIT :limit
    OFFSET :offset;
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

  return res.status(200).send({ data: utsavs });
};

export const CancelUtsavBooking = async (req, res) => {
  const { bookingid, bookedBy } = req.body;

  const t = await database.transaction();
  req.transaction = t;

  const booking = await UtsavBooking.findOne({
    where: {
      bookingid: bookingid,
      cardno: req.user.cardno,
      bookedBy: bookedBy ? bookedBy : null
    }
  });

  if (!booking) {
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  await userCancelBooking(req.user, booking, t);

  await t.commit();
  return res.status(200).send({ message: MSG_CANCEL_SUCCESSFUL });
};
