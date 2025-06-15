import { CardDb, Transactions } from '../models/associations.js';
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
  STATUS_PAYMENT_FAILED
} from '../config/constants.js';
import { v4 as uuidv4 } from 'uuid';
import { Sequelize } from 'sequelize';
import ApiError from '../utils/ApiError.js';
import Razorpay from 'razorpay';
import { getBookingType } from './booking.helper.js';
import { validateCard } from './card.helper.js';

export async function createPendingTransaction(
  card,
  booking,
  category,
  amount,
  updatedBy,
  t,
  cashAllowed = false
) {
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
  console.log('>> Cancel Transaction: Current status =', transaction.status);

  if (!card) {
    card = await validateCard(transaction.cardno);
  }

  var status = admin ? STATUS_ADMIN_CANCELLED : STATUS_CANCELLED;
  var description = transaction.description;

  const totalAmount = transaction.amount + transaction.discount;
  const credits =
    transaction.status == STATUS_PAYMENT_COMPLETED ||
    transaction.status == STATUS_CASH_COMPLETED
      ? totalAmount
      : transaction.discount;

  const bookingType = getBookingType(transaction);

  switch (transaction.status) {
    case STATUS_PAYMENT_COMPLETED:
    case STATUS_CASH_COMPLETED:
    case STATUS_PAYMENT_PENDING:
    case STATUS_CASH_PENDING:
    case STATUS_PAYMENT_FAILED:
      if (credits > 0 && bookingType != TYPE_ADHYAYAN) {
        await addCredit(user, card, bookingType, credits, t);
        status = STATUS_CREDITED;
        description = `credits added: ${credits}`;
      }
      break;

    case STATUS_CANCELLED:
    case STATUS_ADMIN_CANCELLED:
    case STATUS_CREDITED:
      throw new ApiError(
        400,
        'Cannot cancel already cancelled or credited transaction'
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

export function usableCredits(card, bookingType, amount) {
  const creditType = getCreditType(bookingType);

  const totalCredits =
    card.credits && card.credits[creditType] ? card.credits[creditType] : 0;

  const usableCredits = Math.min(amount, totalCredits);

  // store the updated credits on the card model itself so that
  // the next call for the same card will reflect what's available
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

export const generateOrderId = async (amount) => {
  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });

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
  if (['prod', 'qa'].includes(process.env.NODE_ENV) && amount > 0) {
    order = await razorpay.orders.create(options);
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
          country: 'INDIA'
        }
      }
    ],
    where: {
      // only get transactions with status STATUS_PAYMENT_PENDING
      // STATUS_CASH_PENDING is reserved for transactions created from
      // admin
      status: [STATUS_PAYMENT_PENDING],
      updatedAt: {
        [Sequelize.Op.lte]: timeFilter
      }
    }
  });

  return transactions;
}

export async function updateRazorpayTransactions(
  bookingIds,
  transactionIds,
  razorpay_order_id,
  t
) {
  await Transactions.update(
    { razorpay_order_id: razorpay_order_id },
    {
      where: {
        [Sequelize.Op.or]: [{ bookingid: bookingIds }, { id: transactionIds }]
      },
      transaction: t
    }
  );
}
