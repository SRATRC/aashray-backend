import { ShibirDb } from '../../models/associations.js';
import {
  STATUS_WAITING,
  STATUS_CONFIRMED,
  STATUS_PAYMENT_PENDING,
  STATUS_ADMIN_CANCELLED,
  STATUS_PAYMENT_COMPLETED,
  STATUS_CANCELLED,
  STATUS_CASH_COMPLETED,
  STATUS_CASH_PENDING,
  TYPE_ADHYAYAN,
  ERR_BOOKING_ALREADY_CANCELLED
} from '../../config/constants.js';
import {
  adminCancelTransaction,
  createPendingTransaction
} from '../../helpers/transactions.helper.js';
import {
  reserveAdhyayanSeat,
  openAdhyayanSeat,
  validateAdhyayanBooking,
  validateAdhyayans
} from '../../helpers/adhyayanBooking.helper.js';
import database from '../../config/database.js';
import Sequelize, { QueryTypes } from 'sequelize';
import moment from 'moment';
import ApiError from '../../utils/ApiError.js';
import Transactions from '../../models/transactions.model.js';
import { validateCard } from '../../helpers/card.helper.js';

export const createAdhyayan = async (req, res) => {
  const {
    name,
    start_date,
    end_date,
    speaker,
    amount,
    location,
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
    location: location,
    total_seats: total_seats,
    amount: amount,
    available_seats: total_seats,
    food_allowed: food_allowed,
    comments: comments,
    updatedBy: req.user.username
  });

  res.status(200).send({ message: 'Created Adhyayan', data: adhyayan_details });
};

export const fetchRCAdhyayan = async (req, res) => {
  const shibirs = await database.query(
    `SELECT 
      shibir_db.id,
      shibir_db.name,
      shibir_db.speaker,
      shibir_db.month,
      shibir_db.start_date,
      shibir_db.end_date,
      shibir_db.location,
      shibir_db.total_seats,
      shibir_db.available_seats,
      COUNT(CASE WHEN shibir_booking_db.status IN ('confirmed', 'cash completed') THEN 1 END) AS confirmed_count,
      COUNT(CASE WHEN shibir_booking_db.status = '${STATUS_WAITING}' THEN 1 END) AS waitlist_count,
      COUNT(CASE WHEN shibir_booking_db.status = '${STATUS_PAYMENT_PENDING}' THEN 1 END) AS pending_count,
      shibir_db.food_allowed,
      shibir_db.comments,
      shibir_db.status,
      shibir_db.updatedBy
    FROM 
      shibir_db
    LEFT JOIN 
      shibir_booking_db ON shibir_db.id = shibir_booking_db.shibir_id
    WHERE 
      shibir_db.start_date >= CURRENT_DATE - INTERVAL 7 DAY
      AND shibir_db.location = 'Research Centre'
    GROUP BY 
      shibir_db.id,
      shibir_db.name,
      shibir_db.speaker,
      shibir_db.month,
      shibir_db.start_date,
      shibir_db.end_date,
      shibir_db.location,
      shibir_db.total_seats,
      shibir_db.available_seats,
      shibir_db.food_allowed,
      shibir_db.comments,
      shibir_db.status,
      shibir_db.updatedBy
    ORDER BY 
      shibir_db.start_date ASC;`,
    {
      type: QueryTypes.SELECT
    }
  );

  return res.status(200).send({ message: 'Fetched Results', data: shibirs });
};

export const fetchKolAdhyayan = async (req, res) => {
  const shibirs = await database.query(
    `SELECT 
      shibir_db.id,
      shibir_db.name,
      shibir_db.speaker,
      shibir_db.month,
      shibir_db.start_date,
      shibir_db.end_date,
      shibir_db.location,
      shibir_db.total_seats,
      shibir_db.available_seats,
      COUNT(CASE WHEN shibir_booking_db.status IN ('confirmed', 'cash completed') THEN 1 END) AS confirmed_count,
      COUNT(CASE WHEN shibir_booking_db.status = '${STATUS_WAITING}' THEN 1 END) AS waitlist_count,
      COUNT(CASE WHEN shibir_booking_db.status = '${STATUS_PAYMENT_PENDING}' THEN 1 END) AS pending_count,
      shibir_db.food_allowed,
      shibir_db.comments,
      shibir_db.status,
      shibir_db.updatedBy
    FROM 
      shibir_db
    LEFT JOIN 
      shibir_booking_db ON shibir_db.id = shibir_booking_db.shibir_id
    WHERE 
      shibir_db.start_date >= CURRENT_DATE - INTERVAL 7 DAY
      AND shibir_db.location = 'Kolkata'
    GROUP BY 
      shibir_db.id,
      shibir_db.name,
      shibir_db.speaker,
      shibir_db.month,
      shibir_db.start_date,
      shibir_db.end_date,
      shibir_db.location,
      shibir_db.total_seats,
      shibir_db.available_seats,
      shibir_db.food_allowed,
      shibir_db.comments,
      shibir_db.status,
      shibir_db.updatedBy
    ORDER BY 
      shibir_db.start_date ASC;`,
    {
      type: QueryTypes.SELECT
    }
  );

  return res.status(200).send({ message: 'Fetched Results', data: shibirs });
};

export const fetchDhuleAdhyayan = async (req, res) => {
  const shibirs = await database.query(
    `SELECT 
      shibir_db.id,
      shibir_db.name,
      shibir_db.speaker,
      shibir_db.month,
      shibir_db.start_date,
      shibir_db.end_date,
      shibir_db.location,
      shibir_db.total_seats,
      shibir_db.available_seats,
      COUNT(CASE WHEN shibir_booking_db.status IN ('confirmed', 'cash completed') THEN 1 END) AS confirmed_count,
      COUNT(CASE WHEN shibir_booking_db.status = '${STATUS_WAITING}' THEN 1 END) AS waitlist_count,
      COUNT(CASE WHEN shibir_booking_db.status = '${STATUS_PAYMENT_PENDING}' THEN 1 END) AS pending_count,
      shibir_db.food_allowed,
      shibir_db.comments,
      shibir_db.status,
      shibir_db.updatedBy
    FROM 
      shibir_db
    LEFT JOIN 
      shibir_booking_db ON shibir_db.id = shibir_booking_db.shibir_id
    WHERE 
      shibir_db.start_date >= CURRENT_DATE - INTERVAL 7 DAY
      AND shibir_db.location = 'Dhule'
    GROUP BY 
      shibir_db.id,
      shibir_db.name,
      shibir_db.speaker,
      shibir_db.month,
      shibir_db.start_date,
      shibir_db.end_date,
      shibir_db.location,
      shibir_db.total_seats,
      shibir_db.available_seats,
      shibir_db.food_allowed,
      shibir_db.comments,
      shibir_db.status,
      shibir_db.updatedBy
    ORDER BY 
      shibir_db.start_date ASC;`,
    {
      type: QueryTypes.SELECT
    }
  );

  return res.status(200).send({ message: 'Fetched Results', data: shibirs });
};

export const fetchRajAdhyayan = async (req, res) => {
  const shibirs = await database.query(
    `SELECT 
      shibir_db.id,
      shibir_db.name,
      shibir_db.speaker,
      shibir_db.month,
      shibir_db.start_date,
      shibir_db.end_date,
      shibir_db.location,
      shibir_db.total_seats,
      shibir_db.available_seats,
      COUNT(CASE WHEN shibir_booking_db.status IN ('confirmed', 'cash completed') THEN 1 END) AS confirmed_count,
      COUNT(CASE WHEN shibir_booking_db.status = '${STATUS_WAITING}' THEN 1 END) AS waitlist_count,
      COUNT(CASE WHEN shibir_booking_db.status = '${STATUS_PAYMENT_PENDING}' THEN 1 END) AS pending_count,
      shibir_db.food_allowed,
      shibir_db.comments,
      shibir_db.status,
      shibir_db.updatedBy
    FROM 
      shibir_db
    LEFT JOIN 
      shibir_booking_db ON shibir_db.id = shibir_booking_db.shibir_id
    WHERE 
      shibir_db.start_date >= CURRENT_DATE - INTERVAL 7 DAY
      AND shibir_db.location = 'Rajnandgaon'
    GROUP BY 
      shibir_db.id,
      shibir_db.name,
      shibir_db.speaker,
      shibir_db.month,
      shibir_db.start_date,
      shibir_db.end_date,
      shibir_db.location,
      shibir_db.total_seats,
      shibir_db.available_seats,
      shibir_db.food_allowed,
      shibir_db.comments,
      shibir_db.status,
      shibir_db.updatedBy
    ORDER BY 
      shibir_db.start_date ASC;`,
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

  return res.status(200).send({ message: 'Fetched Adhyayan', data: adhyayan });
};

export const fetchAdhyayanBookings = async (req, res) => {
  const shibir_id = req.query.shibir_id;
  let status = req.query.status;
  if (status != null || status != undefined) {
    status = status.replace(/^"|"$/g, '');
    status = status.trim();
  }
  let statusToBeIncluded = [STATUS_CONFIRMED, STATUS_CASH_COMPLETED];

  if (status === 'waiting') {
    statusToBeIncluded = [STATUS_WAITING];
  } else if (status === 'pending') {
    statusToBeIncluded = [STATUS_PAYMENT_PENDING, STATUS_CASH_PENDING];
  }

  const page = parseInt(req.query.page) || req.body.page || 1;
  const pageSize = parseInt(req.query.page_size) || req.body.page_size || 10;
  const offset = (page - 1) * pageSize;
  await validateAdhyayans(shibir_id);

  const adhyayanData = await database.query(
    `SELECT t1.bookingid, t1.shibir_id, t1.bookedby, t1.status, t2.cardno, t2.issuedto, t2.mobno, t2.gender, t2.center, t2.res_status,t3.name
    FROM shibir_booking_db AS t1
    LEFT JOIN card_db AS t2 
    ON t1.cardno = t2.cardno 
    LEFT JOIN shibir_db AS t3 
    ON t1.shibir_id = t3.id 
    WHERE 
    t1.shibir_id = :shibirId And
    t1.status in  (:status);`,
    {
      replacements: {
        shibirId: shibir_id,
        status: statusToBeIncluded,
        pageSize: pageSize,
        page: offset
      },
      raw: true,
      type: QueryTypes.SELECT
    }
  );

  return res
    .status(200)
    .send({ message: 'Found Adhyayan Bookings', data: adhyayanData });
};

export const updateAdhyayan = async (req, res) => {
  const {
    name,
    start_date,
    end_date,
    speaker,
    amount,
    location,
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
    location,
    total_seats,
    amount,
    available_seats,
    food_allowed,
    comments,
    updatedBy: req.user.username
  });

  res.status(200).send({ message: 'Updated Adhyayan' });
};

export const adhyayanReport = async (req, res) => {
  res.status(200).send({ message: 'Fetched Adhyayan Report' });
};

export const adhyayanWaitlist = async (req, res) => {
  const { shibir_id, bookingid, status, description } = req.body;
  const today = moment().format('YYYY-MM-DD');

  const data = await database.query(
    `SELECT t1.bookingid, t1.shibir_id, t1.bookedby, t1.status, t2.id, t2.name, t2.speaker, 
    t2.start_date, t2.end_date, t3.cardno, t3.issuedto, t3.mobno, t3.center, t3.res_status
    FROM shibir_booking_db AS t1
    LEFT JOIN shibir_db AS t2 
    ON t1.shibir_id = t2.id 
    AND t2.start_date >= :date
    LEFT JOIN card_db AS t3 
    ON t1.cardno = t3.cardno 
    WHERE t1.status = :status`,
    {
      replacements: { date: today, status: STATUS_WAITING },
      raw: true,
      type: QueryTypes.SELECT
    }
  );
  res.status(200).send({ message: 'Fetched Adhyayan', data: data });
};

export const adhyayanPendinglist = async (req, res) => {
  const today = moment().format('YYYY-MM-DD');

  const data = await database.query(
    `SELECT t1.bookingid, t1.shibir_id, t1.bookedby, t1.status, t2.id, t2.name, t2.speaker, 
    t2.start_date, t2.end_date, t3.cardno, t3.issuedto, t3.mobno, t3.center, t3.res_status
    FROM shibir_booking_db AS t1
    LEFT JOIN shibir_db AS t2 
    ON t1.shibir_id = t2.id 
    AND t2.start_date >= :date
    LEFT JOIN card_db AS t3 
    ON t1.cardno = t3.cardno 
    WHERE t1.status = :statuses`,
    {
      replacements: {
        date: today,
        statuses: [STATUS_PAYMENT_PENDING, STATUS_CASH_PENDING]
      },
      raw: true,
      type: QueryTypes.SELECT
    }
  );
  res.status(200).send({ message: 'Fetched Adhyayan', data: data });
};

export const adhyayanStatusUpdate = async (req, res) => {
  const { shibir_id, bookingid, status, description } = req.body;

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

  const cardno = booking.bookedBy || booking.cardno;
  const bookedByCard = await validateCard(cardno);

  // 1. Booking Status = WAITING, Transaction is Not Created
  // 2. Booking Status = PAYMENT_PENDING, Transaction Status = PAYMENT_PENDING
  // 3. Booking Status = CONFIRMED, Transaction Status = PAYMENT_COMPLETED OR CASH_COMPLETED
  // 4. Booking Status = CANCELLED OR ADMIN_CANCELLED, Transaction is Not Created or Status = CANCELLED OR ADMIN_CANCELLED

  // waiting to confirmed
  // waiting to payment pending -- not needed
  //
  switch (status) {
    // Only Waiting & Payment Pending booking can be changed to
    // Confirmed
    case STATUS_CONFIRMED:
      if (booking.status == STATUS_WAITING) {
        await reserveAdhyayanSeat(adhyayan, t);
      }

      if (!transaction) {
        transaction = await createPendingTransaction(
          bookedByCard,
          booking,
          TYPE_ADHYAYAN,
          adhyayan.amount,
          req.user.username,
          t,
          true
        );
      }

      // TODO: is this correct?
      // After applying credits, if the status is still payment pending
      // then accept the UPI or cash payment and mark is complete.
      if (transaction.status == STATUS_PAYMENT_PENDING) {
        await transaction.update(
          {
            status: STATUS_CASH_COMPLETED,
            description: description,
            updatedBy: req.user.username
          },
          { transaction: t }
        );
      }

      break;

    case STATUS_PAYMENT_PENDING:
      if (booking.status == STATUS_CONFIRMED) {
        throw new ApiError(
          400,
          "Confirmed booking's status cannot be changed to Payment Pending"
        );
      }

      // Only Waiting booking can be changed to Payment Pending
      if (booking.status == STATUS_WAITING) {
        await reserveAdhyayanSeat(adhyayan, t);

        if (!transaction) {
          transaction = await createPendingTransaction(
            bookedByCard,
            booking,
            TYPE_ADHYAYAN,
            adhyayan.amount,
            req.user.username,
            t,
            true
          );
        }

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
        await adminCancelTransaction(req.user, bookedByCard, transaction, t);
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

export const fetchAllAdhyayanList = async (req, res) => {
  try {
    const adhyayans = await database.query(
      `SELECT id, name FROM shibir_db ORDER BY id ASC`,
      {
        type: QueryTypes.SELECT,
        raw: true
      }
    );

    return res.status(200).json({
      message: 'Fetched adhyayan list',
      data: adhyayans
    });
  } catch (error) {
    console.error('Error fetching adhyayans:', error);
    return res.status(500).json({
      message: 'Failed to fetch adhyayan list',
      error: error.message
    });
  }
};
