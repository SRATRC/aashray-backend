import {
    RoomBooking
  } from '../../models/associations.js'
import {
  STATUS_WAITING,
  ROOM_STATUS_CHECKEDIN,
  ROOM_STATUS_PENDING_CHECKIN
} from '../../config/constants.js';
import Sequelize from 'sequelize';

export async function checkRoomAlreadyBooked(checkin, checkout, ...cardnos) {
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
    cardno: cardnos,
    status: [
        STATUS_WAITING,
        ROOM_STATUS_CHECKEDIN,
        ROOM_STATUS_PENDING_CHECKIN
    ]
    }
});

if (result.length > 0) {
    return true;
} else {
    return false;
}
}