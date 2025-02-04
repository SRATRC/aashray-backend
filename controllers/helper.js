import {
  RoomBooking,
  FlatBooking,
  FoodDb,
  ShibirBookingDb,
  ShibirDb
} from '../models/associations.js';
import {
  STATUS_WAITING,
  ROOM_STATUS_CHECKEDIN,
  ROOM_STATUS_PENDING_CHECKIN,
  STATUS_CONFIRMED,
  TYPE_ROOM,
  ERR_INVALID_DATE
} from '../config/constants.js';
import Sequelize from 'sequelize';
import getDates from '../utils/getDates.js';
import moment from 'moment';
import ApiError from '../utils/ApiError.js';
import BlockDates from '../models/block_dates.model.js';

export async function getBlockedDates(checkin_date, checkout_date) {
  const startDate = new Date(checkin_date);
  const endDate = new Date(checkout_date);

  const blockedDates = await BlockDates.findAll({
    where: {
      [Sequelize.Op.or]: [
        {
          [Sequelize.Op.and]: [
            { checkin: { [Sequelize.Op.lte]: startDate } },
            { checkout: { [Sequelize.Op.gte]: startDate } }
          ]
        },
        {
          [Sequelize.Op.and]: [
            { checkin: { [Sequelize.Op.lte]: endDate } },
            { checkout: { [Sequelize.Op.gte]: endDate } }
          ]
        },
        {
          [Sequelize.Op.and]: [
            { checkin: { [Sequelize.Op.gte]: startDate } },
            { checkin: { [Sequelize.Op.lte]: endDate } }
          ]
        }
      ]
    }
  });

  return blockedDates;
}

export async function checkFlatAlreadyBooked(checkin, checkout, card_no) {
  const result = await FlatBooking.findAll({
    where: {
      [Sequelize.Op.or]: [
        {
          [Sequelize.Op.and]: [
            { checkin: { [Sequelize.Op.gte]: checkin } },
            { checkin: { [Sequelize.Op.lt]: checkout } }
          ]
        },
        {
          [Sequelize.Op.and]: [
            { checkout: { [Sequelize.Op.gt]: checkin } },
            { checkout: { [Sequelize.Op.lte]: checkout } }
          ]
        },
        {
          [Sequelize.Op.and]: [
            { checkin: { [Sequelize.Op.lte]: checkin } },
            { checkout: { [Sequelize.Op.gte]: checkout } }
          ]
        }
      ],
      cardno: card_no,
      guest: null
    }
  });

  return result.length > 0;
}

export async function checkFlatAlreadyBookedForGuest(
  checkin,
  checkout,
  guest_id
) {
  const result = await FlatBooking.findAll({
    where: {
      [Sequelize.Op.or]: [
        {
          [Sequelize.Op.and]: [
            { checkin: { [Sequelize.Op.gte]: checkin } },
            { checkin: { [Sequelize.Op.lt]: checkout } }
          ]
        },
        {
          [Sequelize.Op.and]: [
            { checkout: { [Sequelize.Op.gt]: checkin } },
            { checkout: { [Sequelize.Op.lte]: checkout } }
          ]
        },
        {
          [Sequelize.Op.and]: [
            { checkin: { [Sequelize.Op.lte]: checkin } },
            { checkout: { [Sequelize.Op.gte]: checkout } }
          ]
        }
      ],
      guest: guest_id
    }
  });

  return result.length > 0;
}

export async function calculateNights(checkin, checkout) {
  const date1 = new Date(checkin);
  const date2 = new Date(checkout);

  // Calculate the difference in days
  const timeDifference = date2.getTime() - date1.getTime();
  const nights = Math.ceil(timeDifference / (1000 * 3600 * 24));

  return nights;
}

export async function isFoodBooked(start_date, end_date, cardno) {
  const startDate = new Date(start_date);
  const endDate = new Date(end_date);

  const allDates = getDates(startDate, endDate);

  const food_bookings = await FoodDb.findAll({
    where: {
      cardno: cardno,
      date: allDates
    }
  });

  return food_bookings.length > 0;
}

export function validateDate(start_date, end_date) {
  const today = moment().format('YYYY-MM-DD');
  const checkinDate = new Date(start_date);
  const checkoutDate = new Date(end_date);
  if (today > start_date || today > end_date || checkinDate > checkoutDate) {
    throw new ApiError(400, ERR_INVALID_DATE);
  }
}

export async function checkSpecialAllowance(start_date, end_date, cardno) {
  const adhyayans = await ShibirBookingDb.findAll({
    include: [
      {
        model: ShibirDb,
        where: {
          start_date: {
            [Sequelize.Op.lte]: start_date
          },
          end_date: {
            [Sequelize.Op.gte]: end_date
          }
        }
      }
    ],
    where: {
      cardno: cardno,
      guest: null,
      status: STATUS_CONFIRMED
    }
  });

  for (var data of adhyayans) {
    if (data.dataValues.ShibirDb.dataValues.food_allowed == 1) return true;
  }

  return false;
}

export async function checkRoomBookingProgress(
  start_date,
  end_date,
  primary_booking,
  addons
) {
  var addon = addons && addons.find((addon) => addon.booking_type == TYPE_ROOM);

  if ((primary_booking && primary_booking.booking_type == TYPE_ROOM) || addon) {
    const startDate = new Date(start_date);
    const endDate = new Date(end_date);
    const checkinDate = new Date(
      primary_booking.details.checkin_date || addon.details.checkin_date
    );
    const checkoutDate = new Date(
      primary_booking.details.checkout_date || addon.details.checkout_date
    );

    return startDate >= checkinDate && endDate <= checkoutDate;
  }

  return false;
}

export function findClosestSum(arr, target) {
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

export async function checkGuestRoomAlreadyBooked(
  checkin,
  checkout,
  cardno,
  guests
) {
  const result = await RoomBooking.findAll({
    where: {
      [Sequelize.Op.or]: [
        {
          [Sequelize.Op.and]: [
            { checkin: { [Sequelize.Op.gte]: checkin } },
            { checkin: { [Sequelize.Op.lt]: checkout } }
          ]
        },
        {
          [Sequelize.Op.and]: [
            { checkout: { [Sequelize.Op.gt]: checkin } },
            { checkout: { [Sequelize.Op.lte]: checkout } }
          ]
        },
        {
          [Sequelize.Op.and]: [
            { checkin: { [Sequelize.Op.lte]: checkin } },
            { checkout: { [Sequelize.Op.gte]: checkout } }
          ]
        }
      ],
      cardno: cardno,
      guest: guests,
      status: {
        [Sequelize.Op.in]: [
          STATUS_WAITING,
          ROOM_STATUS_CHECKEDIN,
          ROOM_STATUS_PENDING_CHECKIN
        ]
      }
    }
  });

  if (result.length > 0) {
    return true;
  } else {
    return false;
  }
}

export async function checkGuestFoodAlreadyBooked(
  start_date,
  end_date,
  guests
) {
  const startDate = new Date(start_date);
  const endDate = new Date(end_date);

  const allDates = getDates(startDate, endDate);
  const food_bookings = await FoodDb.findAll({
    where: {
      date: { [Sequelize.Op.in]: allDates },
      guest: { [Sequelize.Op.in]: guests }
    }
  });

  if (food_bookings.length > 0) return true;
  else return false;
}

export async function checkGuestSpecialAllowance(start_date, end_date, guests) {
  const adhyayans = await ShibirBookingDb.findAll({
    include: [
      {
        model: ShibirDb,
        where: {
          start_date: {
            [Sequelize.Op.lte]: start_date
          },
          end_date: {
            [Sequelize.Op.gte]: end_date
          }
        }
      }
    ],
    where: {
      guest: guests,
      status: STATUS_CONFIRMED
    }
  });

  if (adhyayans) {
    for (var data of adhyayans) {
      if (data.dataValues.ShibirDb.dataValues.food_allowed == 1) return true;
    }
  }

  return false;
}
