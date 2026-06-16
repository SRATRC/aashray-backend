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
  TYPE_FOOD,
  TYPE_TRAVEL,
  TYPE_UTSAV
} from '../../config/constants.js';
import { Transactions, RazorpayWebhook } from '../../models/associations.js';
import { sendUnifiedEmail } from '../helper.js';
import {
  generateOrderId,
  updateRazorpayTransactions
} from '../../helpers/transactions.helper.js';
import { getBooking, getBookingType } from '../../helpers/booking.helper.js';
import { validateCard } from '../../helpers/card.helper.js';
import { attachUserContext } from '../../middleware/Logger.js';
import database from '../../config/database.js';
import ApiError from '../../utils/ApiError.js';
import { sendRoomStatusChangeWhatsApp, sendTravelStatusChangeWhatsApp, sendUtsavStatusChangeWhatsApp, sendFlatStatusChangeWhatsApp } from '../../helpers/whatsapp.helper.js';

export const verifyPayment = async (req, res) => {
  const razorpay_order_id = req.body.payload.payment.entity.order_id;
  const razorpay_payment_id = req.body.payload.payment.entity.id;
  const razorpay_status = req.body.payload.payment.entity.status;

  req.log.info('razorpay_webhook_received', {
    orderId: razorpay_order_id,
    paymentId: razorpay_payment_id,
    status: razorpay_status
  });

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
    req.log.error('razorpay_invalid_status', {
      orderId: razorpay_order_id,
      status: razorpay_status
    });
    message = `Invalid status '${razorpay_status}' for order id: ${razorpay_order_id}`;
    return res.status(200).json({ message, status: 'ok' });
  }

  if (razorpay_status == STATUS_PAYMENT_FAILED) {
    req.log.error('razorpay_payment_failed', {
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id
    });
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

          // for late-checkout-fee, while a transaction is created,
          // a corresponding booking is not created.
          if (booking) {
            bookingStatus =
              bookingType == TYPE_ROOM || bookingType == TYPE_FLAT
                ? ROOM_STATUS_PENDING_CHECKIN
                : STATUS_CONFIRMED;

            const previousStatus = booking.status;
            const updateFields = {
              updatedBy
            };
            if (bookingType !== TYPE_FOOD) {
              updateFields.status = bookingStatus;
            }
            await booking.update(updateFields, { transaction: t });

            if (bookingType === TYPE_ROOM) {
              if (!userBookingIdMap.roomBookingStatusChanges) {
                userBookingIdMap.roomBookingStatusChanges = [];
              }
              userBookingIdMap.roomBookingStatusChanges.push({ booking, previousStatus });
            } else if (bookingType === TYPE_FLAT) {
              if (!userBookingIdMap.flatBookingStatusChanges) {
                userBookingIdMap.flatBookingStatusChanges = [];
              }
              userBookingIdMap.flatBookingStatusChanges.push({ booking, previousStatus });
            } else if (bookingType === TYPE_TRAVEL) {
              if (!userBookingIdMap.travelBookingStatusChanges) {
                userBookingIdMap.travelBookingStatusChanges = [];
              }
              userBookingIdMap.travelBookingStatusChanges.push({ booking, previousStatus, razorpay_payment_id });
            } else if (bookingType === TYPE_UTSAV) {
              if (!userBookingIdMap.utsavBookingStatusChanges) {
                userBookingIdMap.utsavBookingStatusChanges = [];
              }
              userBookingIdMap.utsavBookingStatusChanges.push({ booking, previousStatus, razorpay_payment_id });
            }

            setBookingIdMap(
              userBookingIdMap,
              bookingType,
              booking.cardno,
              transaction.bookingid
            );
          }
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

      req.log.info('razorpay_transaction_updated', {
        orderId: razorpay_order_id,
        razorpayStatus: razorpay_status,
        transactionId: transaction.id,
        transactionStatus: transactionStatus,
        bookingId: transaction.bookingid,
        bookingStatus: bookingStatus
      });
    }

    await t.commit();
    req.log.info('razorpay_webhook_committed', {
      orderId: razorpay_order_id,
      transactionCount: transactions.length
    });

    // Trigger Room status change WhatsApp messages
    if (userBookingIdMap.roomBookingStatusChanges) {
      for (const { booking, previousStatus } of userBookingIdMap.roomBookingStatusChanges) {
        try {
          await sendRoomStatusChangeWhatsApp(booking, previousStatus, { updatedBy: RAZORPAY_CALLBACK });
        } catch (waErr) {
          req.log.error("Error sending room status change WhatsApp in verifyPayment:", waErr);
        }
      }
      delete userBookingIdMap.roomBookingStatusChanges;
    }

    // Trigger Flat status change WhatsApp messages
    if (userBookingIdMap.flatBookingStatusChanges) {
      for (const { booking, previousStatus } of userBookingIdMap.flatBookingStatusChanges) {
        try {
          await sendFlatStatusChangeWhatsApp(booking, previousStatus, { updatedBy: RAZORPAY_CALLBACK });
        } catch (waErr) {
          req.log.error("Error sending flat status change WhatsApp in verifyPayment:", waErr);
        }
      }
      delete userBookingIdMap.flatBookingStatusChanges;
    }

    // Trigger Travel status change WhatsApp messages
    if (userBookingIdMap.travelBookingStatusChanges) {
      for (const { booking, previousStatus, razorpay_payment_id } of userBookingIdMap.travelBookingStatusChanges) {
        try {
          await sendTravelStatusChangeWhatsApp(booking, previousStatus, {
            updatedBy: RAZORPAY_CALLBACK,
            razorpay_payment_id
          });
        } catch (waErr) {
          req.log.error("Error sending travel status change WhatsApp in verifyPayment:", waErr);
        }
      }
      delete userBookingIdMap.travelBookingStatusChanges;
    }

    // Trigger Utsav status change WhatsApp messages
    if (userBookingIdMap.utsavBookingStatusChanges) {
      for (const { booking, previousStatus, razorpay_payment_id } of userBookingIdMap.utsavBookingStatusChanges) {
        try {
          await sendUtsavStatusChangeWhatsApp(booking, previousStatus, {
            updatedBy: RAZORPAY_CALLBACK,
            paymentId: razorpay_payment_id
          });
        } catch (waErr) {
          req.log.error("Error sending utsav status change WhatsApp in verifyPayment:", waErr);
        }
      }
      delete userBookingIdMap.utsavBookingStatusChanges;
    }

    for (const cardno in userBookingIdMap) {
      const bookings = userBookingIdMap[cardno];
      await sendUnifiedEmail(cardno, bookings, bookedBy, STATUS_CONFIRMED, 'unifiedBookingEmail', false);
    }
    message = `Payment ${razorpay_status} for order id: ${razorpay_order_id}`;
    req.log.info('razorpay_webhook_processed', { orderId: razorpay_order_id, status: razorpay_status });
  } else {
    await t.rollback();
    req.log.warn('razorpay_no_pending_bookings', { orderId: razorpay_order_id });
    message = `No pending bookings found for order id: ${razorpay_order_id}`;
  }

  res.status(200).json({ message, status: 'ok' });
};

export const createOrderIdForPendingPayments = async (req, res) => {
  attachUserContext(req);
  const { bookingids } = req.body;
  req.log.info('create_order_pending_payments_start', {
    cardno: req.user.cardno,
    bookingIds: bookingids
  });

  const t = await database.transaction();
  req.transaction = t;

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
    req.log.warn('create_order_disallowed_food_category', { cardno: req.user.cardno, bookingIds: bookingids });
    throw new ApiError(
      400,
      'Payment is not allowed for breakfast, lunch, or dinner bookings'
    );
  }

  const totalAmount = transactions.reduce(
    (sum, transaction) => sum + transaction.amount,
    0
  );

  req.log.info('create_order_total_amount', { cardno: req.user.cardno, totalAmount, transactionCount: transactions.length });

  if (totalAmount > 0) {
    const order = await generateOrderId(totalAmount);
    req.log.info('create_order_generated', { cardno: req.user.cardno, orderId: order.id, amount: totalAmount });
    await updateRazorpayTransactions(bookingids, [], order.id, t);
    await t.commit();
    req.log.info('create_order_success', { cardno: req.user.cardno, orderId: order.id });

    return res.status(200).send({ message: 'payment successful', data: order });
  } else {
    req.log.warn('create_order_nothing_to_pay', { cardno: req.user.cardno, bookingIds: bookingids });
    throw new ApiError(404, 'nothing to pay for');
  }
};

export const createOrderIdForPendingPaymentsV2 = async (req, res) => {
  attachUserContext(req);
  const { data } = req.body;
  req.log.info('create_order_pending_payments_v2_start', {
    cardno: req.user.cardno,
    bookingCount: data?.length
  });

  const t = await database.transaction();
  req.transaction = t;

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

  req.log.info('create_order_v2_transactions_found', {
    cardno: req.user.cardno,
    transactionCount: transactions.length
  });

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

  req.log.info('create_order_v2_total_amount', {
    cardno: req.user.cardno,
    totalAmount,
    validTransactionCount: validTransactionIds.length
  });

  if (totalAmount > 0) {
    const order = await generateOrderId(totalAmount);
    req.log.info('create_order_v2_generated', { cardno: req.user.cardno, orderId: order.id, amount: totalAmount });

    await updateRazorpayTransactions([], validTransactionIds, order.id, t);
    await t.commit();
    req.log.info('create_order_v2_success', { cardno: req.user.cardno, orderId: order.id });

    return res.status(200).send({ message: 'payment successful', data: order });
  } else {
    req.log.warn('create_order_v2_nothing_to_pay', { cardno: req.user.cardno });
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
