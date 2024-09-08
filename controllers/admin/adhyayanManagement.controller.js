import {
  ShibirDb,
  ShibirBookingDb,
  CardDb,
  ShibirBookingTransaction
} from '../../models/associations.js';
import {
  STATUS_WAITING,
  STATUS_CONFIRMED,
  TYPE_EXPENSE,
  TYPE_REFUND,
  STATUS_PAYMENT_PENDING,
  STATUS_ADMIN_CANCELLED,
  STATUS_PAYMENT_COMPLETED,
  STATUS_CANCELLED,
  STATUS_AWAITING_REFUND,
  TYPE_ADHYAYAN
} from '../../config/constants.js';
import database from '../../config/database.js';
import Sequelize from 'sequelize';
import moment from 'moment';
import ApiError from '../../utils/ApiError.js';
import Transactions from '../../models/transactions.model.js';

export const createAdhyayan = async (req, res) => {
  const {
    name,
    start_date,
    end_date,
    speaker,
    amount,
    total_seats,
    food_allowed,
    comments
  } = req.body;

  const alreadyExists = await ShibirDb.findOne({
    where: {
      speaker: { [Sequelize.Op.like]: speaker },
      start_date: start_date
    }
  });
  if (alreadyExists) throw new ApiError(400, 'Adhyayan Already Exists');

  const month = moment(start_date).format('MMMM');

  const adhyayan_details = await ShibirDb.create({
    name: name,
    speaker: speaker,
    month: month,
    start_date: start_date,
    end_date: end_date,
    total_seats: total_seats,
    amount: amount,
    available_seats: total_seats,
    food_allowed: food_allowed,
    comments: comments,
    updatedBy: req.user.username
  });

  res.status(201).send({ message: 'Created Adhyayan', data: adhyayan_details });
};

export const fetchAllAdhyayan = async (req, res) => {
  const today = moment().format('YYYY-MM-DD');

  const page = parseInt(req.query.page) || req.body.page || 1;
  const pageSize = parseInt(req.query.page_size) || req.body.page_size || 10;
  const offset = (page - 1) * pageSize;

  const shibirs = await ShibirDb.findAll({
    where: {
      start_date: {
        [Sequelize.Op.gte]: today
      }
    },
    offset,
    limit: pageSize,
    order: [['start_date', 'ASC']]
  });
  return res.status(200).send({ message: 'fetched results', data: shibirs });
};

export const updateAdhyayan = async (req, res) => {
  const {
    name,
    start_date,
    end_date,
    speaker,
    total_seats,
    food_allowed,
    comments
  } = req.body;

  const id = req.params.id;

  const data = await ShibirDb.findByPk(id);
  var available_seats = data.dataValues.available_seats;
  const diff = Math.abs(data.dataValues.total_seats - total_seats);

  if (data.dataValues.total_seats > total_seats) {
    available_seats -= diff;
    if (available_seats < 0) available_seats = 0;
  } else if (data.dataValues.total_seats < total_seats) {
    available_seats += diff;
  }

  const updatedItem = await ShibirDb.update(
    {
      name: name,
      speaker: speaker,
      month: moment(start_date).format('MMMM'),
      start_date: start_date,
      end_date: end_date,
      total_seats: total_seats,
      available_seats: available_seats,
      food_allowed: food_allowed,
      comments: comments,
      updatedBy: req.user.username
    },
    {
      where: {
        id: id
      }
    }
  );
  if (updatedItem != 1)
    throw new ApiError(500, 'Error occured while updating adhyayan');
  res.status(200).send({ message: 'Updated Adhyayan' });
};

// TODO: ask what shall be done in this function
export const adhyayanReport = async (req, res) => {
  res.status(200).send({ message: 'Fetched Adhyayan Report' });
};

export const adhyayanWaitlist = async (req, res) => {
  const today = moment().format('YYYY-MM-DD');

  const page = parseInt(req.query.page) || req.body.page || 1;
  const pageSize = parseInt(req.query.page_size) || req.body.page_size || 10;
  const offset = (page - 1) * pageSize;

  const data = await ShibirBookingDb.findAll({
    include: [
      {
        model: ShibirDb,
        attributes: ['name', 'speaker', 'start_date', 'end_date'],
        where: {
          start_date: {
            [Sequelize.Op.gte]: today
          }
        },
        required: true,
        order: [['start_date', 'ASC']]
      },
      {
        model: CardDb,
        attributes: ['issuedto', 'mobno', 'centre'],
        required: true
      }
    ],
    where: {
      status: STATUS_WAITING
    },
    attributes: ['id', 'shibir_id', 'cardno', 'status'],
    offset,
    limit: pageSize
  });
  res.status(200).send({ message: 'Fetched Adhyayan', data: data });
};

export const adhyayanStatusUpdate = async (req, res) => {
  const { shibir_id, bookingid, status, upi_ref, description } = req.body;

  const t = await database.transaction();
  req.transaction = t;

  const shibir = await ShibirDb.findOne({
    where: {
      id: shibir_id
    }
  });

  const booking = await ShibirBookingDb.findOne({
    where: {
      bookingid: bookingid
    }
  });

  switch (status) {
    case STATUS_CONFIRMED:
      if (booking.dataValues.status == STATUS_PAYMENT_PENDING) {
        await Transactions.create(
          {
            cardno: booking.dataValues.cardno,
            bookingid: booking.dataValues.bookingid,
            category: TYPE_ADHYAYAN,
            type: TYPE_EXPENSE,
            amount: shibir.dataValues.amount,
            upi_ref: upi_ref ? upi_ref : 'NA',
            status: STATUS_PAYMENT_COMPLETED,
            updatedBy: req.user.username
          },
          { transaction: t }
        );

        booking.status = STATUS_CONFIRMED;
        booking.updatedBy = req.user.username;
        await booking.save({ transaction: t });
      } else if (
        booking.dataValues.status == STATUS_CANCELLED ||
        booking.dataValues.status == STATUS_ADMIN_CANCELLED ||
        booking.dataValues.status == STATUS_WAITING
      ) {
        const payment = await Transactions.findOne({
          where: {
            cardno: booking.dataValues.cardno,
            bookingid: booking.dataValues.bookingid,
            category: TYPE_ADHYAYAN,
            type: TYPE_EXPENSE,
            status: STATUS_PAYMENT_COMPLETED
          }
        });

        if (!payment) {
          booking.status = STATUS_PAYMENT_PENDING;
          booking.updatedBy = req.user.username;
          await booking.save({ transaction: t });
        } else {
          booking.status = STATUS_CONFIRMED;
          booking.updatedBy = req.user.username;
          await booking.save({ transaction: t });
        }
      }

      if (shibir.dataValues.available_seats > 0) {
        shibir.available_seats -= 1;
        await shibir.save({ transaction: t });
      }

      break;

    case STATUS_ADMIN_CANCELLED:
      if (booking.dataValues.status == STATUS_CONFIRMED) {
        await ShibirBookingTransaction.create(
          {
            cardno: booking.dataValues.cardno,
            bookingid: bookingid,
            type: TYPE_REFUND,
            amount: shibir.dataValues.amount,
            description: description,
            status: STATUS_AWAITING_REFUND,
            updatedBy: req.user.username
          },
          { transaction: t }
        );

        booking_transaction.status = STATUS_ADMIN_CANCELLED;
        booking_transaction.updatedBy = req.user.username;
        await booking_transaction.save({ transaction: t });

        if (shibir.dataValues.available_seats > 0) {
          shibir.available_seats += 1;
          await shibir.save({ transaction: t });
        }
      } else if (booking.dataValues.status == STATUS_PAYMENT_PENDING) {
        booking_transaction.status = STATUS_ADMIN_CANCELLED;
        booking_transaction.updatedBy = req.user.username;
        await booking_transaction.save({ transaction: t });

        if (booking_transaction.dataValues.discount > 0) {
          await ShibirBookingTransaction.create(
            {
              cardno: booking.dataValues.cardno,
              bookingid: bookingid,
              type: TYPE_REFUND,
              amount: booking_transaction.dataValues.discount,
              description: description,
              status: STATUS_AWAITING_REFUND,
              updatedBy: req.user.username
            },
            { transaction: t }
          );
        }
      }

      booking.status = STATUS_ADMIN_CANCELLED;
      booking.updatedBy = req.user.username;
      await booking.save({ transaction: t });

      break;

    case STATUS_PAYMENT_PENDING:
      if (booking.dataValues.status == STATUS_CONFIRMED) {
        booking_transaction.status = STATUS_PAYMENT_PENDING;
        booking_transaction.updatedBy = req.user.username;
        await booking_transaction.save({ transaction: t });

        if (shibir.dataValues.available_seats > 0) {
          shibir.available_seats += 1;
          await shibir.save({ transaction: t });
        }
      } else if (
        booking.dataValues.status == STATUS_WAITING ||
        booking.dataValues.status == STATUS_ADMIN_CANCELLED ||
        booking.dataValues.status == STATUS_CANCELLED
      ) {
        const refund_amounts = await ShibirBookingTransaction.findAll({
          where: {
            cardno: booking.dataValues.cardno,
            type: TYPE_REFUND,
            status: STATUS_AWAITING_REFUND
          }
        });
        if (refund_amounts.length > 0) {
          const amounts = refund_amounts.map(
            (refund) => refund.dataValues.amount
          );
          const targetAmount = shibir.dataValues.amount;
          const { closestSum, closestIndices } = findClosestSum(
            amounts,
            targetAmount
          );

          const bookingIds = [];
          for (var index of closestIndices) {
            await ShibirBookingTransaction.update(
              {
                status: STATUS_PAYMENT_COMPLETED,
                description: `compensated with transactions:${bookingid}`,
                updatedBy: req.user.username
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
                cardno: booking.dataValues.cardno,
                bookingid: bookingid,
                type: TYPE_EXPENSE,
                amount: targetAmount,
                description: `compensated with pending refunds: ${bookingIds}`,
                status: STATUS_PAYMENT_COMPLETED,
                updatedBy: req.user.username
              },
              { transaction: t }
            );
            if (closestSum > targetAmount) {
              await ShibirBookingTransaction.create(
                {
                  cardno: booking.dataValues.cardno,
                  bookingid: bookingid,
                  type: TYPE_REFUND,
                  amount: closestSum - targetAmount,
                  description: `remaining amounts for transactions: ${bookingIds}`,
                  status: STATUS_AWAITING_REFUND,
                  updatedBy: req.user.username
                },
                { transaction: t }
              );
            }
            shibir.available_seats -= 1;
            await shibir.save({ transaction: t });
          } else if (closestSum < targetAmount) {
            await ShibirBookingTransaction.create(
              {
                cardno: booking.dataValues.cardno,
                bookingid: bookingid,
                type: TYPE_EXPENSE,
                amount: targetAmount - closestSum,
                discount: closestSum,
                description: `compensated with pending refunds: ${bookingIds}`,
                status: STATUS_PAYMENT_PENDING,
                updatedBy: req.user.username
              },
              { transaction: t }
            );
          }
        } else {
          await ShibirBookingTransaction.create(
            {
              cardno: booking.dataValues.cardno,
              bookingid: bookingid,
              type: TYPE_EXPENSE,
              amount: shibir.dataValues.amount,
              upi_ref: 'NA',
              status: STATUS_PAYMENT_PENDING,
              updatedBy: req.user.username
            },
            { transaction: t }
          );
        }
      }

      booking.status = STATUS_PAYMENT_PENDING;
      booking.updatedBy = req.user.username;
      await booking.save({ transaction: t });

      break;

    case STATUS_WAITING:
      if (booking.dataValues.status == STATUS_CONFIRMED) {
        booking_transaction.status = STATUS_ADMIN_CANCELLED;
        booking_transaction.updatedBy = req.user.username;
        await booking_transaction.save({ transaction: t });

        if (shibir.dataValues.available_seats > 0) {
          shibir.available_seats += 1;
          await shibir.save({ transaction: t });
        }

        booking_transaction.status = STATUS_ADMIN_CANCELLED;
        booking_transaction.updatedBy = req.user.username;
        await booking_transaction.save({ transaction: t });
      } else if (booking.dataValues.status == STATUS_PAYMENT_PENDING) {
        if (booking_transaction.dataValues.discount > 0) {
          await ShibirBookingTransaction.create(
            {
              cardno: booking.dataValues.cardno,
              bookingid: bookingid,
              type: TYPE_REFUND,
              amount: booking_transaction.dataValues.discount,
              description: description,
              status: STATUS_AWAITING_REFUND,
              updatedBy: req.user.username
            },
            { transaction: t }
          );
        }
        booking_transaction.status = STATUS_ADMIN_CANCELLED;
        booking_transaction.updatedBy = req.user.username;
        await booking_transaction.save({ transaction: t });
      }

      booking.status = STATUS_WAITING;
      booking.updatedBy = req.user.username;
      await booking.save({ transaction: t });

      break;

    default:
      throw new ApiError(400, 'Invalid status provided');
  }

  await t.commit();
  return res.status(200).send({ message: 'Confirmed Booking' });
};

export const openCloseAdhyayan = async (req, res) => {
  const itemUpdated = await ShibirDb.update(
    {
      status: req.params.activate,
      updatedBy: req.user.username
    },
    {
      where: {
        id: req.params.id
      }
    }
  );

  if (itemUpdated != 1)
    throw new ApiError(500, 'Error occured while closing adhyayan');
  res.status(200).send({ message: 'Adhyayan status updated' });
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

//TODO: admin can cancel booking and confirm from waitlist
