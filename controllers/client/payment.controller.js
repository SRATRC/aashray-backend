import {
  STATUS_PAYMENT_PENDING,
  STATUS_CASH_PENDING,
  RAZORPAY_CALLBACK,
  ROOM_STATUS_PENDING_CHECKIN,
  STATUS_CONFIRMED,
  TYPE_ROOM,
  TYPE_FLAT,
  STATUS_PAYMENT_CAPTURED,
  STATUS_PAYMENT_FAILED,
  STATUS_PAYMENT_AUTHORIZED,
  STATUS_PAYMENT_COMPLETED
} from '../../config/constants.js';
import { Transactions, RazorpayWebhook } from '../../models/associations.js';
import { sendUnifiedEmail } from '../helper.js';
import {
  generateOrderId,
  updateRazorpayTransactions
} from '../../helpers/transactions.helper.js';
import { validateWebhookSignature } from 'razorpay/dist/utils/razorpay-utils.js';
import { getBooking, getBookingType } from '../../helpers/booking.helper.js';
import { validateCard } from '../../helpers/card.helper.js';
import logger from '../../config/logger.js';
import database from '../../config/database.js';
import ApiError from '../../utils/ApiError.js';

export const verifyPayment = async (req, res) => {
  const razorpay_order_id = req.body.payload.payment.entity.order_id;
  const razorpay_payment_id = req.body.payload.payment.entity.id;
  const razorpay_status = req.body.payload.payment.entity.status;

  await RazorpayWebhook.create({
    order_id: razorpay_order_id,
    payment_id: razorpay_payment_id,
    status: razorpay_status,
    json: req.body
  });

  if (
    [STATUS_PAYMENT_CAPTURED, STATUS_PAYMENT_FAILED].includes(razorpay_status)
  ) {
    const transactions = await Transactions.findAll({
      where: {
        razorpay_order_id,
        status: [
          STATUS_PAYMENT_PENDING,
          STATUS_CASH_PENDING,
          STATUS_PAYMENT_FAILED
        ]
      }
    });

    if (transactions.length == 0) {
      logger.error(
        `No pending bookings found for the given order id: ${JSON.stringify(
          req.body
        )}`
      );
      return;
    }

    const bookedBy = await validateCard(transactions[0].cardno);
    const updatedBy = RAZORPAY_CALLBACK;

    const t = await database.transaction();
    req.transaction = t;

    const userBookingIdMap = {};
    for (const transaction of transactions) {
      const bookingType = getBookingType(transaction);

      const booking = await getBooking(bookingType, transaction.bookingid);

      const bookingStatus =
        bookingType == TYPE_ROOM || bookingType == TYPE_FLAT
          ? ROOM_STATUS_PENDING_CHECKIN
          : STATUS_CONFIRMED;

      

      switch (razorpay_status) {
        case STATUS_PAYMENT_AUTHORIZED:
          await transaction.update(
            {
              status: STATUS_PAYMENT_AUTHORIZED,
              updatedBy
            },
            { transaction: t }
          );
          break;
        case STATUS_PAYMENT_CAPTURED:
          logger.info(`TRANSACTION: ${transaction.id}, BOOKING: ${transaction.bookingid}, RAZORPAY STATUS: ${razorpay_status}`);
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
              updatedBy
            },
            { transaction: t }
          );
          break;
        case STATUS_PAYMENT_FAILED:
          logger.info(`TRANSACTION: ${transaction.id}, BOOKING: ${transaction.bookingid}, RAZORPAY STATUS: ${razorpay_status}`);
          logger.error(`Payment failed: ${JSON.stringify(req.body)}`);
          await transaction.update(
            {
              status: STATUS_PAYMENT_FAILED,
              updatedBy
            },
            { transaction: t }
          );
          break;
        default:
          logger.error(`Invalid payment status: ${JSON.stringify(req.body)}`);
          break;
      }

      setBookingIdMap(
        userBookingIdMap,
        bookingType,
        booking.cardno,
        transaction.bookingid
      );
    }

    await t.commit();

    logger.info(`userBookingIdMap: ${JSON.stringify(userBookingIdMap)}`);
    for (const cardno in userBookingIdMap) {
      const bookings = userBookingIdMap[cardno];
      await sendUnifiedEmail(cardno, bookings, bookedBy);
    }
  }

  res.status(200).json({ message: 'Payment successful.', status: 'ok' });
};

export const createOrderIdForPendingPayments = async (req, res) => {
  const { bookingids } = req.body;

  const t = await database.transaction();

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
