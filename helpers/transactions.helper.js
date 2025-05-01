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
  ROOM_STATUS_CHECKEDIN
} from '../config/constants.js';
import { v4 as uuidv4 } from 'uuid';
import { Sequelize } from 'sequelize';
import ApiError from '../utils/ApiError.js';
import Razorpay from 'razorpay';
import moment from 'moment';

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
  t
) {
  const transaction = await Transactions.create(
    {
      cardno,
      bookingid: booking.bookingid,
      category,
      amount,
      status: STATUS_PAYMENT_PENDING,
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
      if (
        credits > 0 &&
        transaction.category != TYPE_ADHYAYAN &&
        transaction.category != TYPE_GUEST_ADHYAYAN
      ) {
        await addCredit(user, transaction.cardno, credits, t);
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
}

export async function adjustAmount(user, transaction, amount, t) {
  const originalAmount = transaction.amount + transaction.discount;

  if (originalAmount > amount) {
    const credits = originalAmount - amount;

    await addCredit(user, transaction.cardno, credits, t);

    const creditsUsed = Math.min(amount, transaction.discount);
    const discountedAmount = amount - creditsUsed;

    await transaction.update(
      {
        status: STATUS_PAYMENT_COMPLETED,
        discount: creditsUsed,
        amount: discountedAmount,
        description: `credits added: ${credits}`,
        updatedBy: user.username
      },
      { transaction: t }
    );
  } else if (originalAmount < amount) {
    const balance = amount - originalAmount;
    await transaction.update(
      {
        status: STATUS_PAYMENT_PENDING,
        discount: originalAmount,
        amount: balance,
        description: `Transaction updated. New Balance ${balance}.`,
        updatedBy: user.username
      },
      { transaction: t }
    );
  }
}

async function addCredit(user, cardno, credits, t) {
  const card = await CardDb.findOne({
    where: { cardno }
  });

  if (!card) new ApiError(400, ERR_CARD_NOT_FOUND);

  await card.update(
    {
      credits: card.credits + credits,
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
    const bookingStatus =
      booking instanceof RoomBooking ? ROOM_STATUS_CHECKEDIN : STATUS_CONFIRMED;

    booking.update(
      {
        status: bookingStatus,
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

  var order; 
  if (process.env.NODE_ENV == 'prod' && amount > 0) {
    order = await razorpay.orders.create(options);
  } else {
    options['id'] = uuidv4();
    order = options; 
  }

  return order;
};

export async function cancelPendingBookings() {
  const yesterday = moment.utc().subtract(1, 'day');

  const transactions = await Transactions.findAll({
    where: {
      status: [STATUS_PAYMENT_PENDING],
      updatedAt: {
        [Sequelize.Op.lte]: yesterday
      }
    }
  });

  console.log('TRANSACTIONS TO CANCEL: ' + JSON.stringify(transactions));

  // TODO: implement logic to cancel transactions
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
