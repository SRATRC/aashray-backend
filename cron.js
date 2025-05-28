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

const MAX_APP_PAYMENT_DURATION = 12*60; // 12 hrs

// Schedule the cron job to run every 10 minutes
const job = cron.schedule('*/1 * * * *', async () => {
  logger.info('Cron job started');

  await database.authenticate();
  const t = await database.transaction();

  const systemUser = AdminUsers.findOne({
    where: { username: "admin" } 
  });

  const userBookingIds = {};
  try {
    await cancelUnpaidOnlineBookings(systemUser, userBookingIds, t);
    await cancelUnpaidPastBookings(systemUser, userBookingIds, t);

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

async function cancelUnpaidOnlineBookings(systemUser, userBookingIds, t) {
  const cancelTimeFilter = moment.utc().subtract(MAX_APP_PAYMENT_DURATION, 'minutes');
  const transactions = await getPendingTransactions(cancelTimeFilter);

  for (const transaction of transactions) {
    const bookingType = getBookingType(transaction);
    const booking = await getBooking(bookingType, transaction.bookingid);

    if (bookingType == TYPE_FOOD) {
      await cancelFoodBooking(systemUser, booking, transaction, t)
    } else {
      await cancelBooking(systemUser, userBookingIds, booking, t);
      await adminCancelTransaction(systemUser, transaction, t);
    }
  }
}

async function cancelBooking(user, userBookingIds, booking, t) {
  await booking.update(
    {
      status: STATUS_ADMIN_CANCELLED,
      updatedBy: user.username
    },
    { transaction: t }
  );

  addToUserBookingIdMap(userBookingIds, booking);
}

async function cancelFoodBooking(user, booking, transaction, t) {
  const bookedBy = booking.bookedBy || booking.cardno;
  const bookedFor = booking.bookedBy ? booking.cardno : null;

  const foodData = [];
  foodData.push({
    date: booking.date,
    mealType: transaction.category,
    bookedFor
  });

  await cancelFood(
    user, 
    bookedBy, 
    foodData, 
    t, 
    true);
}

function addToUserBookingIdMap(userBookingIds, booking) {
  const bookingType = getBookingTypeFromBooking(booking);
  const cardnos = [booking.cardno];
  // if (booking.bookedBy) {
  //   cardnos.push(booking.bookedBy);
  // }

  cardnos.forEach((cardno) => {
    const bookingTypeIds = userBookingIds[cardno] || {};
    const bookingIds = bookingTypeIds[bookingType] || [];
  
    bookingIds.push(booking.bookingid);
    bookingTypeIds[bookingType] = bookingIds;
    userBookingIds[cardno] = bookingTypeIds;
  });
}

async function cancelUnpaidPastBookings(systemUser, userBookingIds, t) {
  const bookings = await getUnpaidPastBookings();
  for (const booking of bookings) {
    await cancelBooking(systemUser, userBookingIds, booking, t);
  }

  const transactions = await Transactions.findAll({
    where: { bookingid: bookings.map(i => i.bookingid) }
  });
  for (const transaction of transactions) {
    await adminCancelTransaction(systemUser, transaction, t);
  } 
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
