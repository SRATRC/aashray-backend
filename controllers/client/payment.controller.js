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
  STATUS_PAYMENT_COMPLETED,
  TYPE_FOOD
} from '../../config/constants.js';
import { Transactions, RazorpayWebhook } from '../../models/associations.js';
import { sendUnifiedEmail } from '../helper.js';
import {
  generateOrderId,
  updateRazorpayTransactions
} from '../../helpers/transactions.helper.js';
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

  var message;

  if (
    ![
      STATUS_PAYMENT_CAPTURED,
      STATUS_PAYMENT_FAILED,
      STATUS_PAYMENT_AUTHORIZED
    ].includes(razorpay_status)
  ) {
    logger.error(
      `Razorpay: Invalid status '${razorpay_status}' for order id: ${razorpay_order_id}`
    );
    message = `Invalid status '${razorpay_status}' for order id: ${razorpay_order_id}`;
    return res.status(200).json({ message, status: 'ok' });
  }

  if (razorpay_status == STATUS_PAYMENT_FAILED) {
    logger.error(`Razorpay: Payment failed for order id: ${razorpay_order_id}`);
  }

  const t = await database.transaction();
  req.transaction = t;

  const transactions = await Transactions.findAll({
    where: {
      razorpay_order_id,
      status: [
        STATUS_PAYMENT_PENDING,
        STATUS_CASH_PENDING,
        STATUS_PAYMENT_FAILED,
        STATUS_PAYMENT_AUTHORIZED
      ]
    },
    lock: { update: true },
    transaction: t
  });

  if (transactions && transactions.length > 0) {
    const bookedBy = await validateCard(transactions[0].cardno);
    const updatedBy = RAZORPAY_CALLBACK;

    const userBookingIdMap = {};

    for (const transaction of transactions) {
      var transactionStatus;
      var bookingStatus;

      switch (razorpay_status) {
        case STATUS_PAYMENT_AUTHORIZED:
          transactionStatus = STATUS_PAYMENT_AUTHORIZED;
          break;

        case STATUS_PAYMENT_CAPTURED:
          const bookingType = getBookingType(transaction);
          const booking = await getBooking(bookingType, transaction.bookingid);

          transactionStatus = STATUS_PAYMENT_COMPLETED;
          bookingStatus =
            bookingType == TYPE_ROOM || bookingType == TYPE_FLAT
              ? ROOM_STATUS_PENDING_CHECKIN
              : STATUS_CONFIRMED;

          await booking.update(
            {
              status: bookingStatus,
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
          break;

        case STATUS_PAYMENT_FAILED:
          transactionStatus = STATUS_PAYMENT_FAILED;
          break;

        default:
          // will never end up here
          break;
      }

      await transaction.update(
        {
          status: transactionStatus,
          updatedBy
        },
        { transaction: t }
      );

      logger.info(
        `Razorpay: order id: ${razorpay_order_id}, razorpay status: ${razorpay_status}, transaction: ${transaction.id}, transaction status: ${transactionStatus}, booking: ${transaction.bookingid}, booking status: ${bookingStatus}`
      );
    }

    await t.commit();

    for (const cardno in userBookingIdMap) {
      const bookings = userBookingIdMap[cardno];
      await sendUnifiedEmail(cardno, bookings, bookedBy);
    }
    message = `Payment ${razorpay_status} for order id: ${razorpay_order_id}`;
  } else {
    await t.rollback();
    message = `No pending bookings found for order id: ${razorpay_order_id}`;
  }

  res.status(200).json({ message, status: 'ok' });
};

export const createOrderIdForPendingPayments = async (req, res) => {
  const { bookingids } = req.body;

  const t = await database.transaction();

  const transactions = await Transactions.findAll({
    where: {
      bookingid: bookingids,
      cardno: req.user.cardno,
      status: [
        STATUS_PAYMENT_PENDING,
        STATUS_CASH_PENDING,
        STATUS_PAYMENT_FAILED
      ]
    }
  });

  const hasDisallowedCategory = transactions.some((transaction) => {
    const bookingType = getBookingType(transaction);
    return TYPE_FOOD == bookingType;
  });

  if (hasDisallowedCategory) {
    throw new ApiError(
      400,
      'Payment is not allowed for breakfast, lunch, or dinner bookings'
    );
  }

  const totalAmount = transactions.reduce(
    (sum, transaction) => sum + transaction.amount,
    0
  );

  if (totalAmount > 0) {
    const order = await generateOrderId(totalAmount);
    await updateRazorpayTransactions(bookingids, [], order.id, t);
    await t.commit();

    return res.status(200).send({ message: 'payment successful', data: order });
  } else {
    throw new ApiError(404, 'nothing to pay for');
  }
};

export const createOrderIdForPendingPaymentsV2 = async (req, res) => {
  const { data } = req.body;
  const t = await database.transaction();

  const bookingCategoryMap = data.reduce((map, { bookingid, category }) => {
    (map[bookingid] ??= []).push(category);
    return map;
  }, {});

  const transactions = await Transactions.findAll({
    where: {
      bookingid: Object.keys(bookingCategoryMap),
      cardno: req.user.cardno,
      status: [
        STATUS_PAYMENT_PENDING,
        STATUS_CASH_PENDING,
        STATUS_PAYMENT_FAILED
      ]
    }
  });

  logger.info(`Transactions found: ${JSON.stringify(transactions)}`);

  const { totalAmount, validTransactionIds } = transactions.reduce(
    (acc, transaction) => {
      const categories = bookingCategoryMap[transaction.bookingid];
      const bookingType = getBookingType(transaction);
      if (
        bookingType != TYPE_FOOD ||
        categories.includes(transaction.category)
      ) {
        acc.totalAmount += transaction.amount;
        acc.validTransactionIds.push(transaction.id);
      }
      return acc;
    },
    { totalAmount: 0, validTransactionIds: [] }
  );

  if (totalAmount > 0) {
    const order = await generateOrderId(totalAmount);

    await updateRazorpayTransactions([], validTransactionIds, order.id, t);
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
