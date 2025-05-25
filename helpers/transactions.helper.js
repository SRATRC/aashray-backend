import { CardDb, RoomBooking, Transactions } from '../models/associations.js';
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
  STATUS_CONFIRMED,
  TYPE_ADHYAYAN,
  TYPE_GUEST_ADHYAYAN,
  ERR_CARD_NOT_FOUND,
  ROOM_STATUS_CHECKEDIN,
  TYPE_ROOM,
  TYPE_FLAT,
  ROOM_STATUS_PENDING_CHECKIN
} from '../config/constants.js';
import { v4 as uuidv4 } from 'uuid';
import { Sequelize } from 'sequelize';
import ApiError from '../utils/ApiError.js';
import Razorpay from 'razorpay';
import { getBookingType } from './booking.helper.js';

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
  booking,
  category,
  amount,
  updatedBy,
  t,
  cashAllowed = false
) {
  const transaction = await Transactions.create(
    {
      cardno,
      bookingid: booking.bookingid,
      category,
      amount,
      status: cashAllowed ? STATUS_CASH_PENDING : STATUS_PAYMENT_PENDING,
      updatedBy
    },
    { transaction: t }
  );

  const discountedAmount = await useCredit(
    cardno,
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
  return await cancelTransaction(user, transaction, t, true);
}

export async function userCancelTransaction(user, transaction, t) {
  return await cancelTransaction(user, transaction, t, false);
}

// STATUS_PAYMENT_PENDING,
// STATUS_PAYMENT_COMPLETED,
// STATUS_CASH_PENDING,
// STATUS_CASH_COMPLETED,
// STATUS_CANCELLED,
// STATUS_ADMIN_CANCELLED,
// STATUS_CREDITED
export async function cancelTransaction(user, transaction, t, admin = false) {
  console.log('>> Cancel Transaction: Current status =', transaction.status);
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
      if (
        credits > 0 &&
        bookingType != TYPE_ADHYAYAN
      ) {
        await addCredit(user, transaction.cardno, bookingType, credits, t);
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

  return { credits }
}

export async function adjustAmount(
    cardno,
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
    await addCredit(user, cardno, bookingType, credits, t);
    await useCredit(
      cardno,
      booking,
      transaction,
      amount,
      updatedBy,
      t
    );

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

async function addCredit(user, cardno, bookingType, credits, t) {
  const card = await CardDb.findOne({
    where: { cardno }
  });

  if (!card) new ApiError(400, ERR_CARD_NOT_FOUND);

  const previousCredits = card.credits && card.credits[bookingType]
    ? card.credits[bookingType]
    : 0;

  const updatedCredits = getUpdatedCredits(
    card,
    bookingType,
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

  const bookingType = getBookingType(transaction);

  if (!(card.credits && card.credits[bookingType] > 0)) {
    return amount;
  }
    
  const credits = card.credits[bookingType];

  const status = amount > credits 
    ? transaction.status 
    : STATUS_PAYMENT_COMPLETED;

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
    const bookingStatus = (bookingType == TYPE_ROOM || bookingType == TYPE_FLAT)
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
    bookingType,
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

function getUpdatedCredits(card, bookingType, newCredits) {
  const updatedCredits = card.credits
    ? JSON.parse(JSON.stringify(card.credits))
    : {};
    
  updatedCredits[bookingType] = newCredits;

  if (updatedCredits[bookingType] == 0) {
    delete updatedCredits[bookingType];
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
    receipt: uuidv4()
  };

  var order; 
  if (process.env.NODE_ENV == 'prod' && amount > 0) {
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

export async function updateRazorpayTransactions(bookingIds, razorpay_order_id, t) {
  await Transactions.update(
    { razorpay_order_id: razorpay_order_id },
    {
      where: {
        bookingid: bookingIds
      }, 
      transaction: t 
    } 
  );
}
