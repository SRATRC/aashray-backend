import {
  ERR_BOOKING_NOT_FOUND,
  MSG_CANCEL_SUCCESSFUL
} from '../../config/constants.js';
import {
  UtsavBooking,
  UtsavDb,
  UtsavPackagesDb
} from '../../models/associations.js';
import { userCancelBooking } from '../../helpers/transactions.helper.js';
import moment from 'moment';
import database from '../../config/database.js';
import ApiError from '../../utils/ApiError.js';

import {
  getOtherBookingUser,
  notifyCardno
} from '../../helpers/notification.helper.js';

export const FetchUpcoming = async (req, res) => {
  const today = moment().format('YYYY-MM-DD');

  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;
  const offset = (page - 1) * (pageSize - 1);

  const utsavs = await database.query(
    `
    SELECT t1.id AS utsav_id,
       t1.name AS utsav_name,
       t1.start_date AS utsav_start,
       t1.end_date AS utsav_end,
       t1.month AS utsav_month,
       t1.location AS utsav_location,
       t1.status AS utsav_status,
       t1.registration_deadline AS registration_deadline,
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
    WHERE t1.start_date > :today
      AND (t1.registration_deadline IS NULL OR t1.registration_deadline >= :today)
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
       t2.location AS utsav_location,
       t1.packageid,
       t3.name AS package_name,
       t3.start_date AS package_start,
       t3.end_date AS package_end,
       t1.volunteer,
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
  const { bookingid } = req.body;

  const t = await database.transaction();
  req.transaction = t;

  const booking = await UtsavBooking.findOne({
    include: [
      {
        model: UtsavDb,
        as: 'UtsavDb'
      }
    ],
    where: {
      bookingid: bookingid
    }
  });

  if (!booking) {
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  await userCancelBooking(req.user, booking, t);

  await t.commit();

  if (booking.bookedBy) {
    const other = getOtherBookingUser(booking, req.user.cardno);
    if (other) {
      const title = 'Utsav Booking Cancelled';
      const body =
        req.user.cardno === booking.cardno
          ? `Booking of "${booking.UtsavDb.name}" for ${req.user.issuedto} has been cancelled.`
          : `Your booking of "${booking.UtsavDb.name}" has been cancelled.`;
      notifyCardno(other, {
        title,
        body,
        screen: '/bookings'
      });
    }
  }

  return res.status(200).send({ message: MSG_CANCEL_SUCCESSFUL });
};

export const FetchUtsavById = async (req, res) => {
  const { id } = req.params;
  const today = moment().format('YYYY-MM-DD');

  const utsav = await database.query(
    `
    SELECT t1.id AS utsav_id,
       t1.name AS utsav_name,
       t1.start_date AS utsav_start,
       t1.end_date AS utsav_end,
       t1.month AS utsav_month,
       t1.location AS utsav_location,
       t1.status AS utsav_status,
       t1.registration_deadline AS registration_deadline,
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
    WHERE t1.id = :id
      AND (t1.registration_deadline IS NULL OR t1.registration_deadline >= :today)
    GROUP BY t1.id;
  `,
    {
      replacements: {
        id: id,
        today: today
      },
      type: database.QueryTypes.SELECT,
      raw: true
    }
  );

  if (!utsav || utsav.length === 0) {
    throw new ApiError(404, 'Utsav not found');
  }

  return res.status(200).send({ data: utsav[0] });
};
