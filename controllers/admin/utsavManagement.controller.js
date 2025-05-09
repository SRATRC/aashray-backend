import { UtsavDb, UtsavPackagesDb } from '../../models/associations.js';
import Transactions from '../../models/transactions.model.js';
import database from '../../config/database.js';
import Sequelize, { QueryTypes } from 'sequelize';
import moment from 'moment';
import ApiError from '../../utils/ApiError.js';
import {
  validateUtsavBooking,
  reserveUtsavSeat,
  validateUtsavs
} from '../../helpers/utsavBooking.helper.js';

import {
  adminCancelTransaction,
  createPendingTransaction
} from '../../helpers/transactions.helper.js';

import {
  STATUS_WAITING,
  STATUS_CONFIRMED,
  STATUS_PAYMENT_PENDING,
  STATUS_ADMIN_CANCELLED,
  STATUS_PAYMENT_COMPLETED,
  STATUS_CANCELLED,
  STATUS_CASH_COMPLETED,
  TYPE_UTSAV
} from '../../config/constants.js';


export const createUtsav = async (req, res) => {
  const { name, start_date, end_date, total_seats } = req.body;

  // Check if Utsav already exists with same name and start date
  const alreadyExists = await UtsavDb.findOne({
    where: {
      name: { [Sequelize.Op.like]: name },
      start_date: start_date
    }
  });

  if (alreadyExists) throw new ApiError(400, 'Utsav Already Exists');

  const month = moment(start_date).format('MMMM');

  const utsavDetails = await UtsavDb.create({
    name,
    start_date,
    end_date,
    month,
    total_seats,
    available_seats: total_seats,
    status: 'open', // default starting status
    updatedBy: req.user.username // optional, remove if not in schema
  });

  return res.status(200).send({ message: 'Created Utsav', data: utsavDetails });
};

export const addUtsavPackage = async (req, res) => {
  const { utsavid, name, start_date, end_date, amount } = req.body;

  // Optional: Check for duplicate package for same utsav
  const alreadyExists = await UtsavPackagesDb.findOne({
    where: {
      utsavid,
      name
    }
  });

  if (alreadyExists) throw new ApiError(400, 'Package with this name already exists for the Utsav');

  const packageData = await UtsavPackagesDb.create({
    utsavid,
    name,
    start_date,
    end_date,
    amount,
    updatedBy: req.user.username
  });

  return res.status(200).send({ message: 'Package Created', data: packageData });
};

const validateUtsav = async (id) => {
  const utsav = await UtsavDb.findByPk(id);
  if (!utsav) throw new ApiError(404, 'Utsav not found');
  return utsav;
};

export const updateUtsav = async (req, res) => {
  const { name, start_date, end_date, status, total_seats, comments } = req.body;
  const utsavId = req.params.id;

  const utsav = await validateUtsav(utsavId);
  const month = moment(start_date).format('MMMM');

  await utsav.update({
    name,
    start_date,
    end_date,
    month,
    status,
    total_seats,
    comments,
    updatedBy: req.user.username // remove if not in schema
  });

  return res.status(200).send({ message: 'Updated Utsav' });
};



export const fetchUtsavBookings = async (req, res) => {
  const utsavid = req.query.utsavid;
  let status = req.query.status;

  if (status != null || status != undefined) {
    status = status.replace(/^"|"$/g, '').trim();
  }

  let statusToBeIncluded = [STATUS_CONFIRMED, STATUS_PAYMENT_PENDING];
  if (status === 'waiting') {
    statusToBeIncluded = [STATUS_WAITING];
  }

  const page = parseInt(req.query.page) || req.body.page || 1;
  const pageSize = parseInt(req.query.page_size) || req.body.page_size || 10;
  const offset = (page - 1) * pageSize;

  await validateUtsav(utsavid);

  const utsavData = await database.query(
    `SELECT 
        t1.bookingid, t1.utsavid, t1.bookedby, t1.status, t1.packageid, t1.arrival, t1.carno, t1.other,
        t2.cardno, t2.issuedto, t2.mobno, t2.center, t2.res_status,
        t3.name AS utsav_name
     FROM utsav_booking AS t1
     LEFT JOIN card_db AS t2 ON t1.cardno = t2.cardno
     LEFT JOIN utsav_db AS t3 ON t1.utsavid = t3.id
     WHERE t1.utsavid = :utsavid AND t1.status IN (:status)
     LIMIT :pageSize OFFSET :offset;`,
    {
      replacements: {
        utsavid,
        status: statusToBeIncluded,
        pageSize,
        offset
      },
      raw: true,
      type: QueryTypes.SELECT
    }
  );

  return res.status(200).send({ message: 'Found Utsav Bookings', data: utsavData });
};


export const fetchAllUtsav = async (req, res) => {
  const utsavs = await database.query(
    `SELECT 
      utsav_db.id,
      utsav_db.name,
      utsav_db.start_date,
      utsav_db.end_date,
      utsav_db.status,
      utsav_db.total_seats,
      utsav_db.available_seats,
      COUNT(CASE WHEN utsav_booking.status = '${STATUS_WAITING}' THEN 1 END) AS waitlist_count  
    FROM 
      utsav_db
    LEFT JOIN 
      utsav_booking ON utsav_db.id = utsav_booking.utsavid
    WHERE 
      utsav_db.start_date > CURRENT_DATE
    GROUP BY 
      utsav_db.id,
      utsav_db.name,
      utsav_db.start_date,
      utsav_db.end_date,
      utsav_db.status,
      utsav_db.total_seats,
      utsav_db.available_seats      
     ORDER BY 
      utsav_db.start_date ASC;`,
    {
      type: QueryTypes.SELECT
    }
  );

  return res.status(200).send({ message: 'Fetched Utsav Records', data: utsavs });
};


export const utsavWaitlist = async (req, res) => {
  const today = moment().format('YYYY-MM-DD');

  const data = await database.query(
    `SELECT 
      b.bookingid, 
      b.utsavid, 
      b.bookedby, 
      b.status, 
      u.id AS utsav_id, 
      u.name, 
      u.start_date, 
      u.end_date, 
      c.cardno, 
      c.issuedto, 
      c.mobno, 
      c.center, 
      c.res_status
    FROM utsav_booking AS b
    LEFT JOIN utsav_db AS u 
      ON b.utsavid = u.id 
      AND u.start_date >= :date
    LEFT JOIN card_db AS c 
      ON b.cardno = c.cardno 
    WHERE b.status = :status`,
    {
      replacements: { date: today, status: STATUS_WAITING },
      raw: true,
      type: QueryTypes.SELECT
    }
  );

  res.status(200).send({ message: 'Fetched Utsav Waitlist', data });
};


export const activateUtsav = async (req, res) => {
  const itemUpdated = await UtsavDb.update(
    {
      status: req.params.activate,
      updatedBy: req.user.username
    },
    {
      where: {
        id: req.params.id
      }
    }
  );

  if (itemUpdated[0] !== 1)
    throw new ApiError(500, 'Error occurred while updating Utsav status');

  res.status(200).send({ message: 'Utsav status updated' });
};


export const utsavStatusUpdate = async (req, res) => {
  const { utsav_id, bookingid, status, upi_ref, description } = req.body;

  let newBookingStatus = status;

  const t = await database.transaction();
  req.transaction = t;

  const utsav = (await validateUtsav(utsav_id))[0];
  const booking = await validateUtsavBooking(bookingid, utsav_id);

  if (status === booking.status) {
    throw new ApiError(400, 'Status is same as before');
  }

  if (
    booking.status === STATUS_ADMIN_CANCELLED ||
    booking.status === STATUS_CANCELLED
  ) {
    throw new ApiError(400, ERR_BOOKING_ALREADY_CANCELLED);
  }

  let transaction = await Transactions.findOne({
    where: { bookingid: bookingid }
  });

  const bookedBy = booking.bookedBy || booking.cardno;

  switch (status) {
    case STATUS_CONFIRMED:
      if (booking.status === STATUS_WAITING) {
        await reserveUtsavSeat(utsav, t);
      }

      if (!transaction) {
        transaction = await createPendingTransaction(
          bookedBy,
          booking,
          TYPE_UTSAV,
          utsav.amount,
          req.user.username,
          t,
          true
        );
      }

      if (transaction.status === STATUS_PAYMENT_PENDING) {
        await transaction.update(
          {
            upi_ref: upi_ref || 'NA',
            status: upi_ref ? STATUS_PAYMENT_COMPLETED : STATUS_CASH_COMPLETED,
            description: description,
            updatedBy: req.user.username
          },
          { transaction: t }
        );
      }
      break;

    case STATUS_PAYMENT_PENDING:
      if (booking.status === STATUS_CONFIRMED) {
        throw new ApiError(
          400,
          "Confirmed booking's status cannot be changed to Payment Pending"
        );
      }

      if (booking.status === STATUS_WAITING) {
        await reserveUtsavSeat(utsav, t);

        if (!transaction) {
          transaction = await createPendingTransaction(
            bookedBy,
            booking,
            TYPE_UTSAV,
            utsav.amount,
            req.user.username,
            t,
            true
          );
        }

        if (transaction.status === STATUS_PAYMENT_COMPLETED) {
          newBookingStatus = STATUS_CONFIRMED;
        }
      }
      break;

    case STATUS_ADMIN_CANCELLED:
      if (
        booking.status === STATUS_CONFIRMED ||
        booking.status === STATUS_PAYMENT_PENDING
      ) {
        await openUtsavSeat(utsav, booking.cardno, req.user.username, t);
      }

      if (transaction) {
        await adminCancelTransaction(req.user, transaction, t);
      }
      break;

    case STATUS_WAITING:
    default:
      throw new ApiError(400, 'Invalid status provided');
  }

  await booking.update(
    {
      status: newBookingStatus,
      updatedBy: req.user.username
    },
    { transaction: t }
  );

  await t.commit();
  return res.status(200).send({ message: 'Updated booking status' });
};


export const fetchUtsav = async (req, res) => {
  const { id } = req.params;
  // await validateUtsavs(id);

  const utsav = await UtsavDb.findOne({
    where: { id: id }
  });

  return res.status(200).send({ message: 'Fetched Adhyayan', data: utsav });
};
