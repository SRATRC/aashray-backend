import { UtsavDb, UtsavPackagesDb } from '../../models/associations.js';
import {
  validateUtsavBooking,
  reserveUtsavSeat,
  openUtsavSeat,
  validateUtsavPackage
} from '../../helpers/utsavBooking.helper.js';
import Sequelize, { QueryTypes } from 'sequelize';
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
  STATUS_CASH_COMPLETED,
  TYPE_UTSAV,
  STATUS_CREDITED
} from '../../config/constants.js';
import Transactions from '../../models/transactions.model.js';
import database from '../../config/database.js';
import moment from 'moment';
import ApiError from '../../utils/ApiError.js';
import { validateCard } from '../../helpers/card.helper.js';

export const createUtsav = async (req, res) => {
  const { name, start_date, end_date, total_seats, location } = req.body;

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
    location: 'Research Centre',
    available_seats: total_seats,
    status: 'open',
    updatedBy: req.user.username
  });

  return res.status(200).send({ message: 'Created Utsav', data: utsavDetails });
};

export const addUtsavPackage = async (req, res) => {
  const { utsavid, name, start_date, end_date, amount } = req.body;

  const alreadyExists = await UtsavPackagesDb.findOne({
    where: {
      utsavid,
      name
    }
  });

  if (alreadyExists)
    throw new ApiError(
      400,
      'Package with this name already exists for the Utsav'
    );

  const packageData = await UtsavPackagesDb.create({
    utsavid,
    name,
    start_date,
    end_date,
    amount,
    updatedBy: req.user.username
  });

  return res
    .status(200)
    .send({ message: 'Package Created', data: packageData });
};

const validateUtsav = async (id) => {
  const utsav = await UtsavDb.findByPk(id);
  if (!utsav) throw new ApiError(404, 'Utsav not found');
  return utsav;
};

export const updateUtsav = async (req, res) => {
  const {
    name,
    start_date,
    end_date,
    status,
    total_seats,
    comments,
    location
  } = req.body;
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
    location,
    updatedBy: req.user.username
  });

  return res.status(200).send({ message: 'Updated Utsav' });
};

export const fetchUtsavBookings = async (req, res) => {
  const utsavid = req.query.utsavid;
  let status = req.query.status;

  if (status != null || status != undefined) {
    status = status.replace(/^"|"$/g, '').trim();
  }

  let statusToBeIncluded = [STATUS_CONFIRMED];
  if (status === 'waiting') {
    statusToBeIncluded = [STATUS_WAITING];
  }

  const page = parseInt(req.query.page) || req.body.page || 1;
  const pageSize = parseInt(req.query.page_size) || req.body.page_size || 10;
  const offset = (page - 1) * (pageSize - 1);

  await validateUtsav(utsavid);

  const utsavData = await database.query(
    `SELECT 
        t1.bookingid, t1.utsavid, t1.bookedby, t1.status, t1.packageid, t1.arrival, t1.carno, t1.other,
        t2.cardno, t2.issuedto, t2.mobno, t2.center, t2.res_status, t3.location,
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

  return res
    .status(200)
    .send({ message: 'Found Utsav Bookings', data: utsavData });
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
      utsav_db.location,
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
      utsav_db.location,
      utsav_db.available_seats      
     ORDER BY 
      utsav_db.start_date ASC;`,
    {
      type: QueryTypes.SELECT
    }
  );

  return res
    .status(200)
    .send({ message: 'Fetched Utsav Records', data: utsavs });
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
      c.res_status,
      u.location
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
  console.log('Received status:', status);

  const t = await database.transaction();
  req.transaction = t;

  const utsav = await validateUtsav(utsav_id);
  const booking = await validateUtsavBooking(bookingid, utsav_id);

  if (status === booking.status) {
    throw new ApiError(400, 'Status is same as before');
  }

  // Cannot change any status if already admin cancelled
  if (booking.status === STATUS_ADMIN_CANCELLED) {
    throw new ApiError(400, ERR_BOOKING_ALREADY_CANCELLED);
  }

  let transaction = await Transactions.findOne({
    where: { bookingid: bookingid }
  });

  switch (status) {
    case STATUS_CONFIRMED:
      // Confirmed allowed from waiting OR payment pending
      if (booking.status !== STATUS_PAYMENT_PENDING) {
        throw new ApiError(
          400,
          'Confirmed status can only be set from  payment pending'
        );
      }

      if (booking.status === STATUS_WAITING) {
        await reserveUtsavSeat(utsav, t);
      }

      if (!transaction) {
        const cardno = booking.bookedBy || booking.cardno;
        const card = await validateCard(cardno);

        transaction = await createPendingTransaction(
          card,
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
      if (booking.status !== STATUS_WAITING) {
        throw new ApiError(400, 'Payment Pending can only be set from waiting');
      }

      // Refresh transaction from DB just in case (to avoid stale object)
      transaction = await Transactions.findOne({
        where: { bookingid: booking.bookingid },
        transaction: t
      });

      if (
        !transaction ||
        ['credited', 'cancelled'].includes(transaction.status)
      ) {
        const packageData = await UtsavPackagesDb.findByPk(booking.packageid, {
          transaction: t
        });
        if (!packageData) throw new Error('Utsav Package not found');

        // Double-check to avoid race condition (find/create pattern)
        const [existingTransaction, created] = await Transactions.findOrCreate({
          where: { bookingid: booking.bookingid },
          defaults: {
            cardno: booking.cardno,
            category: TYPE_UTSAV,
            amount: packageData.amount,
            discount: 0,
            razorpay_order_id: null,
            description: req.body.description || 'Payment pending for Utsav',
            status: STATUS_PAYMENT_PENDING,
            updatedBy: req.user.username || 'admin'
          },
          transaction: t
        });

        if (!created) {
          if (['credited', 'cancelled'].includes(existingTransaction.status)) {
            // Existing transaction is not reusable → create a new one manually
            transaction = await Transactions.create(
              {
                bookingid: booking.bookingid,
                cardno: booking.cardno,
                category: TYPE_UTSAV,
                amount: packageData.amount,
                discount: 0,
                razorpay_order_id: null,
                description:
                  req.body.description || 'Payment pending for Utsav',
                status: STATUS_PAYMENT_PENDING,
                updatedBy: req.user.username || 'admin'
              },
              { transaction: t }
            );
          } else {
            console.warn(
              'Duplicate transaction avoided: already exists and active.'
            );
            transaction = existingTransaction;
          }
        } else {
          transaction = existingTransaction;
        }
      } else {
        console.warn('Valid transaction already exists. Skipping creation.');
      }

      newBookingStatus = STATUS_PAYMENT_PENDING;
      break;

    case STATUS_ADMIN_CANCELLED:
      console.log('>> Admin cancelling booking');

      // Admin Cancelled allowed from waiting, payment pending, or confirmed only
      if (
        booking.status !== STATUS_WAITING &&
        booking.status !== STATUS_PAYMENT_PENDING &&
        booking.status !== STATUS_CONFIRMED
      ) {
        throw new ApiError(
          400,
          'Admin Cancelled can only be set from waiting, payment pending or confirmed'
        );
      }

      if (
        booking.status === STATUS_CONFIRMED ||
        booking.status === STATUS_PAYMENT_PENDING
      ) {
        console.log('Booking.utsav_id:', booking.utsavid);
        const utsav = await UtsavDb.findByPk(booking.utsavid, {
          transaction: t
        });
        if (!utsav) {
          throw new ApiError(404, 'Utsav not found');
        }

        await openUtsavSeat(utsav, booking.cardno, req.user.username, t);
      }

      //       if (transaction && !['admin cancelled'].includes(transaction.status)) {
      //   await adminCancelTransaction(req.user, transaction, t);
      // } else {
      //   console.warn('Skipping transaction cancellation - already cancelled or credited');
      // }
      console.log(
        '>> Transaction object:',
        transaction?.toJSON?.() || transaction
      );
      console.log(
        '>> Transaction status before admin cancel check:',
        transaction?.status
      );

      if (
        transaction &&
        ![STATUS_CREDITED, STATUS_ADMIN_CANCELLED].includes(transaction.status)
      ) {
        await adminCancelTransaction(req.user, transaction, t);
        console.log('>> Cancelling transaction...');
      } else {
        console.warn(
          'Skipping transaction cancellation - already credited or cancelled'
        );
      }

      newBookingStatus = STATUS_ADMIN_CANCELLED;
      break;

    case STATUS_WAITING:
      // No direct transitions back to waiting allowed
      throw new ApiError(400, 'Invalid status transition to waiting');

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

  const utsav = await UtsavDb.findOne({
    where: { id: id }
  });

  return res.status(200).send({ message: 'Fetched Adhyayan', data: utsav });
};

export const updateUtsavPackage = async (req, res) => {
  const { name, start_date, end_date, amount } = req.body;
  const { id: packageId, utsavId } = req.params;

  const utsavPackage = await validateUtsavPackage(packageId, utsavId);

  await utsavPackage.update({
    name,
    start_date,
    end_date,
    amount,
    updatedBy: req.user.username
  });

  return res.status(200).send({ message: 'Updated Utsav Package' });
};

export const fetchAllPackages = async (req, res) => {
  const packages = await database.query(
    `SELECT 
      utsav_packages_db.id,
      utsav_packages_db.utsavid,
      utsav_packages_db.name,
      utsav_packages_db.start_date,
      utsav_packages_db.end_date,
      utsav_packages_db.amount,
      utsav_db.name AS utsav_name,
      COUNT(CASE WHEN utsav_booking.status = '${STATUS_WAITING}' THEN 1 END) AS waitlist_count
    FROM 
      utsav_packages_db
    LEFT JOIN 
      utsav_db ON utsav_packages_db.utsavid = utsav_db.id
    LEFT JOIN 
      utsav_booking ON utsav_packages_db.id = utsav_booking.packageid
    WHERE 
      utsav_packages_db.start_date > CURRENT_DATE
    GROUP BY 
      utsav_packages_db.id,
      utsav_packages_db.utsavid,
      utsav_packages_db.name,
      utsav_packages_db.start_date,
      utsav_packages_db.end_date,
      utsav_packages_db.amount,
      utsav_db.name
    ORDER BY 
      utsav_packages_db.start_date ASC;`,
    {
      type: QueryTypes.SELECT
    }
  );

  return res
    .status(200)
    .send({ message: 'Fetched Package Records', data: packages });
};

export const fetchPackage = async (req, res) => {
  const { id } = req.params;

  const packageData = await UtsavPackagesDb.findOne({
    where: { id: id }
  });

  if (!packageData) {
    return res.status(404).send({ message: 'Package not found' });
  }

  return res
    .status(200)
    .send({ message: 'Fetched Package', data: packageData });
};
