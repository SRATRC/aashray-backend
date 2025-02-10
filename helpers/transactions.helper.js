import { CardDb, Transactions } from '../models/associations.js';
import {
  TRANSACTION_TYPE_UPI,
  TRANSACTION_TYPE_CASH,
  STATUS_PAYMENT_COMPLETED,
  STATUS_CASH_COMPLETED,
  STATUS_PAYMENT_PENDING,
  STATUS_ADMIN_CANCELLED,
  STATUS_CANCELLED,
  STATUS_CASH_PENDING,
  STATUS_CREDITED,
  STATUS_CONFIRMED
} from '../config/constants.js';
import { v4 as uuidv4 } from 'uuid';
import ApiError from '../utils/ApiError.js';
import Razorpay from 'razorpay';

export async function createTransaction(
  cardno,
  bookingid,
  category,
  amount,
  upi_ref,
  type,
  updatedBy,
  t
) {
  const status =
    type == TRANSACTION_TYPE_UPI
      ? STATUS_PAYMENT_COMPLETED
      : type == TRANSACTION_TYPE_CASH
      ? STATUS_CASH_COMPLETED
      : null;

  const transaction = await Transactions.create(
    {
      cardno,
      bookingid,
      category,
      amount,
      upi_ref,
      status: STATUS_PAYMENT_PENDING,
      updatedBy
    },
    { transaction: t }
  );

  return transaction;
}

export async function createPendingTransaction(
  cardno,
  bookingid,
  category,
  amount,
  updatedBy,
  t
) {
  const transaction = await Transactions.create(
    {
      cardno,
      bookingid,
      category,
      amount,
      status: STATUS_PAYMENT_PENDING,
      updatedBy
    },
    { transaction: t }
  );

  return transaction;
}

export async function userCancelBooking(user, booking, t) {
  var transaction = await Transactions.findOne({
    where: { bookingid: booking.bookingid }
  });

  if (transaction) {
    await userCancelTransaction(user, transaction, t);
  }

  await booking.update(
    {
      status: STATUS_CANCELLED,
      updatedBy: user.username
    },
    { transaction: t }
  );
}

export async function adminCancelTransaction(user, transaction, t) {
  await cancelTransaction(user, transaction, t, true);
}

export async function userCancelTransaction(user, transaction, t) {
  await cancelTransaction(user, transaction, t, false);
}

// STATUS_PAYMENT_PENDING,
// STATUS_PAYMENT_COMPLETED,
// STATUS_CASH_PENDING,
// STATUS_CASH_COMPLETED,
// STATUS_CANCELLED,
// STATUS_ADMIN_CANCELLED,
// STATUS_CREDITED
export async function cancelTransaction(user, transaction, t, admin = false) {
  var status = admin ? STATUS_ADMIN_CANCELLED : STATUS_CANCELLED;

  var amount = transaction.amount + transaction.discount;

  switch (transaction.status) {
    case STATUS_PAYMENT_COMPLETED:
    case STATUS_CASH_COMPLETED:
      if (amount > 0) {
        await addCredit(user, transaction, amount, t);
        status = STATUS_CREDITED;
      }
      break;

    case STATUS_PAYMENT_PENDING:
    case STATUS_CASH_PENDING:
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
      status,
      updatedBy: user.username
    },
    { transaction: t }
  );
}

async function addCredit(user, transaction, amount, t) {
  const card = await CardDb.findOne({
    where: { cardno: transaction.cardno }
  });

  if (!card) new ApiError(400, ERR_CARD_NOT_FOUND);

  await card.update(
    {
      credits: card.credits + amount,
      updatedBy: user.username
    },
    { transaction: t }
  );

  await transaction.update(
    {
      discount: 0,
      amount,
      description: `credits added: ${amount}`,
      updatedBy: user.username
    },
    { transaction: t }
  );
}

export async function useCredit(
  cardno,
  booking,
  transaction,
  amount,
  updatedBy,
  t
) {
  const card = await CardDb.findOne({
    where: { cardno: cardno }
  });

  if (!card) new ApiError(400, ERR_CARD_NOT_FOUND);

  if (card.credits <= 0) {
    return amount;
  }

  const status =
    amount > card.credits ? STATUS_PAYMENT_PENDING : STATUS_PAYMENT_COMPLETED;

  const creditsUsed = Math.min(amount, card.credits);
  const discountedAmount = amount - creditsUsed;
  transaction.update(
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
    booking.update(
      {
        status: STATUS_CONFIRMED,
        updatedBy
      },
      { transaction: t }
    );
  }

  await card.update(
    {
      credits: card.credits - creditsUsed,
      updatedBy
    },
    { transaction: t }
  );

  return discountedAmount;
}

export const generateOrderId = async (amount) => {
  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });

  const options = {
    amount: amount * 100,
    currency: 'INR',
    receipt: uuidv4()
  };

  const order = await razorpay.orders.create(options);
  return order;
};
