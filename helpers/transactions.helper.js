import { CardDb, Transactions, TravelBusPassengers, TravelBusGroup } from '../models/associations.js';
import {
  STATUS_PAYMENT_COMPLETED,
  STATUS_CASH_COMPLETED,
  STATUS_PAYMENT_PENDING,
  STATUS_ADMIN_CANCELLED,
  STATUS_CANCELLED,
  STATUS_CASH_PENDING,
  STATUS_CREDITED,
  STATUS_CONFIRMED,
  TYPE_ADHYAYAN,
  ERR_CARD_NOT_FOUND,
  TYPE_ROOM,
  TYPE_FLAT,
  ROOM_STATUS_PENDING_CHECKIN,
  STATUS_PAYMENT_FAILED,
  TYPE_UTSAV,
  TYPE_TRAVEL,
  STATUS_PAYMENT_AUTHORIZED,
  MAX_APP_PAYMENT_DURATION_MINUTES
} from '../config/constants.js';
import { v4 as uuidv4 } from 'uuid';
import { Sequelize } from 'sequelize';
import ApiError from '../utils/ApiError.js';
import Razorpay from 'razorpay';
import moment from 'moment';
import { getBookingType, ifMigrated } from './booking.helper.js';
import { validateCard } from './card.helper.js';
import logger from '../config/logger.js';

export async function createPendingTransaction(
  card,
  booking,
  category,
  amount,
  updatedBy,
  t,
  cashAllowed = false
) {
  if (card.country && card.country != 'India') {
    cashAllowed = true;
  }

  const transaction = await Transactions.create(
    {
      cardno: card.cardno,
      bookingid: booking.bookingid,
      category,
      amount,
      status: cashAllowed ? STATUS_CASH_PENDING : STATUS_PAYMENT_PENDING,
      updatedBy
    },
    { transaction: t }
  );

  logger.info('create_pending_transaction', { transactionId: transaction.id, cardno: card.cardno, bookingid: booking.bookingid, category, amount, cashAllowed });

  const discountedAmount = await useCredit(
    card,
    booking,
    transaction,
    amount,
    updatedBy,
    t
  );

  return { transaction, discountedAmount };
}

export async function userCancelBooking(user, booking, t) {
  var transaction = await Transactions.findOne({
    where: { bookingid: booking.bookingid }
  });

  if (transaction) {
    await userCancelTransaction(user, null, transaction, t);
  }

  await booking.update(
    {
      status: STATUS_CANCELLED,
      updatedBy: user.username
    },
    { transaction: t }
  );
}

export async function adminCancelTransaction(user, card, transaction, t) {
  return await cancelTransaction(user, card, transaction, t, true);
}

export async function userCancelTransaction(user, card, transaction, t) {
  return await cancelTransaction(user, card, transaction, t, false);
}

export async function cancelTransactions(user, transactions, t, admin = false) {
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
      await cancelTransaction(user, card, transaction, t, admin);
    }
  }
}

export async function cancelTransaction(
  user,
  card,
  transaction,
  t,
  admin = false
) {
  logger.info('cancel_transaction_start', { transactionId: transaction.id, status: transaction.status, admin });

  if (!card) {
    card = await validateCard(transaction.cardno);
  }

  // Remove from bus assignment if assigned
  const busAssignment = await TravelBusPassengers.findOne({
    where: {
      bookingid: transaction.bookingid
    },
    transaction: t
  });

  if (busAssignment) {

    await TravelBusGroup.update(
      {
        coordinator_bookingid: null
      },
      {
        where: {
          id: busAssignment.bus_group_id,
          coordinator_bookingid: transaction.bookingid
        },
        transaction: t
      }
    );

    await TravelBusPassengers.destroy({
      where: {
        bookingid: transaction.bookingid
      },
      transaction: t
    });

    logger.info(
      'cancel_travel_removed_from_bus',
      {
        bookingid: transaction.bookingid,
        busGroupId: busAssignment.bus_group_id
      }
    );
  }

  const bookingType = getBookingType(transaction);

  if (
    !admin &&
    [TYPE_TRAVEL, TYPE_UTSAV].includes(bookingType) &&
    [STATUS_PAYMENT_COMPLETED, STATUS_CASH_COMPLETED].includes(transaction.status)
  ) {
    // User cancelling a paid travel/utsav booking via the app:
    // no credits are issued and the transaction stays 'completed'.
    // Pending/failed transactions deliberately fall through so they still
    // get marked cancelled below (otherwise they'd be left dangling).
    logger.info('cancel_transaction_user_no_credits', { transactionId: transaction.id, bookingType });
    return { credits: 0 }; // no credits added
  }

  var status = admin ? STATUS_ADMIN_CANCELLED : STATUS_CANCELLED;
  var description = transaction.description;

  const totalAmount = transaction.amount + transaction.discount;
  const credits =
    transaction.status == STATUS_PAYMENT_COMPLETED ||
      transaction.status == STATUS_CASH_COMPLETED
      ? totalAmount
      : transaction.discount;

  switch (transaction.status) {
    case STATUS_PAYMENT_COMPLETED:
    case STATUS_CASH_COMPLETED:
    case STATUS_PAYMENT_PENDING:
    case STATUS_CASH_PENDING:
    case STATUS_PAYMENT_FAILED:
    case STATUS_PAYMENT_AUTHORIZED:
      if (
        [TYPE_ADHYAYAN, TYPE_UTSAV].includes(bookingType) ||
        ifMigrated(transaction)
      ) {
        // for bookings that are not credited, keep txn status as completed for reports
        if (
          [STATUS_PAYMENT_COMPLETED, STATUS_CASH_COMPLETED].includes(
            transaction.status
          )
        ) {
          status = transaction.status;
        }
      } else if (credits > 0) {
        await addCredit(user, card, bookingType, credits, t);
        status = STATUS_CREDITED;
        description = `credits added: ${credits}`;
      }
      break;

    case STATUS_CANCELLED:
      if (admin) {
        // ✅ force credits to full amount if admin chooses to issue credits
        const creditAmount = transaction.amount + transaction.discount;
        if (creditAmount > 0) {
          await addCredit(user, card, bookingType, creditAmount, t);
          status = STATUS_CREDITED;
          description = `credits added: ${creditAmount}`;
        } else {
          status = STATUS_ADMIN_CANCELLED;
        }
      } else {
        throw new ApiError(400, 'Cannot cancel already cancelled transaction');
      }
      break;

    case STATUS_ADMIN_CANCELLED:
    case STATUS_CREDITED:
      throw new ApiError(
        400,
        'Cannot cancel already admin cancelled or credited transaction'
      );

    default:
      throw new ApiError(400, 'Invalid status provided');
  }

  await transaction.update(
    {
      discount: 0,
      amount: totalAmount,
      description,
      status,
      updatedBy: user.username
    },
    { transaction: t }
  );

  logger.info('cancel_transaction_success', { transactionId: transaction.id, fromStatus: transaction.status, toStatus: status, credits });
  return { credits };
}

export async function adjustAmount(
  card,
  booking,
  transaction,
  amount,
  updatedBy,
  t
) {
  const originalAmount = transaction.amount + transaction.discount;
  const bookingType = getBookingType(transaction);

  if (originalAmount > amount) {
    const credits = originalAmount - amount;
    await addCredit(user, card, bookingType, credits, t);
    await useCredit(card, booking, transaction, amount, updatedBy, t);
  } else if (originalAmount < amount) {
    const balance = amount - originalAmount;
    await transaction.update(
      {
        // set status to cash pending as only admin
        // can call this function
        status: STATUS_CASH_PENDING,
        discount: originalAmount,
        amount: balance,
        description: `Transaction updated. New Balance ${balance}.`,
        updatedBy: updatedBy
      },
      { transaction: t }
    );
  }
}

function getCreditType(bookingType) {
  const creditType = bookingType == TYPE_FLAT ? TYPE_ROOM : bookingType;

  return creditType;
}

async function addCredit(user, card, bookingType, credits, t) {
  const creditType = getCreditType(bookingType);

  const previousCredits =
    card.credits && card.credits[creditType] ? card.credits[creditType] : 0;

  const updatedCredits = getUpdatedCredits(
    card,
    creditType,
    previousCredits + credits
  );

  await card.update(
    {
      credits: updatedCredits,
      updatedBy: user.username
    },
    { transaction: t }
  );
}

async function useCredit(card, booking, transaction, amount, updatedBy, t) {
  const bookingType = getBookingType(transaction);
  const creditType = getCreditType(bookingType);

  if (!(card.credits && card.credits[creditType] > 0)) {
    return amount;
  }

  const credits = card.credits[creditType];

  const status =
    amount > credits ? transaction.status : STATUS_PAYMENT_COMPLETED;

  const creditsUsed = Math.min(amount, credits);
  const discountedAmount = amount - creditsUsed;
  await transaction.update(
    {
      status,
      discount: creditsUsed,
      amount: discountedAmount,
      // set to discount amount
      description: `credits used: ${creditsUsed}`,
      updatedBy
    },
    { transaction: t }
  );

  // After applying credits, if the transaction is complete
  // then confirm the booking.
  if (status == STATUS_PAYMENT_COMPLETED) {
    const bookingStatus =
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
  }

  const updatedCredits = getUpdatedCredits(
    card,
    creditType,
    credits - creditsUsed
  );

  await card.update(
    {
      credits: updatedCredits,
      updatedBy
    },
    { transaction: t }
  );

  return discountedAmount;
}

/**
 * Calculates and deducts usable credits from a card for a transaction.
 * **Note:** This function mutates the `card.credits` object.
 * If you only need to calculate without mutation, pass a deep copy of `card.credits`.
 * @param {object} card - The card object, which will be mutated.
 * @param {string} bookingType - The type of booking.
 * @param {number} amount - The transaction amount.
 * @returns {number} The amount of credits used.
 */
export function usableCredits(card, bookingType, amount) {
  const creditType = getCreditType(bookingType);

  const totalCredits =
    card.credits && card.credits[creditType] ? card.credits[creditType] : 0;

  const usableCredits = Math.min(amount, totalCredits);

  card.credits = card.credits || {};
  card.credits[creditType] = totalCredits - usableCredits;

  return usableCredits;
}

function getUpdatedCredits(card, creditType, newCredits) {
  const updatedCredits = card.credits
    ? JSON.parse(JSON.stringify(card.credits))
    : {};

  updatedCredits[creditType] = newCredits;

  if (updatedCredits[creditType] == 0) {
    delete updatedCredits[creditType];
  }

  return updatedCredits;
}

const getRazorpayClient = () =>
  new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });

// Envs where Razorpay orders are real (created/fetched via the API). Elsewhere
// order ids are local uuid stubs and must not be sent to Razorpay.
const isRazorpayLiveEnv = () => ['prod', 'qa'].includes(process.env.NODE_ENV);

// Order creation/lookup runs while a FOR UPDATE lock is held on the pending
// transactions, so a hung Razorpay call would pin a DB connection and block
// concurrent confirmations. Bound every Razorpay HTTP call so a slow/hung
// response fails fast and releases the lock instead of holding it indefinitely.
const RAZORPAY_REQUEST_TIMEOUT_MS = 15000;

const withRazorpayTimeout = async (promise, label) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), RAZORPAY_REQUEST_TIMEOUT_MS);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
};

export const generateOrderId = async (amount) => {
  const razorpay = getRazorpayClient();

  const options = {
    amount: amount * 100,
    currency: 'INR',
    receipt: uuidv4(),
    notes: {
      app: 'aashray',
      env: process.env.NODE_ENV
    }
  };

  var order;
  if (isRazorpayLiveEnv() && amount > 0) {
    order = await withRazorpayTimeout(
      razorpay.orders.create(options),
      'razorpay_order_create_timeout'
    );
  } else {
    options['id'] = uuidv4();
    order = options;
  }

  return order;
};

export async function getPendingTransactions(timeFilter) {
  // only get pending transactions for India based users
  const transactions = await Transactions.findAll({
    include: [
      {
        model: CardDb,
        attributes: ['cardno', 'email', 'mobno'],
        required: true,
        where: {
          country: 'India'
        }
      }
    ],
    where: {
      // only get transactions with status STATUS_PAYMENT_PENDING
      // STATUS_CASH_PENDING is reserved for transactions created from
      // admin
      status: [STATUS_PAYMENT_PENDING, STATUS_PAYMENT_FAILED],
      createdAt: {
        [Sequelize.Op.lte]: timeFilter
      }
    }
  });

  return transactions;
}

// Statuses a transaction can still be paid from. Anything else is settled or
// dead, and stamping a new order id on it would let a later webhook reopen it.
const PAYABLE_TRANSACTION_STATUSES = [
  STATUS_PAYMENT_PENDING,
  STATUS_CASH_PENDING,
  STATUS_PAYMENT_FAILED,
  STATUS_PAYMENT_AUTHORIZED
];

export async function updateRazorpayTransactions(
  bookingIds,
  transactionIds,
  razorpay_order_id,
  t
) {
  const where = {
    [Sequelize.Op.or]: [{ bookingid: bookingIds }, { id: transactionIds }],
    status: PAYABLE_TRANSACTION_STATUSES
  };

  // I know i am running this query twice but for logging purposes it is better to do it this way
  const transactionsToUpdate = await Transactions.findAll({
    where,
    transaction: t
  });

  logger.info('update_razorpay_transactions_start', { razorpay_order_id, count: transactionsToUpdate.length });

  await Transactions.update(
    {
      razorpay_order_id: razorpay_order_id
    },
    {
      where,
      transaction: t
    }
  );
}

// Razorpay order statuses that are still payable, so the order can be reused.
const REUSABLE_RAZORPAY_ORDER_STATUSES = ['created', 'attempted'];

/**
 * Returns the Razorpay order id shared by every transaction, or null.
 * Only returns an id when ALL transactions carry the same non-null
 * razorpay_order_id. A mixed or partial set (some blank, or differing ids)
 * means a fresh order is safer.
 */
export const getSharedRazorpayOrderId = (transactions) => {
  if (!transactions || transactions.length === 0) return null;
  const orderIds = new Set(transactions.map((txn) => txn.razorpay_order_id));
  const [orderId] = [...orderIds];
  return orderIds.size === 1 && orderId ? orderId : null;
};

/**
 * Inspects an existing Razorpay order to decide whether it can be reused.
 * Returns:
 *   { order } -> reuse this order (still payable and amount matches)
 *   { paid }  -> order already paid; caller must NOT create a new one
 *   null      -> not reusable; a fresh order should be created
 * In non prod/qa envs the stored id is a local uuid (no real Razorpay order),
 * so a payable stub is reconstructed instead of calling Razorpay.
 */
export const inspectRazorpayOrder = async (razorpay_order_id, amount) => {
  const expectedAmount = Math.round(amount * 100);
  const payableStub = {
    order: { id: razorpay_order_id, amount: expectedAmount, currency: 'INR' }
  };

  // Non prod/qa: stored id is a local uuid, no real Razorpay order to fetch.
  if (!isRazorpayLiveEnv()) {
    return payableStub;
  }

  try {
    const order = await withRazorpayTimeout(
      getRazorpayClient().orders.fetch(razorpay_order_id),
      'razorpay_order_fetch_timeout'
    );
    if (!order) return null;
    if (order.status === 'paid') return { paid: true };
    if (
      REUSABLE_RAZORPAY_ORDER_STATUSES.includes(order.status) &&
      order.amount === expectedAmount
    ) {
      return { order };
    }
    return null;
  } catch (err) {
    // A definitive 4xx (order not found / bad request / auth) means the stored
    // id is permanently broken — reusing it would leave the customer unable to
    // ever pay. Fall through to creating a fresh order instead.
    const statusCode = Number(err?.statusCode ?? err?.error?.statusCode);
    if (statusCode >= 400 && statusCode < 500) {
      logger.error('razorpay_order_fetch_invalid_order', {
        razorpay_order_id,
        statusCode,
        error: err?.message ?? err?.error?.description
      });
      return null;
    }

    // Transient (network / 5xx / timeout): fail closed by reusing the existing
    // order id instead of minting a new one, which would overwrite and orphan
    // an in-flight payment. Razorpay rejects re-paying a paid/expired order, so
    // this cannot double-charge.
    logger.warn('razorpay_order_fetch_failed_reusing_existing', {
      razorpay_order_id,
      error: err?.message ?? err?.error?.description
    });
    return payableStub;
  }
};

/**
 * Idempotently resolves the Razorpay order for a set of pending transactions.
 *
 * If the transactions already share a reusable (still payable, same-amount)
 * order it is returned as-is, so retrying "Pay" never overwrites the stored
 * razorpay_order_id and never orphans an in-flight payment. A new order is
 * created and persisted only when there is no reusable one.
 *
 * @throws ApiError(409) when the existing order was already paid — that needs
 *   reconciliation, not another payable order (avoids double-charging). Checked
 *   before the expiry rejection below, so a transaction that is both stale in
 *   our DB (e.g. a delayed webhook) and already paid on Razorpay is reconciled
 *   (409), never told its payment "expired" and retried.
 * @throws ApiError(400) when an online pending/failed transaction is older
 *   than the 24-hour window. Cash pending transactions never expire.
 */
export const resolveOrderForTransactions = async (transactions, amount, t) => {
  const existingOrderId = getSharedRazorpayOrderId(transactions);
  const existing = existingOrderId
    ? await inspectRazorpayOrder(existingOrderId, amount)
    : null;

  if (existing?.paid) {
    throw new ApiError(
      409,
      'Payment already received for this booking. Please contact support if it is not yet confirmed.'
    );
  }

  const paymentCutoff = moment
    .utc()
    .subtract(MAX_APP_PAYMENT_DURATION_MINUTES, 'minutes');
  const expiredTransactions = transactions.filter(
    (txn) =>
      txn.status !== STATUS_CASH_PENDING &&
      moment.utc(txn.createdAt).isSameOrBefore(paymentCutoff)
  );

  if (expiredTransactions.length > 0) {
    logger.warn('resolve_order_expired_transactions', {
      cardno: transactions[0]?.cardno,
      transactionIds: expiredTransactions.map((txn) => txn.id)
    });
    throw new ApiError(
      400,
      'One or more payments have expired. Please refresh and try again.'
    );
  }

  if (existing?.order) {
    logger.info('reuse_existing_razorpay_order', {
      razorpay_order_id: existingOrderId,
      amount
    });
    return existing.order;
  }

  const order = await generateOrderId(amount);
  // Stamp exactly the transactions whose amounts went into `amount`. Passing
  // the caller's booking ids instead widened the update to every transaction on
  // those bookings - including ones belonging to another card, which the
  // request body can name - so paying this order completed them too.
  await updateRazorpayTransactions(
    [],
    transactions.map((txn) => txn.id),
    order.id,
    t
  );
  return order;
};
