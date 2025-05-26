import './config/environment.js';
import moment from 'moment';
import { adminCancelTransaction, getPendingTransactions } from './helpers/transactions.helper.js';
import database from './config/database.js';
import cron from 'node-cron';
import logger from './config/logger.js';
import { 
  ROOM_STATUS_PENDING_CHECKIN,
  STATUS_ADMIN_CANCELLED,
  STATUS_CASH_PENDING,
  STATUS_PAYMENT_PENDING,
  STATUS_PROCEED_FOR_PAYMENT,
  TYPE_ADHYAYAN,
  TYPE_FLAT,
  TYPE_FOOD,
  TYPE_GUEST_ADHYAYAN, 
  TYPE_GUEST_BREAKFAST, 
  TYPE_GUEST_DINNER, 
  TYPE_GUEST_ROOM, 
  TYPE_GUEST_UTSAV, 
  TYPE_ROOM, 
  TYPE_TRAVEL, 
  TYPE_UTSAV
} from './config/constants.js';
import RoomBooking from './models/room_booking.model.js';
import ShibirBookingDb from './models/shibir_booking_db.model.js';
import FoodDb from './models/food_db.model.js';
import TravelDb from './models/travel_db.model.js';
import AdminUsers from './models/admin_users.model.js';
import { cancelFood } from './helpers/foodBooking.helper.js';
import UtsavBooking from './models/utsav_boking.model.js';
import FlatBooking from './models/flat_booking.model.js';
import { Sequelize } from 'sequelize';
import Transactions from './models/transactions.model.js';
import ShibirDb from './models/shibir_db.model.js';
import { sendUnifiedEmail } from './controllers/helper.js';
import { sendCancellationEmail } from './helpers/mailer.helper.js';
import { getBooking, getBookingType } from './helpers/booking.helper.js';

const MAX_APP_PAYMENT_DURATION = 12*60; // 12 hrs

// Schedule the cron job to run every 10 minutes
const job = cron.schedule('*/1 * * * *', async () => {
  logger.info('Cron job started');

  await database.authenticate();
  const t = await database.transaction();

  const systemUser = AdminUsers.findOne({
    where: { username: "admin" } 
  });

  try {
    const userBookingIds = {};

    const bookings = new Set();
    await getUnpaidOnlineBookings(bookings);
    await getUnpaidPastBookings(bookings);

    const bookingIds = bookings.map((booking) => {
      booking.hasOwnProperty('bookingid')
      ? booking.bookingid
      : booking.id; // only for food bookings
    });

    logger.info('Bookings to cancel: ' + JSON.stringify(bookings));
    logger.info('Bookings to cancel: ' + JSON.stringify(bookingIds));

    for (const booking in bookings) {
      await booking.update(
        {
          status: STATUS_ADMIN_CANCELLED,
          updatedBy: systemUser.username
        },
        { transaction: t }
      );
    }

    const transactions = await Transactions.findAll({
      where: { bookingid: bookingIds }
    });

    for (const transaction in transactions) {
      await adminCancelTransaction(systemUser, transaction, t);
    }

    await t.commit();

    for (const cardno in userBookingIds) {
      // if (cardno != req.user.cardno) {
        const bookings = userBookingIds[cardno];
        //Sending email to other mumkshu & Guest
        await sendCancellationEmail(cardno, bookings, null);
      // }
    }

  } catch (error) {
    logger.error('Cron job error:', error);
    await t.rollback();
  }

  logger.info('Cron job finished.');
});

job.stop();
job.start();



async function getUnpaidOnlineBookings(bookings) {
  const cancelTimeFilter = moment.utc().subtract(MAX_APP_PAYMENT_DURATION, 'minutes');
  const transactions = await getPendingTransactions(cancelTimeFilter);

  for (const transaction of transactions) {
    const bookingType = getBookingType(transaction);
    const booking = await getBooking(bookingType, transaction.bookingid);

    bookings.add(booking);
    // addToUserBookingIdMap(userBookingIds, transaction.cardno, transaction.bookingid, bookingType);
    // if (booking.cardno != transaction.cardno) {
    //   addToUserBookingIdMap(userBookingIds, booking.cardno, transaction.bookingid, bookingType);
    // }
  }
}

async function cancelTransaction(userBookingIds, user, transaction) {
  logger.info(`Cancelling transaction: ${transaction.id}`); 
  

  try {
    var booking = null;

    switch (transaction.category) {
      case TYPE_ROOM:
      case TYPE_GUEST_ROOM:
        booking = await RoomBooking.findOne({
          where: { 
            bookingid: transaction.bookingid
          }
        });
        await cancelBooking(user, booking, transaction);
        addToUserBookingIdMap(userBookingIds, transaction.cardno, transaction.bookingid, TYPE_ROOM);
        break;

      case TYPE_FLAT:
        booking = await FlatBooking.findOne({
          where: { 
            bookingid: transaction.bookingid
          }
        });
        await cancelBooking(user, booking, transaction);
        addToUserBookingIdMap(userBookingIds, transaction.cardno, transaction.bookingid, TYPE_FLAT);
        break;

      case TYPE_ADHYAYAN:
      case TYPE_GUEST_ADHYAYAN:
        booking = await ShibirBookingDb.findOne({
          where: { 
            bookingid: transaction.bookingid
          }
        });
        await cancelBooking(user, booking, transaction);
        addToUserBookingIdMap(userBookingIds, transaction.cardno, transaction.bookingid, TYPE_ADHYAYAN);
        break;

      case TYPE_TRAVEL:
        booking = await TravelDb.findOne({
          where: { 
            bookingid: transaction.bookingid
          }
        });
        await cancelBooking(user, booking, transaction);
        addToUserBookingIdMap(userBookingIds, transaction.cardno, transaction.bookingid, TYPE_TRAVEL);
        break;

      case TYPE_UTSAV:
      case TYPE_GUEST_UTSAV:
        booking = await UtsavBooking.findOne({
          where: { 
            bookingid: transaction.bookingid
          }
        });
        await cancelBooking(user, booking, transaction);
        addToUserBookingIdMap(userBookingIds, transaction.cardno, transaction.bookingid, TYPE_UTSAV);
        break;
      
      case TYPE_GUEST_BREAKFAST:
      case TYPE_GUEST_LUNCH:
      case TYPE_GUEST_DINNER:
        booking = await FoodDb.findOne({
          where: { 
            id: transaction.bookingid
          }
        });
        await cancelFoodBooking(user, booking, transaction);
        addToUserBookingIdMap(userBookingIds, transaction.cardno, transaction.id, TYPE_FOOD);
        break;

      default:
        logger.error(`No relevant booking found for transaction: ${transaction.id}`);
    }

  } catch (error) {
    logger.error(`Error cancelling transaction: ${transaction.id}`, error); 
  }
}

async function cancelBooking(user, booking) {
  const t = await database.transaction();

  await booking.update(
    {
      status: STATUS_ADMIN_CANCELLED,
      updatedBy: user.username
    },
    { transaction: t }
  );

  await adminCancelTransaction(user, transaction, t);

  await t.commit();
}

async function cancelFoodBooking(user, booking, transaction) {
    const t = await database.transaction();
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

    await adminCancelTransaction(user, transaction, t);
    await t.commit();
}

function addToUserBookingIdMap(userBookingIds, cardno, bookingId, bookingType) {
  const bookingTypeIds = userBookingIds[cardno] || {};
  const bookingIds = bookingTypeIds[bookingType] || new Set();

  bookingIds.add(bookingId);
  bookingTypeIds[bookingType] = bookingIds;
  userBookingIds[cardno] = bookingTypeIds;
}

async function getUnpaidPastBookings(bookings) {
  const today = moment().utc().format('YYYY-MM-DD');

  const roomBookings = await RoomBooking.findAll({
    where: {
      status: STATUS_PAYMENT_PENDING,
      checkin: {[Sequelize.Op.lt]: today }
    }
  });
  roomBookings.forEach(bookings.add, bookings);
  
  const flatBookings = await FlatBooking.findAll({
    where: {
      status: STATUS_PAYMENT_PENDING,
      checkin: {[Sequelize.Op.lt]: today }
    }
  });
  flatBookings.forEach(bookings.add, bookings);

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
  adhyayanBookings.forEach(bookings.add, bookings);

  const travelBookings = await TravelDb.findAll({
    where: {
      status: STATUS_PROCEED_FOR_PAYMENT,
      date: {[Sequelize.Op.lt]: today }
    }
  });
  travelBookings.forEach(bookings.add, bookings);

  const utsavBookings = await UtsavBooking.findAll({
    where: {
      status: STATUS_PAYMENT_PENDING,
      date: {[Sequelize.Op.lt]: today }
    }
  });
  utsavBookings.forEach(bookings.add, bookings);
}
