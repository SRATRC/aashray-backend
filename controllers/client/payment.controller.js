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
  TYPE_UTSAV,
  STATUS_CANCELLED,
  STATUS_ADMIN_CANCELLED,
  STATUS_CASH_COMPLETED
} from '../../config/constants.js';
import { Transactions, RazorpayWebhook } from '../../models/associations.js';
import { sendUnifiedEmail } from '../helper.js';
import { resolveOrderForTransactions } from '../../helpers/transactions.helper.js';
import { getBooking, getBookingType } from '../../helpers/booking.helper.js';
import { validateCard } from '../../helpers/card.helper.js';
import { attachUserContext } from '../../middleware/Logger.js';
import database from '../../config/database.js';
import ApiError from '../../utils/ApiError.js';
import { sendRoomStatusChangeWhatsApp, sendTravelStatusChangeWhatsApp, sendUtsavStatusChangeWhatsApp, sendFlatStatusChangeWhatsApp } from '../../helpers/whatsapp.helper.js';

/**
 * Splits unsettled transactions into the ones a payment still covers and the
 * ones it does not.
 *
 * A booking flow that builds its order from a subtotal leaves transactions
 * stamped with an order id worth less than they cost, and settling all of them
 * hands out bookings nobody paid for. Ordering by id keeps the split
 * deterministic and settles the earliest-created transactions first.
 *
 * `remainingInPaise` is what the payment has left after the transactions it
 * already settled. Razorpay delivers the same payment more than once - this
 * order saw `captured` and then `authorized` a second apart - and each delivery
 * only reads the still-unsettled rows, so a budget measured against the payment
 * total would hand the leftover rows a second, free pass.
 *
 * Amounts are in paise, the unit Razorpay reports, so no rounding is introduced.
 *
 * @param {Array} transactions - unsettled transactions sharing one order id
 * @param {number} remainingInPaise - payment amount minus what it already settled
 */
export function splitTransactionsByPayment(transactions, remainingInPaise) {
  const ordered = [...transactions].sort((a, b) => a.id - b.id);
  const owedInPaise = ordered.reduce((sum, txn) => sum + txn.amount * 100, 0);

  // No usable amount in the payload leaves nothing to reconcile against.
  // Fall back to the old behaviour rather than stall every confirmation.
  if (!Number.isFinite(remainingInPaise)) {
    return { covered: ordered, uncovered: [], owedInPaise };
  }

  if (owedInPaise <= remainingInPaise) {
    return { covered: ordered, uncovered: [], owedInPaise };
  }

  const covered = [];
  const uncovered = [];
  let runningInPaise = 0;

  for (const txn of ordered) {
    if (runningInPaise + txn.amount * 100 <= remainingInPaise) {
      runningInPaise += txn.amount * 100;
      covered.push(txn);
    } else {
      uncovered.push(txn);
    }
  }

  return { covered, uncovered, owedInPaise };
}

export const verifyPayment = async (req, res) => {
  const razorpay_order_id = req.body.payload.payment.entity.order_id;
  const razorpay_payment_id = req.body.payload.payment.entity.id;
  const razorpay_status = req.body.payload.payment.entity.status;
  const razorpay_amount = Number(req.body.payload.payment.entity.amount);

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
    lock: true,
    transaction: t
  });

  if (transactions && transactions.length > 0) {
    const bookedBy = await validateCard(transactions[0].cardno);
    const updatedBy = RAZORPAY_CALLBACK;

    const userBookingIdMap = {};

    // What this payment already paid for. A redelivery of the same payment
    // must not spend that money a second time on the rows it did not cover.
    const settledTransactions = await Transactions.findAll({
      where: {
        razorpay_order_id,
        status: [STATUS_PAYMENT_COMPLETED, STATUS_CASH_COMPLETED]
      },
      transaction: t
    });
    const settledInPaise = settledTransactions.reduce(
      (sum, txn) => sum + txn.amount * 100,
      0
    );

    // Never settle more than the payment collected. Anything left uncovered
    // keeps the status it had, so it still expires through the pending-payment
    // cron or gets reconciled, instead of being given away.
    const { covered, uncovered, owedInPaise } = splitTransactionsByPayment(
      transactions,
      razorpay_amount - settledInPaise
    );
    const uncoveredIds = new Set(uncovered.map((txn) => txn.id));
    let processedCount = 0;

    if (uncovered.length > 0) {
      req.log.error('razorpay_underpaid_order', {
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        razorpayStatus: razorpay_status,
        cardno: transactions[0].cardno,
        paidInPaise: razorpay_amount,
        alreadySettledInPaise: settledInPaise,
        owedInPaise,
        settledTransactionIds: covered.map((txn) => txn.id),
        leftUntouchedTransactionIds: uncovered.map((txn) => txn.id)
      });
    }

    for (const transaction of transactions) {
      var transactionStatus;
      var bookingStatus;

      // Advancing a transaction this payment does not reach would strand it:
      // 'authorized' is in neither the retry list nor the expiry cron's.
      if (uncoveredIds.has(transaction.id)) {
        continue;
      }

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
            if ([STATUS_CANCELLED, STATUS_ADMIN_CANCELLED].includes(booking.status)) {
              req.log.warn('payment_received_for_cancelled_booking', {
                bookingid: booking.bookingid,
                cardno: booking.cardno,
                amount: transaction.amount,
                transactionId: transaction.id
              });
            } else {
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
          }
          break;

        case STATUS_PAYMENT_FAILED:
          // Preserve cash pending status: international users' transactions are
          // created as cash pending (no 24h expiry). A failed online retry must
          // not strip that status, otherwise the booking instantly "expires".
          transactionStatus =
            transaction.status === STATUS_CASH_PENDING
              ? STATUS_CASH_PENDING
              : STATUS_PAYMENT_FAILED;
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
      processedCount += 1;

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
      transactionCount: processedCount,
      leftPendingCount: transactions.length - processedCount
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
    },
    lock: true,
    transaction: t
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
    const order = await resolveOrderForTransactions(transactions, totalAmount, t);
    req.log.info('create_order_generated', { cardno: req.user.cardno, orderId: order.id, amount: totalAmount });
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
    },
    lock: true,
    transaction: t
  });

  req.log.info('create_order_v2_transactions_found', {
    cardno: req.user.cardno,
    transactionCount: transactions.length
  });

  const { totalAmount, validTransactions } = transactions.reduce(
    (acc, transaction) => {
      const categories = bookingCategoryMap[transaction.bookingid];
      const bookingType = getBookingType(transaction);
      if (
        bookingType != TYPE_FOOD ||
        categories.includes(transaction.category)
      ) {
        acc.totalAmount += transaction.amount;
        acc.validTransactions.push(transaction);
      }
      return acc;
    },
    { totalAmount: 0, validTransactions: [] }
  );

  const validTransactionIds = validTransactions.map((txn) => txn.id);

  req.log.info('create_order_v2_total_amount', {
    cardno: req.user.cardno,
    totalAmount,
    validTransactionCount: validTransactionIds.length
  });

  if (totalAmount > 0) {
    const order = await resolveOrderForTransactions(
      validTransactions,
      totalAmount,
      t
    );
    req.log.info('create_order_v2_generated', { cardno: req.user.cardno, orderId: order.id, amount: totalAmount });
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
