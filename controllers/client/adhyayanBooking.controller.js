import {
  ShibirDb,
  ShibirBookingDb,
  ShibirBookingTransaction
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
  STATUS_AWAITING_REFUND
} from '../../config/constants.js';
import { v4 as uuidv4 } from 'uuid';
import APIError from '../../utils/ApiError.js';
import sendMail from '../../utils/sendMail.js';

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

export const RegisterShibir = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const bookingid = uuidv4();

  const isBooked = await ShibirBookingDb.findOne({
    where: {
      shibir_id: req.body.shibir_id,
      cardno: req.body.cardno,
      status: {
        [Sequelize.Op.in]: [
          STATUS_CONFIRMED,
          STATUS_WAITING,
          STATUS_PAYMENT_PENDING
        ]
      }
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
  const today = moment().format('YYYY-MM-DD');

  const shibirs = await ShibirDb.findAll({
    attributes: ['name', 'speaker', 'start_date', 'end_date'],
    include: [
      {
        model: ShibirBookingDb,
        attributes: ['status'],
        where: {
          cardno: req.params.cardno
        }
      }
    ],
    where: {
      start_date: {
        [Sequelize.Op.gt]: today
      }
    },
    order: [['start_date', 'ASC']]
  });

  return res.status(200).send({ message: 'fetched results', data: shibirs });
};

export const CancelShibir = async (req, res) => {
  const { cardno, shibir_id } = req.body;

  const t = await database.transaction();
  req.transaction = t;

  const isBooked = await ShibirBookingDb.findOne({
    where: {
      shibir_id: shibir_id,
      cardno: cardno,
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
    throw new APIError(404, 'Shibir booking not found');
  }

  const update_shibir = await ShibirDb.findOne({
    where: {
      id: req.body.shibir_id
    },
    transaction: t,
    lock: t.LOCK.UPDATE
  });

  if (isBooked.dataValues.status == STATUS_CONFIRMED) {
    const booking_transaction = await ShibirBookingTransaction.findOne({
      where: {
        type: TYPE_EXPENSE,
        bookingid: isBooked.dataValues.bookingid,
        cardno: isBooked.dataValues.cardno,
        status: STATUS_PAYMENT_COMPLETED
      }
    });
    booking_transaction.status = STATUS_CANCELLED;
    await booking_transaction.save({ transaction: t });

    await ShibirBookingTransaction.create(
      {
        cardno: cardno,
        bookingid: isBooked.dataValues.bookingid,
        type: TYPE_REFUND,
        amount: booking_transaction.dataValues.amount,
        upi_ref: 'NA',
        status: STATUS_AWAITING_REFUND,
        updatedBy: 'USER'
      },
      { transaction: t }
    );

    if (
      update_shibir &&
      update_shibir.available_seats < update_shibir.total_seats
    ) {
      update_shibir.available_seats += 1;
      await update_shibir.save({ transaction: t });
    }
  } else if (isBooked.dataValues.status == STATUS_PAYMENT_PENDING) {
    const booking_transaction = await ShibirBookingTransaction.findOne({
      where: {
        type: TYPE_EXPENSE,
        bookingid: isBooked.dataValues.bookingid,
        cardno: isBooked.dataValues.cardno,
        status: STATUS_PAYMENT_PENDING
      }
    });
    booking_transaction.status = STATUS_CANCELLED;
    await booking_transaction.save({ transaction: t });
    if (booking_transaction.dataValues.discount > 0) {
      await ShibirBookingTransaction.create(
        {
          cardno: cardno,
          bookingid: isBooked.dataValues.bookingid,
          type: TYPE_REFUND,
          amount: booking_transaction.dataValues.discount,
          upi_ref: 'NA',
          status: STATUS_AWAITING_REFUND,
          updatedBy: 'USER'
        },
        { transaction: t }
      );
    }
  }

  isBooked.status = STATUS_CANCELLED;
  await isBooked.save({ transaction: t });

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
  const { start_date, end_date } = req.query;
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;
  const offset = (page - 1) * pageSize;

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
  } else {
    whereCondition.end_date = {
      [Sequelize.Op.gte]: start_date
    };
  }

  const shibirs = await ShibirDb.findAll({
    where: whereCondition,
    offset,
    limit: pageSize,
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
