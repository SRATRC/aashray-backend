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
  TYPE_ADHYAYAN
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
  return res.status(200).send({ message: 'fetched results', data: shibirs });
};

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

  const diff = total_seats - adhyayan.dataValues.total_seats;
  const available_seats = Math.max(0, adhyayan.dataValues.available_seats + diff);
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

  const t = await database.transaction();
  req.transaction = t;

  const adhyayan = (await validateAdhyayans(shibir_id))[0];
  const booking = await validateAdhyayanBooking(bookingid, shibir_id);

  // TODO: Can a booking have multiple transactions?
  var transaction = await Transactions.findOne({
    where: { bookingid: bookingid }
  });


  // Dont allow changing status of CANCELLED or ADMIN_CANCELLED bookings
  
  // 1. Booking Status = WAITING, Transaction is Not Created
  // 2. Booking Status = PAYMENT_PENDING, Transaction Status = PAYMENT_PENDING
  // 3. Booking Status = CONFIRMED, Transaction Status = PAYMENT_COMPLETED OR CASH_COMPLETED
  // 4. Booking Status = CANCELLED OR ADMIN_CANCELLED, Transaction is Not Created or Status = CANCELLED OR ADMIN_CANCELLED
  switch (status) {
    case STATUS_CONFIRMED:
      // TODO: only allow if adhyayan seats > 0
      if (!transaction) {
        transaction = await createPendingTransaction(
          booking.dataValues.cardno,
          bookingid,
          TYPE_ADHYAYAN,
          adhyayan.dataValues.amount,
          req.user.username,
          t
        );
      }
      // TODO: should we apply credits here?
      // TODO: this can be problematic if Admin CONFIRMS a WAITING or PAYMENT_PENDING booking which would
      //       mark the transaction as PAYMENT_COMPLETED and then if the booking is 
      //       CANCELLED, credits will be added to the Card.
      await useCredit(
        req.user,
        transaction.cardno,
        transaction,
        adhyayan.dataValues.amount,
        t
      );
      // TODO: how is upi_ref passed? how do we handle CASH_COMPLETED
      // TODO: only update the tranasction here, if any payments are pending
      await transaction.update( 
        {
          upi_ref: upi_ref || 'NA',
          status: upi_ref ? STATUS_PAYMENT_COMPLETED : STATUS_CASH_COMPLETED,
          updatedBy: req.user.username
        },
        { transaction: t }
      );

      await reserveAdhyayanSeat(adhyayan, t);

      break;

    case STATUS_PAYMENT_PENDING:
      if (booking.dataValues.status == STATUS_CONFIRMED) {
        // TODO: throw error saying that Confirmed booking can't be changed to Payment
        await openAdhyayanSeat(adhyayan, t);
      } 

      if (!transaction) {
        transaction = await createPendingTransaction(
          booking.dataValues.cardno,
          bookingid,
          TYPE_ADHYAYAN,
          adhyayan.dataValues.amount,
          req.user.username,
          t
        );
      }
      // TODO: apply credits and confirm the booking if possible
      await transaction.update( 
        {
          status: STATUS_PAYMENT_PENDING,
          updatedBy: req.user.username
        },
        { transaction: t }
      );

      await reserveAdhyayanSeat(adhyayan, t);

      break;
  

    case STATUS_ADMIN_CANCELLED:
    case STATUS_WAITING:
      // TODO: Should this behavior be same as ADMIN_CANCELLED?
      // TODO: Can't put a booking to WAITING status
      if (
        booking.dataValues.status == STATUS_CONFIRMED ||
        booking.dataValues.status == STATUS_PAYMENT_PENDING
      ) {
        await openAdhyayanSeat(adhyayan, t);
      }
      
      if (transaction) {
        await adminCancelTransaction(req.user, transaction, t);
      }

      break;

    default:
      throw new ApiError(400, 'Invalid status provided');
  }

  await booking.update(
    {
      status,
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
