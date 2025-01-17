import {
    RoomBooking,
    RoomDb
  } from '../models/associations.js'
import {
  STATUS_WAITING,
  STATUS_AVAILABLE,
  ROOM_STATUS_CHECKEDIN,
  ROOM_STATUS_PENDING_CHECKIN,
  ERR_ROOM_FAILED_TO_BOOK
} from '../config/constants.js';
import Sequelize from 'sequelize';
import { v4 as uuidv4 } from 'uuid';

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

export async function bookDayVisit(cardno, checkin, checkout, transaction) {
  const booking = await RoomBooking.create(
    {
      bookingid: uuidv4(),
      cardno,
      checkin,
      checkout,
      roomno: 'NA',
      roomtype: 'NA',
      gender: 'NA',
      nights: 0,
      status: ROOM_STATUS_PENDING_CHECKIN,      
    },
    { transaction }
  );

  if (!booking) {
    throw new ApiError(400, ERR_ROOM_FAILED_TO_BOOK);
  }
  
  return booking;
}

export async function findRoom(checkin, checkout, room_type, gender) {
  return RoomDb.findOne({
    attributes: ['roomno'],
    where: {
      roomno: {
        [Sequelize.Op.notLike]: 'NA%',
        [Sequelize.Op.notLike]: 'WL%',
        [Sequelize.Op.notIn]: Sequelize.literal(`(
                    SELECT roomno 
                    FROM room_booking 
                    WHERE NOT (checkout <= '${checkin}' OR checkin >= '${checkout}')
                )`),
        [Sequelize.Op.notIn]: Sequelize.literal(`(
                  SELECT roomno 
                  FROM guest_room_booking 
                  WHERE NOT (checkout <= '${checkin}' OR checkin >= '${checkout}')
              )`)
      },
      roomstatus: STATUS_AVAILABLE,
      roomtype: room_type,
      gender: gender
    },
    order: [
      Sequelize.literal(
        `CAST(SUBSTRING(roomno, 1, LENGTH(roomno) - 1) AS UNSIGNED)`
      ),
      Sequelize.literal(`SUBSTRING(roomno, LENGTH(roomno))`)
    ],
    limit: 1
  });
}