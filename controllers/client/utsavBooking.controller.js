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
  MSG_BOOKING_SUCCESSFUL,
  STATUS_CLOSED,
  RAZORPAY_FEE,
  ERR_BOOKING_NOT_FOUND,
  ERR_TRANSACTION_NOT_FOUND,
  MSG_CANCEL_SUCCESSFUL
} from '../../config/constants.js';
import {
  UtsavDb,
  UtsavPackagesDb,
  UtsavBooking,
  UtsavGuestBooking,
  GuestDb
} from '../../models/associations.js';
import ApiError from '../../utils/ApiError.js';
import { v4 as uuidv4 } from 'uuid';
import Transactions from '../../models/transactions.model.js';
import {
  createPendingTransaction,
  generateOrderId,
  userCancelTransaction
} from '../../helpers/transactions.helper.js';

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

  const booking = await UtsavBooking.create(
    {
      bookingid: uuidv4(),
      cardno: req.user.cardno,
      utsavid: utsavid,
      packageid: packageid,
      status: STATUS_PAYMENT_PENDING
    },
    { transaction: t }
  );

  const transaction = await createPendingTransaction(
    req.user.cardno,
    booking,
    TYPE_UTSAV,
    utsav_package.amount,
    'USER',
    t
  );

  if (booking == undefined || transaction == undefined) {
    throw new ApiError(500, 'Failed to book utsav');
  }

  const taxes =
    Math.round(utsav_package.amount * RAZORPAY_FEE * 100) / 100;
  const finalAmount = utsav_package.amount + taxes;

  const order = await generateOrderId(finalAmount);

  await t.commit();

  return res.status(200).send({ message: MSG_BOOKING_SUCCESSFUL, data: order });
};

export const BookGuestUtsav = async (req, res) => {
  const { utsavid, guests } = req.body;

  const t = await database.transaction();
  const { cardno } = req.user;

  const guestsToUpdate = guests.filter((guest) => guest.id);
  const guestsToCreate = guests
    .filter((guest) => !guest.id)
    .map((guest) => ({ ...guest, cardno }));

  if (guestsToUpdate.length > 0) {
    await Promise.all(
      guestsToUpdate.map(({ id, ...updateData }) =>
        GuestDb.update(updateData, {
          where: { id },
          transaction: t
        })
      )
    );
  }

  const createdGuests = guestsToCreate.length
    ? await GuestDb.bulkCreate(guestsToCreate, {
        transaction: t,
        returning: true
      })
    : [];

  const updatedGuests = guestsToUpdate.length
    ? await GuestDb.findAll({
        where: { id: guestsToUpdate.map((guest) => guest.id) },
        attributes: ['id', 'name', 'gender', 'mobno', 'type'],
        transaction: t
      })
    : [];

  const allGuests = [...updatedGuests, ...createdGuests].map((guest) =>
    guest.toJSON()
  );

  const guestIdMap = allGuests.reduce((map, guest) => {
    const key = `${guest.name}${guest.mobno}${guest.type}${guest.gender}`;
    map[key] = guest.id;
    return map;
  }, {});

  const guestsWithIds = guests.map((guest) => {
    const key = `${guest.name}${guest.mobno}${guest.type}${guest.gender}`;
    const id = guestIdMap[key];
    if (!id) throw new ApiError(404, `Guest not found for key: ${key}`);
    return { ...guest, id };
  });

  const totalPackageIds = guestsWithIds.map((guest) => guest.packageid);
  const totalGuestIds = guestsWithIds.map((guest) => guest.id);

  const [utsav, utsavPackage] = await Promise.all([
    UtsavDb.findOne({ where: { id: utsavid, status: STATUS_OPEN } }),
    UtsavPackagesDb.findOne({
      where: { id: totalPackageIds }
    })
  ]);

  if (!utsav || !utsavPackage)
    throw new ApiError(500, 'Utsav or package not found');

  const isBooked = await UtsavGuestBooking.findAll({
    where: {
      cardno,
      utsavid,
      guest: totalGuestIds,
      status: [
        STATUS_PAYMENT_PENDING, 
        STATUS_CONFIRMED
      ]
    }
  });

  if (isBooked.length > 0) throw new ApiError(400, 'Already booked');

  const amount = utsavPackage.amount;
  const bookingsAndTransactions = guestsWithIds.map(({ packageid, id }) => {
    const bookingid = uuidv4();
    return {
      booking: {
        bookingid,
        utsavid,
        packageid,
        cardno,
        guest: id,
        status: STATUS_PAYMENT_PENDING
      },
      transaction: {
        bookingid,
        cardno,
        category: TYPE_GUEST_UTSAV,
        amount,
        status: STATUS_PAYMENT_PENDING
      }
    };
  });

  const [utsavBooking, utsavTransactions] = [
    bookingsAndTransactions.map(({ booking }) => booking),
    bookingsAndTransactions.map(({ transaction }) => transaction)
  ];

  await Promise.all([
    UtsavGuestBooking.bulkCreate(utsavBooking, { transaction: t }),
    Transactions.bulkCreate(utsavTransactions, { transaction: t })
  ]);

  await t.commit();
  res.status(200).send({ message: MSG_BOOKING_SUCCESSFUL });
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
  if (utsav.status == STATUS_CLOSED) throw new ApiError(400, 'Utsav is closed');

  const packages = await UtsavPackagesDb.findAll({
    where: { utsavid: utsavid }
  });

  const mumukshu_cardnos = mumukshus.map((mumukshu) => mumukshu.cardno);
  const alreadyBooked = await UtsavBooking.findAll({
    where: {
      cardno: mumukshu_cardnos,
      utsavid: utsavid,
      status: [
        STATUS_PAYMENT_PENDING, 
        STATUS_CONFIRMED
      ]
    }
  });

  if (alreadyBooked.length > 0) throw new ApiError(400, 'Already booked');

  let utsav_bookings = [];
  let utsav_transactions = [];
  let total_amount = 0;

  for (const mumukshu of mumukshus) {
    const bookingid = uuidv4();
    const package_info = packages.find((p) => p.id == mumukshu.packageid);
    total_amount += package_info.amount;

    utsav_bookings.push({
      bookingid: bookingid,
      utsavid: utsavid,
      packageid: mumukshu.packageid,
      cardno: mumukshu.cardno,
      status: STATUS_PAYMENT_PENDING,
      updatedBy: cardno
    });

    if (package_info.amount > 0) {
      utsav_transactions.push({
        cardno: mumukshu.cardno,
        bookingid: bookingid,
        category: TYPE_UTSAV,
        amount: package_info.amount,
        status: STATUS_PAYMENT_PENDING,
        updatedBy: cardno
      });
    }
  }

  await UtsavBooking.bulkCreate(utsav_bookings, { transaction: t });
  await Transactions.bulkCreate(utsav_transactions, { transaction: t });

  const taxes = Math.round(total_amount * RAZORPAY_FEE * 100) / 100;
  const finalAmount = total_amount + taxes;

  const order = await generateOrderId(finalAmount);

  await t.commit();
  res.status(200).send({ message: MSG_BOOKING_SUCCESSFUL, data: order });
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
        t1.status,
        t4.status AS transaction_status,
        t4.amount,
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
        t1.status,
        t5.status AS transaction_status,
        t5.amount,
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

  return res.status(200).send({ data: utsavs });
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
  } else {
    booking = await UtsavBooking.findOne({
      where: { 
        bookingid: bookingid, 
        cardno: req.user.cardno 
      }
    });
  }

  if (!booking) {
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  await booking.update(
    {
      status: STATUS_CANCELLED,
      updatedBy: req.user.username
    },
    { transaction: t }
  );

  const transaction = await Transactions.findOne({
    where: {
      cardno: req.user.cardno,
      bookingid: bookingid,
      status: [
        STATUS_PAYMENT_PENDING,
        STATUS_PAYMENT_COMPLETED,
        STATUS_CASH_PENDING,
        STATUS_CASH_COMPLETED
      ]
    }
  });

  if (!transaction) {
    throw new ApiError(404, ERR_TRANSACTION_NOT_FOUND);
  }

  await userCancelTransaction(
    req.user,
    transaction,
    t
  );

  await t.commit();
  return res.status(200).send({ message: MSG_CANCEL_SUCCESSFUL });
};
