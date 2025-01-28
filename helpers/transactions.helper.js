import {
  CardDb,
  Transactions
} from '../models/associations.js';
import {
  TRANSACTION_TYPE_UPI,
  TRANSACTION_TYPE_CASH,
  STATUS_PAYMENT_COMPLETED,
  STATUS_CASH_COMPLETED,
  STATUS_PAYMENT_PENDING,
  STATUS_ADMIN_CANCELLED,
  STATUS_CANCELLED,
  STATUS_CASH_PENDING,
  STATUS_CREDITED
} from '../config/constants.js';
import Sequelize from 'sequelize';
import getDates from '../utils/getDates.js';
import moment from 'moment';
import ApiError from '../utils/ApiError.js';

export async function createTransaction(cardno, bookingid, category, amount, upi_ref, type, updatedBy, t) {
  const status = type == TRANSACTION_TYPE_UPI
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
      status,
      updatedBy
    },
    { transaction: t }
  );
  
  return transaction;
}

export async function createPendingTransaction(cardno, bookingid, category, amount, updatedBy, t) {
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
async function cancelTransaction(user, transaction, t, admin=false) {
  var status = admin ? STATUS_ADMIN_CANCELLED : STATUS_CANCELLED;

  switch (transaction.status) {
    case STATUS_PAYMENT_COMPLETED:
    case STATUS_CASH_COMPLETED:
      // TODO: transaction.amount or transaction.discount
      if (transaction.discount > 0) {
        await addCredit(user, transaction, t);
        // status = STATUS_CREDITED;
      }
      break;

    case STATUS_PAYMENT_PENDING:
    case STATUS_CASH_PENDING:
      break;

    case STATUS_CANCELLED:
    case STATUS_ADMIN_CANCELLED:
    // TODO: When is a transaction's status CREDITED?
    case STATUS_CREDITED:
      throw new ApiError(400, 'Cannot cancel already cancelled or credited transaction');

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

async function addCredit(user, transaction, t) {
  const card = await CardDb.findOne({
    where: { cardno: transaction.cardno }
  });

  if (!card)
    new ApiError(400, ERR_CARD_NOT_FOUND);

  await card.update(
    {
      credits: card.credits + transaction.discount,
      updatedBy: user.username
    },
    { transaction: t }
  );

  await transaction.update(
    {
      discount: 0,
      amount: transaction.amount + transaction.discount,
      description: `credits added: ${transaction.discount}`,
      updatedBy: user.username
    },
    { transaction: t }
  )
}

export async function useCredit(user, cardno, transaction, amount, t) {
  const card = await CardDb.findOne({
    where: { cardno: cardno }
  });

  if (!card)
    new ApiError(400, ERR_CARD_NOT_FOUND);

  if (card.credits > 0) {
    const status = amount > card.credits 
      ? STATUS_PAYMENT_PENDING
      : STATUS_PAYMENT_COMPLETED;

    // TODO: check if this makes sense
    transaction.update(
      {
        status,
        discount: Math.min(amount, card.credits),
        amount: Math.max(0, amount - card.credits),
        // set to discount amount
        description: `credits used: ${card.credits}`,
        updatedBy: user.username
      },
      { transaction: t }
    );

    await card.update(
      {
        credits: Math.max(0, card.credits - amount),
        updatedBy: user.username
      },
      { transaction: t }
    );
  }
}
