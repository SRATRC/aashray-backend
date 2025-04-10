import './config/environment.js';
import moment from 'moment';
import { adminCancelTransaction, getPendingTransactions } from './helpers/transactions.helper.js';
import database from './config/database.js';
import cron from 'node-cron';
import logger from './config/logger.js';
import { 
  ROOM_STATUS_PENDING_CHECKIN,
  STATUS_ADMIN_CANCELLED,
  STATUS_PAYMENT_PENDING,
  TYPE_ADHYAYAN,
  TYPE_FOOD,
  TYPE_GUEST_ADHYAYAN, 
  TYPE_GUEST_BREAKFAST, 
  TYPE_GUEST_DINNER, 
  TYPE_GUEST_ROOM, 
  TYPE_ROOM, 
  TYPE_TRAVEL 
} from './config/constants.js';
import RoomBooking from './models/room_booking.model.js';
import ShibirBookingDb from './models/shibir_booking_db.model.js';
import FoodDb from './models/food_db.model.js';
import TravelDb from './models/travel_db.model.js';
import AdminUsers from './models/admin_users.model.js';
import { cancelFood } from './helpers/foodBooking.helper.js';

// Schedule the cron job to run every 10 minutes
const job = cron.schedule('*/10 * * * *', async () => {
  logger.info('Cron job starting...');

  try {
    const userBookingIds = new Map();
    await database.authenticate();

    // Cancel bookings created before 10 mins, but not paid
    const cancelTimeFilter = moment.utc().subtract(10, 'minutes');

    const systemUser = AdminUsers.findOne({
      where: { username: "admin" } 
    })

    console.log("10 mins ago: " + cancelTimeFilter.format('MMMM Do YYYY, h:mm:ss a'));
    const transactions = await getPendingTransactions(cancelTimeFilter);

    for (const transaction of transactions) {
      await cancelTransaction(userBookingIds, systemUser, transaction);
    }

  } catch (error) {
    logger.error('Cron job error:', error);
  }

  logger.info('Cron job finishing...');
});

async function cancelTransaction(userBookingIds, user, transaction) {
  logger.info(`Cancelling transaction: ${transaction.id}`); 
  

  try {
    var booking = null;

    switch (transaction.category) {
      case TYPE_ROOM:
      case TYPE_GUEST_ROOM:
        booking = await RoomBooking.findOne({
          where: { 
            bookingid: transaction.bookingid,
            status: [ROOM_STATUS_PENDING_CHECKIN]
          }
        });
        await cancelBooking(user, booking, transaction);
        addToUserBookingIdMap(userBookingIds, transaction.cardno, transaction.bookingid, TYPE_ROOM);
        break;

      case TYPE_ADHYAYAN:
      case TYPE_GUEST_ADHYAYAN:
        booking = await ShibirBookingDb.findOne({
          where: { 
            bookingid: transaction.bookingid,
            status: [STATUS_PAYMENT_PENDING]
          }
        });
        await cancelBooking(user, booking, transaction);
        addToUserBookingIdMap(userBookingIds, transaction.cardno, transaction.bookingid, TYPE_ADHYAYAN);
        break;

      case TYPE_TRAVEL:
        booking = await TravelDb.findOne({
          where: { 
            bookingid: transaction.bookingid,
            status: [STATUS_PAYMENT_PENDING]
          }
        });
        await cancelBooking(user, booking, transaction);
        addToUserBookingIdMap(userBookingIds, transaction.cardno, transaction.bookingid, TYPE_TRAVEL);
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

async function cancelBooking(user, booking, transaction) {
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
  const bookingIds = bookingTypeIds[bookingType] || [];

  bookingIds.push(bookingId);
  bookingTypeIds[bookingType] = bookingIds;
  userBookingIds[cardno] = bookingTypeIds;
}

job.start();
