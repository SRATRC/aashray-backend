import {
  ShibirDb,
  ShibirBookingDb,
  Transactions
} from '../../models/associations.js';
import database from '../../config/database.js';
import Sequelize from 'sequelize';
import moment from 'moment';
import {
  STATUS_WAITING,
  STATUS_CONFIRMED,
  STATUS_CANCELLED,
  STATUS_PAYMENT_PENDING,
  TYPE_ADHYAYAN,
  ERR_BOOKING_NOT_FOUND
} from '../../config/constants.js';
import sendMail from '../../utils/sendMail.js';
import ApiError from '../../utils/ApiError.js';
import { 
  openAdhyayanSeat, 
  validateAdhyayans
} from '../../helpers/adhyayanBooking.helper.js';
import { 
  userCancelTransaction 
} from '../../helpers/transactions.helper.js';

export const FetchAllShibir = async (req, res) => {
  const today = moment().format('YYYY-MM-DD');

  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;

  const offset = (page - 1) * pageSize;

  const shibirs = await ShibirDb.findAll({
    where: {
      start_date: {
        [Sequelize.Op.gt]: today
      }
    },
    offset,
    limit: pageSize,
    order: [['start_date', 'ASC']]
  });

  const groupedByMonth = shibirs.reduce((acc, event) => {
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

export const FetchBookedShibir = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;
  const offset = (page - 1) * pageSize;

  const shibirs = await database.query(
    `SELECT 
      t1.bookingid, 
      COALESCE(t1.guest, 'NA') AS bookedFor,
      t4.name AS name,
      t1.shibir_id, 
      t1.status, 
      t2.name AS shibir_name, 
      t2.speaker, 
      t2.start_date, 
      t2.end_date, 
      COALESCE(t3.amount, 0) AS amount,
      t3.status AS transaction_status
    FROM shibir_booking_db t1
    JOIN shibir_db t2 ON t1.shibir_id = t2.id
    LEFT JOIN transactions t3 ON t1.bookingid = t3.bookingid AND t3.category = :category
    LEFT JOIN guest_db t4 ON t4.id = t1.guest
    WHERE t1.cardno = :cardno
    ORDER BY start_date DESC
    LIMIT :limit OFFSET :offset`,
    {
      replacements: {
        cardno: req.user.cardno,
        category: TYPE_ADHYAYAN,
        limit: pageSize,
        offset: offset
      },
      type: Sequelize.QueryTypes.SELECT
    }
  );

  return res.status(200).send({ data: shibirs });
};

export const CancelShibir = async (req, res) => {
  const { cardno, shibir_id, bookedFor } = req.body;

  const adhyayan = (await validateAdhyayans(shibir_id))[0];

  const t = await database.transaction();
  req.transaction = t;

  const booking = await ShibirBookingDb.findOne({
    where: {
      shibir_id: shibir_id,
      cardno: cardno,
      guest: bookedFor == undefined ? null : bookedFor,
      status: [
        STATUS_CONFIRMED,
        STATUS_WAITING,
        STATUS_PAYMENT_PENDING
      ]
    }
  });

  if (!booking) {
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  var transaction = await Transactions.findOne({
    where: { bookingid: booking.bookingid }
  });

  if (
    booking.status == STATUS_CONFIRMED ||
    booking.status == STATUS_PAYMENT_PENDING
  ) {
    await openAdhyayanSeat(adhyayan, booking.cardno, req.user.username, t);
  }

  if (transaction) {
    await userCancelTransaction(req.user, transaction, t);
  }

  await booking.update(
    {
      status: STATUS_CANCELLED,
      updatedBy: req.user.username
    },
    { transaction: t }
  );

  await t.commit();

  sendMail({
    email: req.user.email,
    subject: 'Shibir Booking Cancellation',
    template: 'rajAdhyayanCancellation',
    context: {
      name: req.user.issuedto,
      adhyayanName: adhyayan.dataValues.name
    }
  });

  return res.status(200).send({ message: 'Shibir booking cancelled' });
};

export const FetchShibirInRange = async (req, res) => {
  const { start_date } = req.query;
  let { end_date } = req.query;

  const startDateObj = new Date(start_date);
  if (!end_date) {
    const endDateObj = new Date(startDateObj);
    endDateObj.setDate(startDateObj.getDate() + 15); // Add 15 days
    end_date = endDateObj.toISOString().split('T')[0]; // Format the new end_date as YYYY-MM-DD
  }

  const whereCondition = {
    start_date: {
      [Sequelize.Op.gte]: start_date
    }
  };

  if (end_date) {
    whereCondition.start_date[Sequelize.Op.lte] = end_date;
    whereCondition.end_date = {
      [Sequelize.Op.gte]: start_date,
      [Sequelize.Op.lte]: end_date
    };
  }

  const shibirs = await ShibirDb.findAll({
    where: whereCondition,
    order: [['start_date', 'ASC']]
  });

  return res.status(200).send({ data: shibirs });
}
