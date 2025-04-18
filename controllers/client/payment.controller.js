import {
  STATUS_AVAILABLE,
  TYPE_ROOM,
  STATUS_CONFIRMED,
  STATUS_WAITING,
  TYPE_TRAVEL,
  TYPE_FOOD,
  TYPE_ADHYAYAN,
  ERR_INVALID_BOOKING_TYPE,
  MSG_BOOKING_SUCCESSFUL,
  ERR_TRAVEL_ALREADY_BOOKED,
  STATUS_OPEN,
  TYPE_UTSAV,
  STATUS_PAYMENT_PENDING,
  STATUS_CASH_PENDING,
  STATUS_PAYMENT_COMPLETED
} from '../../config/constants.js';
import {
  bookRoomDuringUtsavForMumukshus,
  bookRoomForMumukshus,
  findRoom,
  roomCharge
} from '../../helpers/roomBooking.helper.js';
import {
  bookAdhyayanForMumukshus,
  checkAdhyayanAlreadyBooked,
  validateAdhyayans
} from '../../helpers/adhyayanBooking.helper.js';
import {
  bookFoodForMumukshus,
  bookFoodForMumukshusDuringUtsav,
  createGroupFoodRequest,
  validateFood
} from '../../helpers/foodBooking.helper.js';
import {
  bookUtsavForMumukshus,
  checkUtsavAlreadyBooked,
  validateUtsavs
} from '../../helpers/utsavBooking.helper.js';
import { completeRazorpayTransaction, confirmTransaction, generateOrderId } from '../../helpers/transactions.helper.js';
import { Transactions, TravelDb } from '../../models/associations.js';
import { bookTravelForMumukshus } from '../../helpers/travelBooking.helper.js';
import { calculateNights, validateDate, sendUnifiedEmail, setBookingIdMap } from '../helper.js';
import database from '../../config/database.js';
import ApiError from '../../utils/ApiError.js';
import Sequelize from 'sequelize';
import { validateWebhookSignature } from 'razorpay/dist/utils/razorpay-utils.js';
import { confirmBooking, getBooking } from '../../helpers/booking.helper.js';

export const completePayment = async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  const body = razorpay_order_id + '|' + razorpay_payment_id;

  const isValidSignature = validateWebhookSignature(
    body, 
    razorpay_signature, 
    process.env.RAZORPAY_KEY_SECRET
  );

  if (!isValidSignature) {
    throw new ApiError(400, 'Payment verification failed. Please try again.');    
  }

  const transactions = Transactions.findAll({
    where: {
      razorpay_order_id,
      status: [STATUS_PAYMENT_PENDING, STATUS_CASH_PENDING]
    }
  });

  if (transactions.length == 0) {
    throw new ApiError(404, 'No pending bookings found for the given order id.');
  }

  const t = await database.transaction();
  req.transaction = t;
  
  const updatedBy = 'RAZORPAY_CALLBACK';
  
  for (const transaction of transactions) {
  
    const booking = await getBooking(transaction);
    await confirmBooking(booking, updatedBy, t);
  
    await completeRazorpayTransaction(
      transaction, 
      razorpay_payment_id, 
      updatedBy, 
      t
    );
  }

  await t.commit();
  res.status(200).json({ message: 'Payment successful.' });


  // for (const cardno in userBookingIdMap) {
  //   const bookings = userBookingIdMap[cardno];
  //   sendUnifiedEmail(cardno, bookings, req.user);
  // }
}
