import './config/environment.js';
import moment from 'moment';
import { adminCancelTransaction, getPendingTransactions } from './helpers/transactions.helper.js';
import database from './config/database.js';
import cron from 'node-cron';
import logger from './config/logger.js';
import { 
  STATUS_ADMIN_CANCELLED,
  STATUS_PAYMENT_PENDING,
  STATUS_PROCEED_FOR_PAYMENT,
  TYPE_FOOD,
} from './config/constants.js';
import RoomBooking from './models/room_booking.model.js';
import ShibirBookingDb from './models/shibir_booking_db.model.js';
import TravelDb from './models/travel_db.model.js';
import AdminUsers from './models/admin_users.model.js';
import { cancelFood } from './helpers/foodBooking.helper.js';
import UtsavBooking from './models/utsav_boking.model.js';
import FlatBooking from './models/flat_booking.model.js';
import { Sequelize } from 'sequelize';
import Transactions from './models/transactions.model.js';
import ShibirDb from './models/shibir_db.model.js';
import { sendCancellationEmail } from './helpers/mailer.helper.js';
import { getBooking, getBookingType, getBookingTypeFromBooking } from './helpers/booking.helper.js';
import UtsavDb from './models/utsav_db.model.js';
import { validateCard } from './helpers/card.helper.js';

const MAX_APP_PAYMENT_DURATION = 24*60; // 24 hrs

// Schedule the cron job to run every 10 minutes
const job = cron.schedule('*/1 * * * *', async () => {
  logger.info('Cron job started');

  await database.authenticate();


  const systemUser = AdminUsers.findOne({
    where: { username: "admin" } 
  });

  const userBookingIds = {};
  const transactions = [];
  const bookings = [];

  try {
    const t = await database.transaction();

    await getUnpaidOnlineBookingsAndTransactions(bookings, transactions);
    await getUnpaidPastBookingsAndTransactions(bookings, transactions);

    await cancelBookings(systemUser, bookings, userBookingIds, t);
    await cancelTransactions(systemUser, transactions, t);
    await t.commit();

    for (const cardno in userBookingIds) {
      const bookingIds = userBookingIds[cardno];
      await sendCancellationEmail(cardno, bookingIds, null);
    }

  } catch (error) {
    logger.error('Cron job error:', error);
    await t.rollback();
  }

  logger.info('Cron job finished.');
});

job.stop();
job.start();

async function cancelTransactions(systemUser, transactions, t) {
  const transactionsByCard = transactions.reduce((acc, transaction) => {
    const cardno = transaction.cardno;
    acc[cardno] = acc[cardno] || [];
    acc[cardno].push(transaction);
    return acc;
  }, {});

  for (const cardno in transactionsByCard) {
    const cardTransactions = transactionsByCard[cardno];
    const card = await validateCard(cardno);

    for (const transaction of cardTransactions) {
      const bookingType = getBookingType(transaction);
      if (bookingType == TYPE_FOOD) {
        logger.info("Cancelling Food Transaction : " + JSON.stringify(transaction.id));
        await cancelFoodTransaction(systemUser, card, transaction, t)
      } else {
        logger.info("Cancelling Transaction : " + JSON.stringify(transaction.id));
        await adminCancelTransaction(systemUser, card, transaction, t);
      }
    }
  }
}

async function getUnpaidOnlineBookingsAndTransactions(bookings, transactions) {
  const cancelTimeFilter = moment.utc().subtract(MAX_APP_PAYMENT_DURATION, 'minutes');
  const pendingTransactions = await getPendingTransactions(cancelTimeFilter);

  for (const transaction of pendingTransactions) {
    const bookingType = getBookingType(transaction);
    // TODO: optimize, get all bookings at once
    
    // Food bookings are handled in a special way
    if (bookingType != TYPE_FOOD) {
      const booking = await getBooking(bookingType, transaction.bookingid);
      bookings.push(booking);
    }
    transactions.push(transaction);
  }
}

async function cancelBookings(systemUser, bookings, userBookingIds, t) {
  for (const booking of bookings) {
    logger.info("Cancelling Booking " + JSON.stringify(booking.bookingid));
    await booking.update(
      {
        status: STATUS_ADMIN_CANCELLED,
        updatedBy: systemUser.username
      },
      { transaction: t }
    );
    addToUserBookingIdMap(userBookingIds, booking);
  }
}

async function cancelFoodTransaction(user, bookedByCard, transaction, t) {
  const booking = await getBooking(TYPE_FOOD, transaction.bookingid);
  const bookedFor = booking.bookedBy ? booking.cardno : null;

  const foodData = [];
  foodData.push({
    date: booking.date,
    mealType: transaction.category,
    bookedFor
  });

  await cancelFood(
    user, 
    bookedByCard, 
    foodData, 
    t, 
    true);
}

function addToUserBookingIdMap(userBookingIds, booking) {
  const bookingType = getBookingTypeFromBooking(booking);
  const cardno = booking.cardno;

  const bookingIdsByType = userBookingIds[cardno] || {};
  const bookingIds = bookingIdsByType[bookingType] || [];

  bookingIds.push(booking.bookingid);
  bookingIdsByType[bookingType] = bookingIds;
  userBookingIds[cardno] = bookingIdsByType;
}

async function getUnpaidPastBookingsAndTransactions(bookings, transactions) {
  const pastBookings = await getUnpaidPastBookings();

  const pastTransactions = await Transactions.findAll({
    where: { bookingid: pastBookings.map(i => i.bookingid) }
  });

  bookings.push(...pastBookings);
  transactions.push(...pastTransactions);
}

async function getUnpaidPastBookings() {
  const today = moment().utc().format('YYYY-MM-DD');

  const roomBookings = await RoomBooking.findAll({
    where: {
      status: STATUS_PAYMENT_PENDING,
      checkin: {[Sequelize.Op.lt]: today }
    }
  });
  
  const flatBookings = await FlatBooking.findAll({
    where: {
      status: STATUS_PAYMENT_PENDING,
      checkin: {[Sequelize.Op.lt]: today }
    }
  });

  const adhyayanBookings = await ShibirBookingDb.findAll({
    include: [
      {
        model: ShibirDb,
        required: true,
        where: {
          start_date: {[Sequelize.Op.lt]: today }
        }
      }
    ],
    where: {
      status: STATUS_PAYMENT_PENDING
    }
  });

  const travelBookings = await TravelDb.findAll({
    where: {
      status: STATUS_PROCEED_FOR_PAYMENT,
      date: {[Sequelize.Op.lt]: today }
    }
  });

  const utsavBookings = await UtsavBooking.findAll({
    include: [
      {
        model: UtsavDb,
        required: true,
        where: {
          start_date: {[Sequelize.Op.lt]: today }
        }
      }
    ],
    where: {
      status: STATUS_PAYMENT_PENDING
    }
  });

  return [
    ...roomBookings,
    ...flatBookings,
    ...adhyayanBookings,
    ...travelBookings,
    ...utsavBookings
  ];
}
