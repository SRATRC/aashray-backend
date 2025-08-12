import { ShibirDb, ShibirBookingDb , CardDb} from '../../models/associations.js';
import {
  STATUS_CONFIRMED,
  STATUS_PAYMENT_PENDING,
  TYPE_ADHYAYAN,
  ERR_BOOKING_NOT_FOUND,
  TYPE_GUEST_ADHYAYAN,
  STATUS_CANCELLED,
  STATUS_ADMIN_CANCELLED,
  ERR_BOOKING_ALREADY_CANCELLED,
  STATUS_DELETED
} from '../../config/constants.js';
import { openAdhyayanSeat } from '../../helpers/adhyayanBooking.helper.js';
import { userCancelBooking } from '../../helpers/transactions.helper.js';
import database from '../../config/database.js';
import Sequelize from 'sequelize';
import moment from 'moment';
import sendMail from '../../utils/sendMail.js';
import ApiError from '../../utils/ApiError.js';
import { sendNotification } from '../../helpers/sendNotification.helper.js';
// import { sendNotification } from '../../utils/sendNotification.js';

export const FetchAllShibir = async (req, res) => {
  const today = moment().format('YYYY-MM-DD');

  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;
  const offset = (page - 1) * pageSize;

  const shibirs = await ShibirDb.findAll({
    where: {
      start_date: {
        [Sequelize.Op.gt]: today
      },
      status: {
        [Sequelize.Op.ne]: STATUS_DELETED
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
    `
    SELECT t1.bookingid,
       t1.cardno,
       t1.bookedBy AS bookedBy,
       t4.issuedto AS name,
       t1.shibir_id,
       t2.location,
       t1.status,
       t2.name AS shibir_name,
       t2.speaker,
       t2.start_date,
       t2.end_date,
       COALESCE(t3.amount, 0) AS amount,
       t3.status AS transaction_status
    FROM shibir_booking_db t1
    JOIN shibir_db t2 ON t1.shibir_id = t2.id
    LEFT JOIN transactions t3 ON t1.bookingid = t3.bookingid
    AND t3.category IN (:category)
    LEFT JOIN card_db t4 ON t4.cardno = t1.cardno
    WHERE t1.cardno = :cardno OR t1.bookedBy = :cardno
    ORDER BY start_date DESC
    LIMIT :limit
    OFFSET :offset;
    `,
    {
      replacements: {
        cardno: req.user.cardno,
        category: [TYPE_ADHYAYAN, TYPE_GUEST_ADHYAYAN],
        limit: pageSize,
        offset: offset
      },
      type: Sequelize.QueryTypes.SELECT
    }
  );

  return res.status(200).send({ data: shibirs });
};

export const CancelShibir = async (req, res) => {
  const { bookingid } = req.body;

  const t = await database.transaction();
  req.transaction = t;

  const booking = await ShibirBookingDb.findOne({
    where: {
      bookingid: bookingid,
      [Sequelize.Op.or]: [
        { cardno: req.user.cardno },
        { bookedBy: req.user.cardno }
      ]
    }
  });

  if (!booking) {
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  if ([STATUS_CANCELLED, STATUS_ADMIN_CANCELLED].includes(booking.status)) {
    throw new ApiError(400, ERR_BOOKING_ALREADY_CANCELLED);
  }

  const adhyayan = await ShibirDb.findOne({
    where: { id: booking.shibir_id }
  });

  let newBooking = null;
  if ([STATUS_CONFIRMED, STATUS_PAYMENT_PENDING].includes(booking.status)) {
    newBooking = await openAdhyayanSeat(adhyayan, req.user.username, t);
  }

  await userCancelBooking(req.user, booking, t);
  await t.commit();


  sendMail({
    email: req.user.email,
    subject: 'Raj Adhyayan Booking Cancelled',
    template: 'rajAdhyayanCancellation',
    context: {
      name: req.user.issuedto,
      adhyayanName: adhyayan.name
    }
  });

  if (newBooking) {
    //sending email to user who got moved from waiting to pending and cc to the bookedBy user if any.
    const card = await CardDb.findOne({
      where: {
        cardno: newBooking.cardno
      }
    });
    let bookedByCard = null;
    if(newBooking.bookedBy){
       bookedByCard = await CardDb.findOne({
        where: {
          cardno: newBooking.bookedBy
        }
      });
    }
  sendMail({
    email: card.email,
    cc: bookedByCard ? bookedByCard.email : null,
    subject: 'Raj Adhyayan Booking Updated',
    template: 'rajAdhyayanUpdate',
    context: {
      name: card.issuedto,
      bookingid: newBooking.bookingid,
      status: newBooking.status,
      adhyayanName: adhyayan.name,
      adhyayanStartDate: adhyayan.start_date,
      adhyayanEndDate: adhyayan.end_date
      }
    });
  }
  // Call the refactored utility function
  if (req.user.pushToken) {
    await sendNotification([
      {
        token: req.user.pushToken,
        title: 'Booking Cancelled',
        body: `Your booking for "${adhyayan.name}" has been cancelled.`,
        screen: 'CancelledBookings',
        data: {
          shibir_id: adhyayan.id,
          status: 'cancelled'
        }
      }
    ]);
  }

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
};

export const FetchShibirById = async (req, res) => {
  const { id } = req.params;

  const shibir = await ShibirDb.findOne({
    where: {
      id: id
    }
  });

  if (!shibir) throw new ApiError(404, 'Shibir not found');

  return res.status(200).send({ data: shibir });
};
