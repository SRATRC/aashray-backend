import {
  STATUS_WAITING,
  STATUS_AVAILABLE,
  ROOM_STATUS_CHECKEDIN,
  ROOM_STATUS_PENDING_CHECKIN,
  ERR_ROOM_FAILED_TO_BOOK,
  NAC_ROOM_PRICE,
  AC_ROOM_PRICE,
  TYPE_ROOM,
  ERR_ROOM_NO_BED_AVAILABLE,
  ERR_ROOM_ALREADY_BOOKED,
  STATUS_CANCELLED,
  STATUS_ADMIN_CANCELLED,
  TYPE_FLAT,
  STATUS_PAYMENT_PENDING,
  STATUS_CASH_PENDING,
  ERR_FLAT_FAILED_TO_BOOK
} from '../config/constants.js';
import { RoomBooking, RoomDb, UtsavDb, FlatBooking, FlatDb } from '../models/associations.js';
import { createPendingTransaction } from './transactions.helper.js';
import { calculateNights, validateDate } from '../controllers/helper.js';
import { v4 as uuidv4 } from 'uuid';
import { validateCards } from './card.helper.js';
import Sequelize from 'sequelize';
import ApiError from '../utils/ApiError.js';

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
        STATUS_PAYMENT_PENDING,
        ROOM_STATUS_CHECKEDIN,
        ROOM_STATUS_PENDING_CHECKIN
      ]
    }
  });

  return result.length > 0;
}

export async function bookDayVisit(
  cardno, 
  checkin, 
  checkout,
  bookedBy,
  updatedBy,
  t
  ) {
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
      bookedBy,
      updatedBy
    },
    { transaction: t }
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
                    AND status NOT IN ('${STATUS_CANCELLED}', '${STATUS_ADMIN_CANCELLED}')
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

export async function findAllRooms(checkin, checkout, room_type, gender) {
  const bookings = await RoomBooking.findAll({
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
      status: { [Sequelize.Op.notIn]: [STATUS_CANCELLED, STATUS_ADMIN_CANCELLED] } 
    }
  });
  const bookedRooms = bookings.map(x => x.roomno);

  return RoomDb.findAll({
    where: {
      roomno: {
        [Sequelize.Op.notLike]: 'NA%',
        [Sequelize.Op.notLike]: 'WL%',
        [Sequelize.Op.notIn]: bookedRooms
      },
      roomstatus: STATUS_AVAILABLE,
      roomtype: room_type,
      ...(gender && { gender })
    },
    order: [
      Sequelize.literal(
        `CAST(SUBSTRING(roomno, 1, LENGTH(roomno) - 1) AS UNSIGNED)`
      ),
      Sequelize.literal(`SUBSTRING(roomno, LENGTH(roomno))`)
    ]
  });
}

export async function bookRoomForMumukshus(
  checkin_date,
  checkout_date,
  mumukshuGroup,
  t,
  user
) {
  validateDate(checkin_date, checkout_date);

  const mumukshus = mumukshuGroup.flatMap((group) => group.mumukshus);
  const cardDb = await validateCards(mumukshus);

  if (await checkRoomAlreadyBooked(checkin_date, checkout_date, ...mumukshus)) {
    throw new ApiError(400, ERR_ROOM_ALREADY_BOOKED);
  }

  const nights = await calculateNights(checkin_date, checkout_date);

  let amount = 0;
  let userBookingIds = {};
  for (const group of mumukshuGroup) {
    const { roomType, floorType, mumukshus } = group;

    for (const mumukshu of mumukshus) {
      const card = cardDb.filter((item) => item.cardno == mumukshu)[0];
      const bookedBy = card.cardno == user.cardno ? null : user.cardno;

      if (nights == 0) {
        const result = await bookDayVisit(
          card.cardno,
          checkin_date,
          checkout_date,
          bookedBy,
          user.cardno,
          t
        );
        userBookingIds[card.cardno]=[result.bookingid];
      } else {
        const result = await createRoomBooking(
          card.cardno,
          checkin_date,
          checkout_date,
          nights,
          roomType,
          card.gender,
          floorType,
          user.cardno,
          t
        );

        amount += result.discountedAmount;
        userBookingIds[card.cardno] = [result.bookingId];
      }
    }
  }
  return { amount, userBookingIds };
}

export async function createRoomBooking(
  cardno,
  checkin,
  checkout,
  nights,
  roomtype,
  user_gender,
  floor_pref,
  bookedBy,
  t,
  cashAllowed = false
) {
  const gender = floor_pref ? floor_pref + user_gender : user_gender;
  const roomno = await findRoom(checkin, checkout, roomtype, gender);
  if (!roomno) {
    throw new ApiError(400, ERR_ROOM_NO_BED_AVAILABLE);
  }
  let bookingId = uuidv4();
  const booking = await RoomBooking.create(
    {
      bookingid: bookingId,
      roomno: roomno.dataValues.roomno,
      status: STATUS_PAYMENT_PENDING,
      cardno,
      bookedBy: bookedBy !== cardno ? bookedBy : null,
      checkin,
      checkout,
      nights,
      roomtype,
      gender,
      updatedBy: bookedBy
    },
    { transaction: t }
  );

  if (!booking) {
    throw new ApiError(400, ERR_ROOM_FAILED_TO_BOOK);
  }

  const amount = roomCharge(roomtype) * nights;

  const {transaction,discountedAmount} = await createPendingTransaction(
    bookedBy,
    booking,
    TYPE_ROOM,
    amount,
    bookedBy,
    t,
    cashAllowed
  );

  if (!transaction) {
    throw new ApiError(400, ERR_ROOM_FAILED_TO_BOOK);
  }

  return { t, discountedAmount, bookingId };
}

export function roomCharge(roomtype) {
  return roomtype == 'nac' ? NAC_ROOM_PRICE : AC_ROOM_PRICE;
}

export async function bookRoomDuringUtsavForGuests(
  utsavid,
  guestGroup,
  t,
  user,
  checkin_date,
  checkout_date
) {
  let userBookingIds = {};
  const utsav = await UtsavDb.findOne({
    where: { id: utsavid }
  });

  const guests = guestGroup.flatMap((group) => group.guests);
  const cardDb = await validateCards(guests);

  let amount = 0;

  
  for (const group of guestGroup) {
    const { roomType, floorType, guests } =
      group;

    if (await checkRoomAlreadyBooked(checkin_date, checkout_date, ...guests)) {
      throw new ApiError(400, ERR_ROOM_ALREADY_BOOKED);
    }

    const event_start_date = utsav.start_date;
    const event_end_date = utsav.end_date;
   
    for (const guest of guests) {
      let bookingIds = [];
      const card = cardDb.find((item) => item.cardno == guest);
       
      
      // Handle booking before event starts
      if (new Date(checkin_date) < new Date(event_start_date)) {
        const beforeNights = await calculateNights(
          checkin_date,
          event_start_date
        );

        if (beforeNights > 0) {
          const lastNightBeforeEvent = new Date(event_start_date);
          lastNightBeforeEvent.setDate(lastNightBeforeEvent.getDate() - 1);

          if (beforeNights > 1) {
            const result = await createRoomBooking(
              card.cardno,
              checkin_date,
              lastNightBeforeEvent.toISOString().split('T')[0],
              beforeNights - 1,
              roomType,
              card.gender,
              floorType,
              user.cardno,
              t
            );
            amount += result.discountedAmount;
            bookingIds.push(result.bookingId);
          }

          // Create a waiting booking for the night exactly before event starts
          let waitingBookingId = uuidv4();
          const gender = floorType ? floorType + card.gender : card.gender;
           await RoomBooking.create(
            {
              bookingid: waitingBookingId,
              cardno: card.cardno,
              bookedBy: card.cardno !== user.cardno ? user.cardno : null,
              roomno: 'NA',
              checkin: lastNightBeforeEvent.toISOString().split('T')[0],
              checkout: event_start_date,
              nights: 1,
              roomtype: roomType,
              gender: gender,
              status: STATUS_WAITING,
              updatedBy: user.cardno
            },
            { transaction: t }
          );
         
          bookingIds.push(waitingBookingId);
        }
      }

      // Handle booking after event ends
      if (new Date(checkout_date) > new Date(event_end_date)) {
        const afterNights = await calculateNights(
          event_end_date,
          checkout_date
        );

        if (afterNights > 0) {
          const result = await createRoomBooking(
            card.cardno,
            event_end_date,
            checkout_date,
            afterNights,
            roomType,
            card.gender,
            floorType,
            user.cardno,
            t
          );
          amount += result.discountedAmount;
          bookingIds.push(result.bookingId);
        }
      }
      userBookingIds[card.cardno] = bookingIds;
    }
  }
  return { t, amount, userBookingIds };
}

export async function bookRoomDuringUtsavForMumukshus(
  utsavid,
  mumukshuGroup,
  t,
  user
) {
  const utsav = await UtsavDb.findOne({
    where: { id: utsavid }
  });

  const mumukshus = mumukshuGroup.flatMap((group) => group.mumukshus);
  const cardDb = await validateCards(mumukshus);

  let amount = 0;

  let userBookingIds = {};
  for (const group of mumukshuGroup) {
    const { roomType, floorType, checkin_date, checkout_date, mumukshus } =
      group;

    if (await checkRoomAlreadyBooked(checkin_date, checkout_date, ...mumukshus)) {
      throw new ApiError(400, ERR_ROOM_ALREADY_BOOKED);
    }

    const event_start_date = utsav.start_date;
    const event_end_date = utsav.end_date;

    for (const mumukshu of mumukshus) {

      let bookingIds = [];
      const card = cardDb.find((item) => item.cardno == mumukshu);

      // Handle booking before event starts
      if (new Date(checkin_date) < new Date(event_start_date)) {
        const beforeNights = await calculateNights(
          checkin_date,
          event_start_date
        );

        if (beforeNights > 0) {
          const lastNightBeforeEvent = new Date(event_start_date);
          lastNightBeforeEvent.setDate(lastNightBeforeEvent.getDate() - 1);

          if (beforeNights > 1) {
            const result = await createRoomBooking(
              card.cardno,
              checkin_date,
              lastNightBeforeEvent.toISOString().split('T')[0],
              beforeNights - 1,
              roomType,
              card.gender,
              floorType,
              user.cardno,
              t
            );
            amount += result.discountedAmount;
            bookingIds.push(result.bookingId);
          }

          // Create a waiting booking for the night exactly before event starts
          let waitingBookingId = uuidv4();
          const gender = floorType ? floorType + card.gender : card.gender;
          await RoomBooking.create(
            {
              bookingid: waitingBookingId,
              cardno: card.cardno,
              bookedBy: card.cardno !== user.cardno ? user.cardno : null,
              roomno: 'NA',
              checkin: lastNightBeforeEvent.toISOString().split('T')[0],
              checkout: event_start_date,
              nights: 1,
              roomtype: roomType,
              gender: gender,
              status: STATUS_WAITING,
              updatedBy: user.cardno
            },
            { transaction: t }
          );

          
          bookingIds.push(waitingBookingId);
        }
      }

      // Handle booking after event ends
      if (new Date(checkout_date) > new Date(event_end_date)) {
        const afterNights = await calculateNights(
          event_end_date,
          checkout_date
        );

        if (afterNights > 0) {
          const result = await createRoomBooking(
            card.cardno,
            event_end_date,
            checkout_date,
            afterNights,
            roomType,
            card.gender,
            floorType,
            user.cardno,
            t
          );
          amount += result.discountedAmount;
          bookingIds.push(result.bookingId);
        }
      }
      userBookingIds[card.cardno] = bookingIds;
    }
    
  }

  return { t, amount, userBookingIds };
}


export async function createFlatBooking(
  cardno, 
  checkin, 
  checkout, 
  nights, 
  flatno, 
  updatedBy, 
  t,
  cashAllowed = false
) {
  let bookingId = uuidv4();
  let status = cashAllowed 
    ? STATUS_CASH_PENDING
    : STATUS_PAYMENT_PENDING;

  const mumukshuIsFlatOwner = await isMumukshuFlatOwner(cardno, flatno);
  if (mumukshuIsFlatOwner) {
    status = ROOM_STATUS_PENDING_CHECKIN;
  }

  const booking = await FlatBooking.create(
    { 
      bookingid: bookingId,
      cardno, 
      flatno, 
      checkin, 
      checkout, 
      nights, 
      updatedBy, 
      status
    },
    { transaction: t }
  );

  if (!booking) {
    throw new ApiError(400, ERR_FLAT_FAILED_TO_BOOK); 
  }

  let discountedAmount = 0; 
  if (!mumukshuIsFlatOwner) {
     // Check if flat is AC or NAC
    let amount = roomCharge("nac") * nights;

    const result = await createPendingTransaction(
      cardno,
      booking, 
      TYPE_FLAT, 
      amount, 
      updatedBy, 
      t,
      cashAllowed
    ); 

    discountedAmount = result.discountedAmount;
  }

  return { t, discountedAmount, bookingId };
}

async function isMumukshuFlatOwner(cardno, flatno) {
  const flat = await FlatDb.findOne(
    { 
      attributes: ['flatno'],
      where: { 
        owner: cardno, 
        flatno: flatno 
      } 
    }
  );

  return flat ? true : false;
}