import {
  ShibirDb,
  ShibirBookingDb,
  RoomBooking,
  FlatBooking,
  FlatDb,
  FoodDb,
  Transactions,
  CardDb,
  GuestRelationship
} from '../../models/associations.js';
import {
  ROOM_STATUS_PENDING_CHECKIN,
  STATUS_PAYMENT_PENDING,
  TYPE_EXPENSE,
  STATUS_AVAILABLE,
  TYPE_ROOM,
  STATUS_CONFIRMED,
  STATUS_WAITING,
  TYPE_FOOD,
  TYPE_ADHYAYAN,
  TYPE_GUEST_ADHYAYAN,
  RAZORPAY_FEE,
  ERR_INVALID_BOOKING_TYPE,
  ERR_ROOM_NO_BED_AVAILABLE,
  ERR_ROOM_ALREADY_BOOKED,
  ERR_ROOM_FAILED_TO_BOOK,
  ERR_ADHYAYAN_ALREADY_BOOKED,
  ERR_ADHYAYAN_NOT_FOUND,
  LUNCH_PRICE,
  BREAKFAST_PRICE,
  DINNER_PRICE,
  MSG_BOOKING_SUCCESSFUL,
  MSG_UPDATE_SUCCESSFUL,
  TYPE_GUEST_BREAKFAST,
  TYPE_GUEST_LUNCH,
  TYPE_GUEST_DINNER,
  STATUS_GUEST,
  TYPE_GUEST_ROOM
} from '../../config/constants.js';
import {
  calculateNights,
  validateDate,
  checkGuestRoomAlreadyBooked,
  checkFlatAlreadyBookedForGuest,
  sendUnifiedEmail,
  createGuestsHelper
} from '../helper.js';
import { v4 as uuidv4 } from 'uuid';
import { findRoom, roomCharge } from '../../helpers/roomBooking.helper.js';
import {
  createPendingTransaction,
  generateOrderId
} from '../../helpers/transactions.helper.js';
import database from '../../config/database.js';
import Sequelize from 'sequelize';
import getDates from '../../utils/getDates.js';
import ApiError from '../../utils/ApiError.js';

export const guestBooking = async (req, res) => {
  const { primary_booking, addons } = req.body;
  var t = await database.transaction();
  req.transaction = t;

  let amount = 0;
  var bookingIdMap = {};

  switch (primary_booking.booking_type) {
    case TYPE_ROOM:
      const roomResult = await bookRoom(
        primary_booking,
        t,
        req.user,
        bookingIdMap
      );
      t = roomResult.t;
      amount += roomResult.amount;
      break;

    case TYPE_FOOD:
      const foodResult = await bookFood(primary_booking, t, req.user);
      t = foodResult.t;
      amount += foodResult.amount;
      break;

    case TYPE_ADHYAYAN:
      const adhyayanResult = await bookAdhyayan(
        primary_booking,
        t,
        req.user,
        bookingIdMap
      );
      t = adhyayanResult.t;
      amount += adhyayanResult.amount;
      break;

    default:
      throw new ApiError(400, ERR_INVALID_BOOKING_TYPE);
  }

  if (addons) {
    for (const addon of addons) {
      switch (addon.booking_type) {
        case TYPE_ROOM:
          const roomResult = await bookRoom(addon, t, req.user, bookingIdMap);
          t = roomResult.t;
          amount += roomResult.amount;
          break;

        case TYPE_FOOD:
          const foodResult = await bookFood(addon, t, req.user);
          t = foodResult.t;
          amount += foodResult.amount;
          break;

        case TYPE_ADHYAYAN:
          const adhyayanResult = await bookAdhyayan(
            addon,
            t,
            req.user,
            bookingIdMap
          );
          t = adhyayanResult.t;
          amount += adhyayanResult.amount;
          break;

        default:
          throw new ApiError(400, ERR_INVALID_BOOKING_TYPE);
      }
    }
  }

  const order = await generateOrderId(amount);

  await t.commit();
  sendUnifiedEmail(req.user, bookingIdMap);
  return res.status(200).send({ message: MSG_BOOKING_SUCCESSFUL, data: order });
};

export const validateBooking = async (req, res) => {
  const { primary_booking, addons } = req.body;

  var roomDetails = [];
  var adhyayanDetails = [];
  var foodDetails = {};
  var totalCharge = 0;

  switch (primary_booking.booking_type) {
    case TYPE_ROOM:
      roomDetails = await checkRoomAvailability(
        req.user,
        req.body.primary_booking
      );
      totalCharge += roomDetails.reduce(
        (partialSum, room) => partialSum + room.charge,
        0
      );
      break;

    case TYPE_FOOD:
      foodDetails = await checkFoodAvailability(req.body.primary_booking);
      totalCharge += foodDetails.charge;
      break;

    case TYPE_ADHYAYAN:
      adhyayanDetails = await checkAdhyayanAvailability(
        req.user,
        req.body.primary_booking
      );
      totalCharge += adhyayanDetails.reduce(
        (partialSum, adhyayan) => partialSum + adhyayan.charge,
        0
      );
      break;

    default:
      throw new ApiError(400, ERR_INVALID_BOOKING_TYPE);
  }

  if (addons) {
    for (const addon of addons) {
      switch (addon.booking_type) {
        case TYPE_ROOM:
          roomDetails = await checkRoomAvailability(req.user, addon);
          totalCharge += roomDetails.reduce(
            (partialSum, room) => partialSum + room.charge,
            0
          );
          break;

        case TYPE_FOOD:
          foodDetails = await checkFoodAvailability(addon);
          totalCharge += foodDetails.charge;
          break;

        case TYPE_ADHYAYAN:
          adhyayanDetails = await checkAdhyayanAvailability(req.user, addon);
          totalCharge += adhyayanDetails.reduce(
            (partialSum, adhyayan) => partialSum + adhyayan.charge,
            0
          );
          break;

        default:
          throw new ApiError(400, ERR_INVALID_BOOKING_TYPE);
      }
    }
  }

  const taxes = Math.round(totalCharge * RAZORPAY_FEE * 100) / 100;
  return res.status(200).send({
    data: {
      roomDetails: roomDetails,
      adhyayanDetails: adhyayanDetails,
      foodDetails: foodDetails,
      taxes: taxes,
      totalCharge: totalCharge + taxes
    }
  });
};

async function checkRoomAvailability(user, data) {
  const { checkin_date, checkout_date, guestGroup } = data.details;

  validateDate(checkin_date, checkout_date);
  const nights = await calculateNights(checkin_date, checkout_date);

  const totalGuests = guestGroup.flatMap((group) => group.guests);
  const guest_db = await CardDb.findAll({
    attributes: ['cardno', 'issuedto', 'gender'],
    where: { cardno: totalGuests }
  });
  const guest_details = guest_db.map((guest) => guest.dataValues);

  if (
    await checkGuestRoomAlreadyBooked(
      checkin_date,
      checkout_date,
      user.cardno,
      totalGuests
    )
  ) {
    throw new ApiError(400, ERR_ROOM_ALREADY_BOOKED);
  }

  var roomDetails = [];
  for (const group of guestGroup) {
    const { roomType, floorType, guests } = group;

    for (const guest of guests) {
      var status = STATUS_WAITING;
      var charge = 0;

      const gender = floorType
        ? floorType +
          guest_details.filter((item) => item.cardno == guest)[0].gender
        : guest_details.filter((item) => item.cardno == guest)[0].gender;

      if (nights > 0) {
        const room = await findRoom(
          checkin_date,
          checkout_date,
          roomType,
          gender
        );

        if (room) {
          status = STATUS_AVAILABLE;
          charge = roomCharge(roomType) * nights;
        }
      } else {
        status = STATUS_AVAILABLE;
        charge = 0;
      }

      roomDetails.push({
        guestId: guest,
        status,
        charge
      });
    }
  }

  return roomDetails;
}

async function bookRoom(data, t, user, bookingIdMap) {
  const { checkin_date, checkout_date, guestGroup } = data.details;

  validateDate(checkin_date, checkout_date);

  let amount = 0;
  let bookingIds = [],
    idx = 0;
  const nights = await calculateNights(checkin_date, checkout_date);
  const totalGuests = guestGroup.flatMap((group) => group.guests);

  const guest_db = await CardDb.findAll({
    attributes: ['cardno', 'issuedto', 'gender'],
    where: { cardno: totalGuests, res_status: STATUS_GUEST }
  });
  const guest_details = guest_db.map((guest) => guest.dataValues);

  if (
    await checkGuestRoomAlreadyBooked(checkin_date, checkout_date, totalGuests)
  ) {
    throw new ApiError(400, ERR_ROOM_ALREADY_BOOKED);
  }

  for (const group of guestGroup) {
    const { roomType, floorType, guests } = group;

    for (const guest of guests) {
      if (nights == 0) {
        await bookDayVisitForGuest(user, guest, checkin_date, checkout_date, t);
      } else {
        const result = await bookRoomForSingleGuest(
          user,
          guest,
          guest_details,
          checkin_date,
          checkout_date,
          roomType,
          floorType,
          nights,
          t
        );
        t = result.t;
        amount += result.discountedAmount;
        bookingIds[idx++] = result.bookingId;
      }
    }
  }
  bookingIdMap[TYPE_ROOM] = bookingIds;
  return { t, amount };
}

async function bookDayVisitForGuest(
  user,
  guest,
  checkin,
  checkout,
  transaction
) {
  const booking = await RoomBooking.create(
    {
      bookingid: uuidv4(),
      cardno: guest,
      bookedBy: user.cardno,
      roomno: 'NA',
      roomtype: 'NA',
      gender: 'NA',
      nights: 0,
      checkin,
      checkout,
      status: ROOM_STATUS_PENDING_CHECKIN,
      updatedBy: user.cardno
    },
    { transaction }
  );

  if (!booking) {
    throw new ApiError(400, ERR_ROOM_FAILED_TO_BOOK);
  }

  return booking;
}

async function bookRoomForSingleGuest(
  user,
  guest,
  guest_details,
  checkin,
  checkout,
  roomtype,
  floor_type,
  nights,
  t
) {
  const gender = floor_type
    ? floor_type +
      guest_details.filter((item) => item.cardno == guest)[0].gender
    : guest_details.filter((item) => item.cardno == guest)[0].gender;

  const roomno = await findRoom(checkin, checkout, roomtype, gender);

  if (!roomno) {
    throw new ApiError(400, ERR_ROOM_NO_BED_AVAILABLE);
  }

  let bookingId = uuidv4();
  const booking = await RoomBooking.create(
    {
      bookingid: bookingId,
      cardno: guest,
      bookedBy: user.cardno,
      roomno: roomno.dataValues.roomno,
      checkin,
      checkout,
      nights,
      roomtype,
      gender,
      status: ROOM_STATUS_PENDING_CHECKIN,
      updatedBy: user.cardno
    },
    { transaction: t }
  );

  if (!booking) {
    throw new ApiError(400, ERR_ROOM_FAILED_TO_BOOK);
  }

  const amount = roomCharge(roomtype) * nights;

  const { transaction, discountedAmount } = await createPendingTransaction(
    booking.cardno,
    booking,
    TYPE_GUEST_ROOM,
    amount,
    user.cardno,
    t
  );

  if (!transaction) {
    throw new ApiError(400, ERR_ROOM_FAILED_TO_BOOK);
  }

  return { t, discountedAmount, bookingId };
}

async function checkFoodAvailability(data) {
  const { start_date, end_date, guestGroup } = data.details;

  validateDate(start_date, end_date);

  const totalGuests = guestGroup.flatMap((group) => group.guests);

  const allDates = getDates(start_date, end_date);
  var charge = 0;

  const bookings = await FoodDb.findAll({
    where: {
      date: allDates,
      guest: totalGuests
    }
  });

  let bookingsByGuest = {};
  for (const booking of bookings) {
    bookingsByGuest[booking.guest] ||= {};
    bookingsByGuest[booking.guest][booking.date] = booking;
  }

  for (const group of guestGroup) {
    const { meals, guests } = group;

    for (const date of allDates) {
      for (const guest of guests) {
        const booking = bookingsByGuest[guest]
          ? bookingsByGuest[guest][date]
          : null;

        if (booking) {
          // Only charge for meals that weren't previously booked
          charge +=
            meals.includes('breakfast') && !booking.breakfast
              ? BREAKFAST_PRICE
              : 0;
          charge += meals.includes('lunch') && !booking.lunch ? LUNCH_PRICE : 0;
          charge +=
            meals.includes('dinner') && !booking.dinner ? DINNER_PRICE : 0;
        } else {
          // Charge for all new meals
          charge += meals.includes('breakfast') ? BREAKFAST_PRICE : 0;
          charge += meals.includes('lunch') ? LUNCH_PRICE : 0;
          charge += meals.includes('dinner') ? DINNER_PRICE : 0;
        }
      }
    }
  }

  return {
    status: STATUS_AVAILABLE,
    charge
  };
}

async function bookFood(data, t, user) {
  const meals_object = [
    {
      name: 'breakfast',
      price: BREAKFAST_PRICE,
      type: TYPE_GUEST_BREAKFAST
    },
    { name: 'lunch', price: LUNCH_PRICE, type: TYPE_GUEST_LUNCH },
    { name: 'dinner', price: DINNER_PRICE, type: TYPE_GUEST_DINNER }
  ];

  const { start_date, end_date, guestGroup } = data.details;
  let amount = 0;

  validateDate(start_date, end_date);

  const guests = guestGroup.flatMap((group) => group.guests);
  const guestDb = await CardDb.findAll({
    where: { cardno: guests, res_status: STATUS_GUEST },
    attributes: ['cardno']
  });

  if (guestDb.length != guests.length) {
    throw new ApiError(404, 'Guest not found');
  }

  const allDates = getDates(start_date, end_date);
  const bookings = await FoodDb.findAll({
    where: {
      date: allDates,
      cardno: guests
    }
  });

  let bookingsByCard = {};
  for (const booking of bookings) {
    bookingsByCard[booking.cardno] ||= {};
    bookingsByCard[booking.cardno][booking.date] = booking;
  }

  var bookingsToCreate = [];
  var transactionsToCreate = [];
  for (const group of guestGroup) {
    const { meals, spicy, high_tea, guests } = group;

    const breakfast = meals.includes('breakfast');
    const lunch = meals.includes('lunch');
    const dinner = meals.includes('dinner');

    const mealSelections = { breakfast, lunch, dinner };

    for (const guest of guests) {
      for (const date of allDates) {
        const booking = bookingsByCard[guest]
          ? bookingsByCard[guest][date]
          : null;

        if (booking) {
          // Only charge for meals that weren't previously booked
          meals_object.forEach((meal) => {
            if (mealSelections[meal.name] && !booking[meal.name]) {
              amount += meal.price;

              transactionsToCreate.push({
                cardno: user.cardno,
                bookingid: booking.dataValues.id,
                category: meal.type,
                amount: meal.price,
                status: STATUS_PAYMENT_PENDING,
                updatedBy: user.cardno
              });
            }
          });

          await booking.update(
            {
              breakfast: booking.breakfast || breakfast,
              lunch: booking.lunch || lunch,
              dinner: booking.dinner || dinner,
              hightea: high_tea,
              spicy,
              updatedBy: user.cardno
            },
            { transaction: t }
          );
        } else {
          const bookingId = uuidv4();

          bookingsToCreate.push({
            id: bookingId,
            cardno: guest,
            bookedBy: user.cardno,
            date,
            breakfast,
            lunch,
            dinner,
            spicy,
            hightea: high_tea,
            plateissued: 0,
            updatedBy: user.cardno
          });

          meals_object.forEach((meal) => {
            if (mealSelections[meal.name]) {
              amount += meal.price;

              transactionsToCreate.push({
                cardno: user.cardno,
                bookingid: bookingId,
                category: meal.type,
                amount: meal.price,
                status: STATUS_PAYMENT_PENDING,
                updatedBy: user.cardno
              });
            }
          });
        }
      }
    }
  }

  await FoodDb.bulkCreate(bookingsToCreate, { transaction: t });
  await Transactions.bulkCreate(transactionsToCreate, { transaction: t });
  return { t, amount };
}

async function checkAdhyayanAvailability(user, data) {
  const { shibir_ids, guests } = data.details;

  const shibirs = await ShibirDb.findAll({
    where: {
      id: {
        [Sequelize.Op.in]: shibir_ids
      }
    }
  });

  if (shibirs.length != shibir_ids.length) {
    throw new ApiError(400, ERR_ADHYAYAN_NOT_FOUND);
  }

  var adhyayanDetails = [];
  for (var shibir of shibirs) {
    var available = guests.length;
    var waiting = 0;
    var charge = 0;

    if (shibir.dataValues.available_seats < guests.length) {
      available = shibir.dataValues.available_seats;
      waiting = guests.length - shibir.dataValues.available_seats;
    }
    charge = available * shibir.dataValues.amount;

    adhyayanDetails.push({
      shibirId: shibir.dataValues.id,
      available: available,
      waiting: waiting,
      charge: charge
    });
  }

  return adhyayanDetails;
}

async function bookAdhyayan(data, t, user, bookingIdMap) {
  const { shibir_ids, guests } = data.details;
  let amount = 0,
    idx = 0;

  const isBooked = await ShibirBookingDb.findAll({
    where: {
      shibir_id: shibir_ids,
      cardno: guests,
      status: [STATUS_CONFIRMED, STATUS_WAITING, STATUS_PAYMENT_PENDING]
    }
  });

  if (isBooked.length > 0) {
    throw new ApiError(400, ERR_ADHYAYAN_ALREADY_BOOKED);
  }

  const shibirs = await ShibirDb.findAll({
    where: {
      id: {
        [Sequelize.Op.in]: shibir_ids
      }
    }
  });

  if (shibirs.length != shibir_ids.length) {
    throw new ApiError(400, ERR_ADHYAYAN_NOT_FOUND);
  }

  var booking_data = [];
  var transaction_data = [];
  var bookingIds = [];
  for (const guest of guests) {
    for (var shibir of shibirs) {
      const bookingid = uuidv4();
      bookingIds[idx++] = bookingid;
      if (shibir.dataValues.available_seats > 0) {
        booking_data.push({
          bookingid: bookingid,
          shibir_id: shibir.dataValues.id,
          cardno: guest,
          bookedBy: user.cardno,
          status: STATUS_PAYMENT_PENDING,
          updatedBy: user.cardno
        });

        shibir.available_seats -= 1;
        await shibir.save({ transaction: t });

        transaction_data.push({
          cardno: user.cardno,
          bookingid: bookingid,
          category: TYPE_GUEST_ADHYAYAN,
          type: TYPE_EXPENSE,
          amount: shibir.dataValues.amount,
          status: STATUS_PAYMENT_PENDING,
          updatedBy: user.cardno
        });

        amount += shibir.dataValues.amount;
      } else {
        bookingIds[idx++] = bookingid;
        booking_data.push({
          bookingid: bookingid,
          shibir_id: shibir.dataValues.id,
          cardno: guest,
          bookedBy: user.cardno,
          status: STATUS_WAITING,
          updatedBy: user.cardno
        });
      }
    }
  }
  bookingIdMap[TYPE_ADHYAYAN] = bookingIds;

  await ShibirBookingDb.bulkCreate(booking_data, { transaction: t });
  await Transactions.bulkCreate(transaction_data, { transaction: t });

  return { t, amount };
}

export const fetchGuests = async (req, res) => {
  const { cardno } = req.user;

  const guests = await CardDb.findAll({
    attributes: ['cardno', 'issuedto', 'mobno', 'gender', 'updatedAt'],
    include: [
      {
        model: GuestRelationship,
        where: { cardno: cardno },
        attributes: ['type']
      }
    ],
    raw: true,
    order: [['updatedAt', 'DESC']],
    limit: 10
  });

  return res.status(200).send({
    message: 'fetched results',
    data: guests
  });
};

export const createGuests = async (req, res) => {
  const { cardno } = req.user;
  const { guests } = req.body;

  const t = await database.transaction();
  req.transaction = t;

  const allGuests = await createGuestsHelper(cardno, guests, t);

  await t.commit();

  return res.status(200).send({
    message: MSG_UPDATE_SUCCESSFUL,
    guests: allGuests
  });
};

export const checkGuests = async (req, res) => {
  const { mobno } = req.params;

  const isGuest = await CardDb.findOne({
    attributes: ['cardno', 'issuedto', 'mobno', 'gender', 'email'],
    where: { mobno: mobno, res_status: STATUS_GUEST }
  });
  if (!isGuest) {
    return res.status(200).send({ message: 'Guest not found', data: null });
  } else {
    return res.status(200).send({ message: 'Guest found', data: isGuest });
  }
};

export const guestBookingFlat = async (req, res) => {
  const { guests, startDay, endDay } = req.body;

  const flatDb = await FlatDb.findOne({
    attributes: ['flatno'],
    where: {
      owner: req.user.cardno
    }
  });

  if (!flatDb) throw new ApiError(404, 'Flat not found');

  validateDate(startDay, endDay);

  for (var guest of guests) {
    if (await checkFlatAlreadyBookedForGuest(startDay, endDay, guest['cardno']))
      throw new ApiError(400, `flat already Booked for ${guest['name']}`);
  }

  const nights = await calculateNights(startDay, endDay);
  var t = await database.transaction();

  let booking = [];
  for (var guest of guests) {
    booking.push({
      bookingid: uuidv4(),
      cardno: guest.cardno,
      flatno: flatDb.dataValues.flatno,
      checkin: startDay,
      checkout: endDay,
      nights: nights,
      updatedBy: req.user.cardno,
      status: ROOM_STATUS_PENDING_CHECKIN
    });
  }

  await FlatBooking.bulkCreate(booking, { transaction: t });
  await t.commit();
  return res.status(201).send({ message: MSG_BOOKING_SUCCESSFUL });
};
