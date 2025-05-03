import {
  STATUS_PAYMENT_PENDING,
  STATUS_CASH_PENDING,
  RAZORPAY_CALLBACK,
  STATUS_PAYMENT_COMPLETED,
  ROOM_STATUS_PENDING_CHECKIN,
  STATUS_CONFIRMED,
  TYPE_ROOM
} from '../../config/constants.js';
import { Transactions } from '../../models/associations.js';
import { sendUnifiedEmail } from '../helper.js';
import database from '../../config/database.js';
import ApiError from '../../utils/ApiError.js';
import { validateWebhookSignature } from 'razorpay/dist/utils/razorpay-utils.js';
import { getBooking, getBookingType } from '../../helpers/booking.helper.js';
import { validateCard } from '../../helpers/card.helper.js';

export const verifyPayment = async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  const body = razorpay_order_id + '|' + razorpay_payment_id;

  const isValidSignature = process.env.NODE_ENV == 'prod' 
    ? validateWebhookSignature(
        body, 
        razorpay_signature, 
        process.env.RAZORPAY_KEY_SECRET
      )
    : true;

  if (!isValidSignature) {
    throw new ApiError(400, 'Payment verification failed. Please try again.');    
  }

  const transactions = await Transactions.findAll({
    where: {
      razorpay_order_id,
      status: [STATUS_PAYMENT_PENDING, STATUS_CASH_PENDING]
    }
  });

  if (transactions.length == 0) {
    throw new ApiError(404, 'No pending bookings found for the given order id.');
  }

  const bookedBy = await validateCard(transactions[0].cardno);
  const updatedBy = RAZORPAY_CALLBACK;

  const t = await database.transaction();
  req.transaction = t;
  
  const userBookingIdMap = {};
  for (const transaction of transactions) {
  
    const bookingType = getBookingType(transaction);

    const booking = await getBooking(bookingType, transaction.bookingid);
    
    const bookingStatus = bookingType == TYPE_ROOM
      ? ROOM_STATUS_PENDING_CHECKIN
      : STATUS_CONFIRMED;

    await booking.update(
      {
        status: bookingStatus,
        updatedBy
      },
      { transaction: t }
    );
  
    await transaction.update(
      {
        status: STATUS_PAYMENT_COMPLETED,
        razorpay_payment_id,
        updatedBy
      },
      { transaction: t }
    );

    setBookingIdMap(
      userBookingIdMap,
      bookingType,
      booking.cardno,
      transaction.bookingid
    );
  }

  await t.commit();

  for (const cardno in userBookingIdMap) {
    const bookings = userBookingIdMap[cardno];
    await sendUnifiedEmail(cardno, bookings, bookedBy);
  }

  res.status(200).json({ message: 'Payment successful.' });
}

export const createOrderIdForPendingPayments = async (req, res) => {
  const { bookingids } = req.body;

  const totalAmount = await Transactions.sum('amount', {
    where: {
      bookingid: bookingids,
      cardno: req.user.cardno,
      status: [STATUS_PAYMENT_PENDING, STATUS_CASH_PENDING]
    }
  });

  if (totalAmount > 0) {
    const order = await generateOrderId(totalAmount);
    await updateRazorpayTransactions(bookingids, order.id, t);
    await t.commit();
    
    return res.status(200).send({ message: 'payment successful', data: order });
  } else {
    throw new ApiError(404, 'nothing to pay for');
  }
};

/*
 * Input: 
 * Output:
 *    userBookingIdMap: { cardno: { type: [bookingIds] } } 
 */
export function setBookingIdMap(userBookingIdMap, type, cardno, bookingId) {
  const bookingIdsByType = userBookingIdMap[cardno] || {};
  const bookingIds = bookingIdsByType[type] || [];

  bookingIds.push(bookingId);

  bookingIdsByType[type] = bookingIds;
  userBookingIdMap[cardno] = bookingIdsByType;
}
