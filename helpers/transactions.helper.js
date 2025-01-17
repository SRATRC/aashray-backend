import {
  Transactions
} from '../models/associations.js';
import {
  TRANSACTION_TYPE_UPI,
  TRANSACTION_TYPE_CASH,
  STATUS_PAYMENT_COMPLETED,
  STATUS_CASH_COMPLETED
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