import {
  ShibirDb,
  ShibirBookingDb,
  ShibirBookingTransaction,
  Transactions
} from '../../models/associations.js';
import database from '../../config/database.js';
import Sequelize from 'sequelize';
import moment from 'moment';
import {
  STATUS_WAITING,
  STATUS_CONFIRMED,
  STATUS_CANCELLED,
  STATUS_PAYMENT_PENDING,
  TYPE_REFUND,
  TYPE_EXPENSE,
  STATUS_PAYMENT_COMPLETED,
  STATUS_AWAITING_REFUND,
  TYPE_ADHYAYAN,
  TYPE_GUEST_ADHYAYAN,
  STATUS_CASH_PENDING,
  STATUS_CASH_COMPLETED,
  STATUS_CREDITED
} from '../../config/constants.js';
import { v4 as uuidv4 } from 'uuid';
import sendMail from '../../utils/sendMail.js';
import ApiError from '../../utils/ApiError.js';

export const FetchAllShibir = async (req, res) => {
  const today = moment().format('YYYY-MM-DD');

  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;

  const offset = (page - 1) * pageSize;

  const shibirs = await ShibirDb.findAll({
    where: {
      start_date: {
        [Sequelize.Op.gt]: today
      }
    },
    offset,
    limit: pageSize,
    order: [['start_date', 'ASC']]
  });

  const groupedByMonth = shibirs.reduce((acc, event) => {
    const month = event.month;
    if (!acc[month]) {
      acc[month] = [];
    }
    acc[month].push(event);
    return acc;
  }, {});

  const formattedResponse = {
    message: 'fetched results',
    data: Object.keys(groupedByMonth).map((month) => ({
      title: month,
      data: groupedByMonth[month]
    }))
  };

  return res.status(200).send(formattedResponse);
};

// TODO: DEPRECATE THIS ENDPOINT
export const RegisterShibir = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const bookingid = uuidv4();

  const isBooked = await ShibirBookingDb.findOne({
    where: {
      shibir_id: req.body.shibir_id,
      cardno: req.body.cardno,
      guest: null,
      status: [
        STATUS_CONFIRMED,
        STATUS_WAITING,
        STATUS_PAYMENT_PENDING
      ]
    }
  });

  if (isBooked) {
    throw new APIError(400, 'Shibir already booked');
  }

  const shibir = await ShibirDb.findOne({
    where: {
      id: req.body.shibir_id
    },
    transaction: t,
    lock: t.LOCK.UPDATE
  });
  if (!shibir) {
    throw new APIError(404, 'Shibir not found');
  }

  if (shibir.available_seats > 0) {
    const refund_amounts = await ShibirBookingTransaction.findAll({
      where: {
        cardno: req.body.cardno,
        type: TYPE_REFUND,
        status: STATUS_AWAITING_REFUND
      }
    });

    if (refund_amounts.length > 0) {
      const amounts = refund_amounts.map((refund) => refund.dataValues.amount);
      const targetAmount = shibir.dataValues.amount;
      const { closestSum, closestIndices } = findClosestSum(
        amounts,
        targetAmount
      );

      await ShibirBookingDb.create(
        {
          bookingid: bookingid,
          shibir_id: req.body.shibir_id,
          cardno: req.body.cardno,
          status:
            closestSum < targetAmount
              ? STATUS_PAYMENT_PENDING
              : STATUS_CONFIRMED
        },
        { transaction: t }
      );

      const bookingIds = [];
      for (var index of closestIndices) {
        await ShibirBookingTransaction.update(
          {
            status: STATUS_PAYMENT_COMPLETED,
            description: `compensated with transactions:${bookingid}`
          },
          {
            where: {
              id: refund_amounts[index].dataValues.id
            },
            transaction: t
          }
        );
        bookingIds.push(refund_amounts[index].dataValues.id);
        await refund_amounts[index].save({ transaction: t });
      }

      if (closestSum >= targetAmount) {
        await ShibirBookingTransaction.create(
          {
            cardno: req.body.cardno,
            bookingid: bookingid,
            type: TYPE_EXPENSE,
            amount: targetAmount,
            upi_ref: 'NA',
            description: `compensated with pending refunds: ${bookingIds}`,
            status: STATUS_PAYMENT_COMPLETED,
            updatedBy: 'USER'
          },
          { transaction: t }
        );
        if (closestSum > targetAmount) {
          await ShibirBookingTransaction.create(
            {
              cardno: req.body.cardno,
              bookingid: bookingid,
              type: TYPE_REFUND,
              amount: closestSum - targetAmount,
              upi_ref: 'NA',
              description: `remaining amounts for transactions: ${bookingIds}`,
              status: STATUS_AWAITING_REFUND,
              updatedBy: 'USER'
            },
            { transaction: t }
          );
        }
        shibir.available_seats -= 1;
        await shibir.save({ transaction: t });
      } else if (closestSum < targetAmount) {
        await ShibirBookingTransaction.create(
          {
            cardno: req.body.cardno,
            bookingid: bookingid,
            type: TYPE_EXPENSE,
            amount: targetAmount - closestSum,
            discount: closestSum,
            upi_ref: 'NA',
            description: `compensated with pending refunds: ${bookingIds}`,
            status: STATUS_PAYMENT_PENDING,
            updatedBy: 'USER'
          },
          { transaction: t }
        );
      }
    } else {
      await ShibirBookingDb.create(
        {
          bookingid: bookingid,
          shibir_id: req.body.shibir_id,
          cardno: req.body.cardno,
          status: STATUS_PAYMENT_PENDING
        },
        { transaction: t }
      );

      await ShibirBookingTransaction.create(
        {
          cardno: req.body.cardno,
          bookingid: bookingid,
          type: TYPE_EXPENSE,
          amount: shibir.dataValues.amount,
          upi_ref: 'NA',
          status: STATUS_PAYMENT_PENDING,
          updatedBy: 'USER'
        },
        { transaction: t }
      );
    }
  } else {
    const booking = await ShibirBookingDb.create(
      {
        shibir_id: req.body.shibir_id,
        cardno: req.body.cardno,
        status: STATUS_WAITING
      },
      { transaction: t }
    );
    if (!booking) {
      throw new APIError(400, 'Shibir booking failed');
    }
  }

  await t.commit();

  sendMail({
    email: req.user.email,
    subject: `Shibir Booking Confirmation`,
    template: 'rajAdhyayan',
    context: {
      name: req.user.issuedto,
      adhyayanName: shibir.dataValues.name,
      speaker: shibir.dataValues.speaker,
      startDate: shibir.dataValues.start_date,
      endDate: shibir.dataValues.end_date
    }
  });

  return res.status(201).send({ message: 'Shibir booking successful' });
};

export const FetchBookedShibir = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;
  const offset = (page - 1) * pageSize;

  const shibirs = await database.query(
    `SELECT 
	t1.bookingid, 
  NULL AS bookedFor,
  NULL AS name,
	t1.shibir_id, 
	t1.status, 
	t2.name AS shibir_name, 
	t2.speaker, 
	t2.start_date, 
	t2.end_date, 
  t3.amount, 
  t3.status as transaction_status
FROM shibir_booking_db t1
JOIN shibir_db t2 ON t1.shibir_id = t2.id
JOIN transactions t3 ON t1.bookingid = t3.bookingid AND t3.category = :category
WHERE t1.cardno = :cardno

UNION ALL

SELECT 
	t1.bookingid, 
  COALESCE(t1.guest, 'NA') AS bookedFor,
  t4.name AS name,
	t1.shibir_id, 
	t1.status, 
	t2.name AS shibir_name, 
	t2.speaker, 
	t2.start_date, 
	t2.end_date, 
  t3.amount, 
  t3.status as transaction_status
FROM guest_shibir_booking t1
JOIN shibir_db t2 ON t1.shibir_id = t2.id
JOIN guest_db t4 ON t4.id = t1.guest
JOIN transactions t3 ON t1.bookingid = t3.bookingid AND t3.category = :guest_category
WHERE t1.cardno = :cardno

ORDER BY start_date DESC
LIMIT :limit OFFSET :offset`,
    {
      replacements: {
        cardno: req.user.cardno,
        category: TYPE_ADHYAYAN,
        guest_category: TYPE_GUEST_ADHYAYAN,
        limit: pageSize,
        offset: offset
      },
      type: Sequelize.QueryTypes.SELECT
    }
  );

  return res.status(200).send({ data: shibirs });
};

export const CancelShibir = async (req, res) => {
  const { cardno, shibir_id, bookedFor } = req.body;

  const t = await database.transaction();
  req.transaction = t;

  if (bookedFor == null) {
    const isBooked = await ShibirBookingDb.findOne({
      where: {
        shibir_id: shibir_id,
        cardno: cardno,
        guest: null,
        status: {
          [Sequelize.Op.in]: [
            STATUS_CONFIRMED,
            STATUS_WAITING,
            STATUS_PAYMENT_PENDING
          ]
        }
      }
    });

    if (!isBooked) {
      throw new ApiError(404, 'Shibir booking not found');
    }

    isBooked.status = STATUS_CANCELLED;
    await isBooked.save({ transaction: t });

    const adhyayanBookingTransaction = await Transactions.findOne({
      where: {
        cardno: req.user.cardno,
        bookingid: isBooked.dataValues.bookingid,
        category: TYPE_ADHYAYAN,
        status: {
          [Sequelize.Op.in]: [
            STATUS_PAYMENT_PENDING,
            STATUS_PAYMENT_COMPLETED,
            STATUS_CASH_PENDING,
            STATUS_CASH_COMPLETED
          ]
        }
      }
    });

    if (adhyayanBookingTransaction == undefined) {
      throw new ApiError(404, 'unable to find selected booking transaction');
    }

    if (
      adhyayanBookingTransaction.status == STATUS_PAYMENT_PENDING ||
      adhyayanBookingTransaction.status == STATUS_CASH_PENDING
    ) {
      adhyayanBookingTransaction.status = STATUS_CANCELLED;
      await adhyayanBookingTransaction.save({ transaction: t });
    } else if (
      adhyayanBookingTransaction.status == STATUS_PAYMENT_COMPLETED ||
      adhyayanBookingTransaction.status == STATUS_CASH_COMPLETED
    ) {
      adhyayanBookingTransaction.status = STATUS_CREDITED;
      // TODO: add credited transaction to its table
      await adhyayanBookingTransaction.save({ transaction: t });
    }

    const waitlist = await ShibirBookingDb.findOne({
      where: {
        shibir_id: shibir_id,
        status: STATUS_WAITING
      },
      order: [['createdAt', 'ASC']]
    });

    //TODO: send notification and email to user
    if (waitlist) {
      waitlist.status = STATUS_PAYMENT_PENDING;
      await waitlist.save({ transaction: t });
    }
  } else {
    const isBooked = await ShibirBookingDb.findOne({
      where: {
        shibir_id: shibir_id,
        cardno: cardno,
        guest: bookedFor,
        status: [
          STATUS_CONFIRMED,
          STATUS_WAITING,
          STATUS_PAYMENT_PENDING
        ]
      }
    });

    if (!isBooked) {
      throw new ApiError(404, 'Shibir booking not found');
    }

    isBooked.status = STATUS_CANCELLED;
    await isBooked.save({ transaction: t });

    const adhyayanGuestBookingTransaction = await Transactions.findOne({
      where: {
        cardno: req.user.cardno,
        bookingid: isBooked.dataValues.bookingid,
        category: TYPE_GUEST_ADHYAYAN,
        status: {
          [Sequelize.Op.in]: [
            STATUS_PAYMENT_PENDING,
            STATUS_PAYMENT_COMPLETED,
            STATUS_CASH_PENDING,
            STATUS_CASH_COMPLETED
          ]
        }
      }
    });

    if (adhyayanGuestBookingTransaction == undefined) {
      throw new ApiError(404, 'unable to find selected booking transaction');
    }

    if (
      adhyayanGuestBookingTransaction.status == STATUS_PAYMENT_PENDING ||
      adhyayanGuestBookingTransaction.status == STATUS_CASH_PENDING
    ) {
      adhyayanGuestBookingTransaction.status = STATUS_CANCELLED;
      await adhyayanGuestBookingTransaction.save({ transaction: t });
    } else if (
      adhyayanGuestBookingTransaction.status == STATUS_PAYMENT_COMPLETED ||
      adhyayanGuestBookingTransaction.status == STATUS_CASH_COMPLETED
    ) {
      adhyayanGuestBookingTransaction.status = STATUS_CREDITED;
      // TODO: add credited transaction to its table
      await adhyayanGuestBookingTransaction.save({ transaction: t });
    }

    const waitlist = await ShibirBookingDb.findOne({
      where: {
        shibir_id: shibir_id,
        cardno: req.user.cardno,
        guest: bookedFor,
        status: STATUS_WAITING
      },
      order: [['createdAt', 'ASC']]
    });

    //TODO: send notification and email to user
    if (waitlist) {
      waitlist.status = STATUS_PAYMENT_PENDING;
      await waitlist.save({ transaction: t });
    }
  }

  const update_shibir = await ShibirDb.findOne({
    where: {
      id: shibir_id
    },
    transaction: t,
    lock: Sequelize.Transaction.LOCK.UPDATE
  });

  if (
    update_shibir &&
    update_shibir.available_seats < update_shibir.total_seats
  ) {
    update_shibir.available_seats += 1;
    await update_shibir.save({ transaction: t });
  }

  await t.commit();

  sendMail({
    email: req.user.email,
    subject: 'Shibir Booking Cancellation',
    template: 'rajAdhyayanCancellation',
    context: {
      name: req.user.issuedto,
      adhyayanName: update_shibir.dataValues.name
    }
  });

  return res.status(200).send({ message: 'Shibir booking cancelled' });
};

export const FetchShibirInRange = async (req, res) => {
  const { start_date } = req.query;
  let { end_date } = req.query;

  const startDateObj = new Date(start_date);
  if (!end_date) {
    const endDateObj = new Date(startDateObj);
    endDateObj.setDate(startDateObj.getDate() + 15); // Add 15 days
    end_date = endDateObj.toISOString().split('T')[0]; // Format the new end_date as YYYY-MM-DD
  }

  const whereCondition = {
    start_date: {
      [Sequelize.Op.gte]: start_date
    }
  };

  if (end_date) {
    whereCondition.start_date[Sequelize.Op.lte] = end_date;
    whereCondition.end_date = {
      [Sequelize.Op.gte]: start_date,
      [Sequelize.Op.lte]: end_date
    };
  }

  const shibirs = await ShibirDb.findAll({
    where: whereCondition,
    order: [['start_date', 'ASC']]
  });

  return res.status(200).send({ data: shibirs });
};

function findClosestSum(arr, target) {
  let closestSum = null;
  let closestIndices = null;

  function findExactSum(
    arr,
    n,
    target,
    currentSum = 0,
    currentIndices = [],
    index = 0
  ) {
    if (currentSum === target) {
      closestSum = currentSum;
      closestIndices = [...currentIndices];
      return true;
    }
    if (index === n || currentSum > target) {
      return false;
    }

    return (
      findExactSum(
        arr,
        n,
        target,
        currentSum + arr[index],
        [...currentIndices, index],
        index + 1
      ) || findExactSum(arr, n, target, currentSum, currentIndices, index + 1)
    );
  }

  function findClosestSubsetSum(
    arr,
    target,
    index,
    currentSum,
    currentIndices
  ) {
    if (index === arr.length) {
      if (
        closestSum === null ||
        Math.abs(target - currentSum) < Math.abs(target - closestSum)
      ) {
        closestSum = currentSum;
        closestIndices = [...currentIndices];
      }
      return;
    }

    findClosestSubsetSum(arr, target, index + 1, currentSum, currentIndices);
    findClosestSubsetSum(arr, target, index + 1, currentSum + arr[index], [
      ...currentIndices,
      index
    ]);
  }

  if (arr.includes(target)) {
    closestSum = target;
    closestIndices = [arr.indexOf(target)];
    return { closestSum, closestIndices };
  }

  if (findExactSum(arr, arr.length, target)) {
    return { closestSum, closestIndices };
  }

  findClosestSubsetSum(arr, target, 0, 0, []);

  return { closestSum, closestIndices };
}
