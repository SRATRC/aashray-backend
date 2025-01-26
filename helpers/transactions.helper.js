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

  // STATUS_PAYMENT_PENDING,
  // STATUS_PAYMENT_COMPLETED,
  // STATUS_CASH_PENDING,
  // STATUS_CASH_COMPLETED,
  // STATUS_CANCELLED,
  // STATUS_ADMIN_CANCELLED,
  // STATUS_CREDITED

  switch (transaction.status) {
    case STATUS_PAYMENT_COMPLETED:
    case STATUS_CASH_COMPLETED:
      await addCredit(user, transaction.cardno, transaction.amount + transaction.discount, t);
      break;

    case STATUS_PAYMENT_PENDING:
    case STATUS_CASH_PENDING:
      break;

    // TODO: Should we allow these or throw error?
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
      status: STATUS_ADMIN_CANCELLED,
      updatedBy: user.username
    },
    { transaction: t }
  );
}

async function addCredit(user, cardno, amount, t) {
  const card = await CardDb.findOne({
    where: { cardno: cardno }
  });

  if (!card)
    new ApiError(400, ERR_CARD_NOT_FOUND);

  await card.update(
    {
      credits: card.credits + amount,
      updatedBy: user.username
    },
    { transaction: t }
  );
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
        description: `Credits Applied: ${card.credits}`,
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
