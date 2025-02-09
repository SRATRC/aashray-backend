import {
  ShibirDb,
  ShibirBookingDb,
  CardDb,
} from '../../models/associations.js';
import {
  STATUS_WAITING,
  STATUS_CONFIRMED,
  STATUS_PAYMENT_PENDING,
  STATUS_ADMIN_CANCELLED,
  STATUS_PAYMENT_COMPLETED,
  STATUS_CANCELLED,
  STATUS_CASH_COMPLETED,
  TYPE_ADHYAYAN,
  ERR_BOOKING_ALREADY_CANCELLED,
  ERR_ADHYAYAN_NO_SEATS_AVAILABLE
} from '../../config/constants.js';
import database from '../../config/database.js';
import Sequelize, { QueryTypes } from 'sequelize';
import moment from 'moment';
import ApiError from '../../utils/ApiError.js';
import Transactions from '../../models/transactions.model.js';
import { adminCancelTransaction, createPendingTransaction, useCredit } from '../../helpers/transactions.helper.js';
import { 
  reserveAdhyayanSeat, 
  openAdhyayanSeat, 
  validateAdhyayanBooking, 
  validateAdhyayans 
} from '../../helpers/adhyayanBooking.helper.js';

export const createAdhyayan = async (req, res) => {
  const {
    name,
    start_date,
    end_date,
    speaker,
    amount,
    total_seats,
    food_allowed,
    comments
  } = req.body;

  const alreadyExists = await ShibirDb.findOne({
    where: {
      speaker: { [Sequelize.Op.like]: speaker },
      start_date: start_date
    }
  });
  if (alreadyExists) throw new ApiError(400, 'Adhyayan Already Exists');

  const month = moment(start_date).format('MMMM');

  const adhyayan_details = await ShibirDb.create({
    name: name,
    speaker: speaker,
    month: month,
    start_date: start_date,
    end_date: end_date,
    total_seats: total_seats,
    amount: amount,
    available_seats: total_seats,
    food_allowed: food_allowed,
    comments: comments,
    updatedBy: req.user.username
  });

  res.status(200).send({ message: 'Created Adhyayan', data: adhyayan_details });
};

export const fetchAllAdhyayan = async (req, res) => {
  const today = moment().format('YYYY-MM-DD');

  const page = parseInt(req.query.page) || req.body.page || 1;
  const pageSize = parseInt(req.query.page_size) || req.body.page_size || 10;
  const offset = (page - 1) * pageSize;

  const shibirs = await database.query(
    `SELECT 
		shibir_db.id,
    shibir_db.name,
    shibir_db.speaker,
    shibir_db.month,
    shibir_db.start_date,
    shibir_db.end_date,
    shibir_db.total_seats,
    shibir_db.available_seats,
    COUNT(shibir_booking_db.status) AS waitlist_count,
    shibir_db.food_allowed,
    shibir_db.comments,
    shibir_db.status,
    shibir_db.updatedBy
FROM 
    shibir_db
LEFT JOIN 
    shibir_booking_db ON shibir_db.id = shibir_booking_db.shibir_id
GROUP BY 
    shibir_db.id,
    shibir_db.name,
    shibir_db.speaker,
    shibir_db.month,
    shibir_db.start_date,
    shibir_db.end_date,
    shibir_db.total_seats,
    shibir_db.available_seats,
    shibir_db.food_allowed,
    shibir_db.comments,
    shibir_db.status,
    shibir_db.updatedBy
    
    LIMIT ${pageSize} OFFSET ${offset};`,
    {
      type: QueryTypes.SELECT
    }
  );
  return res.status(200).send({ message: 'Fetched Results', data: shibirs });
};

export const fetchAdhyayan = async (req, res) => {
  const { id } = req.params;
  await validateAdhyayans(id);

  const adhyayan = await ShibirDb.findOne({
    where: { id: id }
  });

  return res
    .status(200)
    .send({ message: 'Fetched Adhyayan', data: adhyayan });
}

export const fetchAdhyayanBookings = async (req, res) => {
  const { id } = req.params;
  const { status } = req.query;

  await validateAdhyayans(id);

  const adhyayanData = await ShibirBookingDb.findAll({
    attributes: ['bookingid', 'status', 'updatedBy'],
    include: [
      {
        model: CardDb,
        attributes: ['cardno', 'issuedto', 'mobno', 'center']
      }
      // TODO: include Guest Details if booked for Guest
    ],
    where: {
      shibir_id: id,
      status: status
    }
  });

  return res
    .status(200)
    .send({ message: 'Found Adhyayan', data: adhyayanData });
};

export const updateAdhyayan = async (req, res) => {
  const {
    name,
    start_date,
    end_date,
    speaker,
    amount,
    total_seats,
    food_allowed,
    comments
  } = req.body;

  const adhyayanId = req.params.id;
  const adhyayan = (await validateAdhyayans(adhyayanId))[0];

  const diff = total_seats - adhyayan.total_seats;
  const available_seats = Math.max(0, adhyayan.available_seats + diff);
  const month = moment(start_date).format('MMMM');

  await adhyayan.update({
    name,
    speaker,
    month,
    start_date,
    end_date,
    total_seats,
    amount,
    available_seats,
    food_allowed,
    comments,
    updatedBy: req.user.username
  });

  res.status(200).send({ message: 'Updated Adhyayan' });
};

// TODO: ask what shall be done in this function
export const adhyayanReport = async (req, res) => {
  res.status(200).send({ message: 'Fetched Adhyayan Report' });
};

export const adhyayanWaitlist = async (req, res) => {
  const today = moment().format('YYYY-MM-DD');

  const page = parseInt(req.query.page) || req.body.page || 1;
  const pageSize = parseInt(req.query.page_size) || req.body.page_size || 10;
  const offset = (page - 1) * pageSize;

  const data = await ShibirBookingDb.findAll({
    include: [
      {
        model: ShibirDb,
        attributes: ['name', 'speaker', 'start_date', 'end_date'],
        where: {
          start_date: {
            [Sequelize.Op.gte]: today
          }
        },
        required: true,
        order: [['start_date', 'ASC']]
      },
      {
        model: CardDb,
        attributes: ['issuedto', 'mobno', 'center'],
        required: true
      }
      // TODO: include Guest Details if booked for Guest
    ],
    where: {
      status: STATUS_WAITING
    },
    attributes: ['id', 'shibir_id', 'cardno', 'status'],
    offset,
    limit: pageSize
  });
  res.status(200).send({ message: 'Fetched Adhyayan', data: data });
};

export const adhyayanStatusUpdate = async (req, res) => {
  const { shibir_id, bookingid, status, upi_ref, description } = req.body;

  var newBookingStatus = status;

  const t = await database.transaction();
  req.transaction = t;

  const adhyayan = (await validateAdhyayans(shibir_id))[0];
  const booking = await validateAdhyayanBooking(bookingid, shibir_id);

  if (status == booking.status) {
    throw new ApiError(400, 'Status is same as before');
  }

  if (
    booking.status == STATUS_ADMIN_CANCELLED ||
    booking.status == STATUS_CANCELLED
  ) {
    throw new ApiError(400, ERR_BOOKING_ALREADY_CANCELLED);
  }

  var transaction = await Transactions.findOne({
    where: { bookingid: bookingid }
  });

  // 1. Booking Status = WAITING, Transaction is Not Created
  // 2. Booking Status = PAYMENT_PENDING, Transaction Status = PAYMENT_PENDING
  // 3. Booking Status = CONFIRMED, Transaction Status = PAYMENT_COMPLETED OR CASH_COMPLETED
  // 4. Booking Status = CANCELLED OR ADMIN_CANCELLED, Transaction is Not Created or Status = CANCELLED OR ADMIN_CANCELLED
  switch (status) {
    // Only Waiting & Payment Pending booking can be changed to
    // Confirmed 
    case STATUS_CONFIRMED:
      if (booking.status == STATUS_WAITING) {
        await reserveAdhyayanSeat(adhyayan, t);
      }

      if (!transaction) {
        transaction = await createPendingTransaction(
          booking.cardno,
          bookingid,
          TYPE_ADHYAYAN,
          adhyayan.amount,
          req.user.username,
          t
        );
      }

      await useCredit(
        transaction.cardno,
        booking,
        transaction,
        adhyayan.amount,
        req.user.username,
        t
      );

      // After applying credits, if the status is still payment pending
      // then accept the UPI or cash payment and mark is complete.
      if (transaction.status == STATUS_PAYMENT_PENDING) {
        await transaction.update(
          {
            upi_ref: upi_ref || 'NA',
            status: upi_ref ? STATUS_PAYMENT_COMPLETED : STATUS_CASH_COMPLETED,
            updatedBy: req.user.username
          },
          { transaction: t }
        );
      }

      break;

    case STATUS_PAYMENT_PENDING:
      if (booking.status == STATUS_CONFIRMED) {
        throw new ApiError(400, 'Confirmed booking\'s status cannot be changed to Payment Pending');
      }

      // Only Waiting booking can be changed to Payment Pending
      if (booking.status == STATUS_WAITING) {
        await reserveAdhyayanSeat(adhyayan, t);

        if (!transaction) {
          transaction = await createPendingTransaction(
            booking.cardno,
            bookingid,
            TYPE_ADHYAYAN,
            adhyayan.amount,
            req.user.username,
            t
          );
        }

        await useCredit(
          transaction.cardno,
          booking,
          transaction,
          adhyayan.amount,
          req.user.username,
          t
        );

        // After applying credits, if the transaction is complete
        // then confirm the booking.
        if (transaction.status == STATUS_PAYMENT_COMPLETED) {
          newBookingStatus = STATUS_CONFIRMED;
        }
      }

      break;
  
    case STATUS_ADMIN_CANCELLED:
      if (
        booking.status == STATUS_CONFIRMED ||
        booking.status == STATUS_PAYMENT_PENDING
      ) {
        await openAdhyayanSeat(adhyayan, booking.cardno, req.user.username, t);
      }
      
      if (transaction) {
        await adminCancelTransaction(req.user, transaction, t);
      }
      break;

    case STATUS_WAITING:
      throw new ApiError(400, 'Booking\'s status cannot be changed to Waiting');

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

export const activateAdhyayan = async (req, res) => {
  const itemUpdated = await ShibirDb.update(
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

  if (itemUpdated != 1)
    throw new ApiError(500, 'Error occured while activating adhyayan');
  res.status(200).send({ message: 'Adhyayan status updated' });
};
