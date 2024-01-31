import { RoomBooking, FlatBooking } from '../models/associations.js';
import {
  STATUS_WAITING,
  ROOM_STATUS_CHECKEDIN,
  ROOM_STATUS_PENDING_CHECKIN
} from '../config/constants.js';
import Sequelize from 'sequelize';

export async function checkRoomAlreadyBooked(checkin, checkout, cardno) {
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

export async function checkFlatAlreadyBooked(checkin, checkout, cardno) {
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
      cardno: cardno,
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

export async function calculateNights(checkin, checkout) {
  const date1 = new Date(checkin);
  const date2 = new Date(checkout);

  // Calculate the difference in days
  const timeDifference = date2.getTime() - date1.getTime();
  const nights = Math.ceil(timeDifference / (1000 * 3600 * 24));

  return nights;
}
