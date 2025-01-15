import {
  ShibirDb,
  GuestRoomBooking,
  GuestFoodDb,
  ShibirGuestBookingDb,
  GuestDb
} from '../../models/associations.js';
import {
  ROOM_STATUS_PENDING_CHECKIN,
  STATUS_PAYMENT_PENDING,
  TYPE_EXPENSE,
  STATUS_AVAILABLE,
  TYPE_ROOM,
  NAC_ROOM_PRICE,
  AC_ROOM_PRICE,
  STATUS_CONFIRMED,
  STATUS_WAITING,
  TYPE_FOOD,
  STATUS_PAYMENT_COMPLETED,
  TRANSACTION_TYPE_UPI,
  TYPE_ADHYAYAN,
  TYPE_GUEST_ROOM,
  TYPE_GUEST_ADHYAYAN,
  RAZORPAY_FEE,
  ERR_INVALID_BOOKING_TYPE,
  ERR_ROOM_NO_BED_AVAILABLE,
  ERR_ROOM_ALREADY_BOOKED,
  ERR_ROOM_INVALID_DURATION,
  ERR_ROOM_FAILED_TO_BOOK,
  ERR_ADHYAYAN_ALREADY_BOOKED,
  ERR_ADHYAYAN_NOT_FOUND,
  ERR_FOOD_ALREADY_BOOKED,
  LUNCH_PRICE,
  BREAKFAST_PRICE,
  DINNER_PRICE
} from '../../config/constants.js';
import {
  calculateNights,
  validateDate,
  checkGuestRoomAlreadyBooked,
  checkGuestFoodAlreadyBooked,
  findRoom
} from '../helper.js';
import { v4 as uuidv4 } from 'uuid';
import database from '../../config/database.js';
import Sequelize from 'sequelize';
import getDates from '../../utils/getDates.js';
import ApiError from '../../utils/ApiError.js';
import Transactions from '../../models/transactions.model.js';

// TODO: charge money for guest food
export const guestBooking = async (req, res) => {
  const { primary_booking, addons } = req.body;
  var t = await database.transaction();
  req.transaction = t;

  switch (primary_booking.booking_type) {
    case TYPE_ROOM:
      t = await bookRoom(req.body, req.user, req.body.primary_booking, t);
      break;

    case TYPE_FOOD:
      t = await bookFood(req, req.user, req.body.primary_booking, t);
      break;

    case TYPE_ADHYAYAN:
      t = await bookAdhyayan(req.body, req.user, req.body.primary_booking, t);
      break;

    default:
      throw new ApiError(400, ERR_INVALID_BOOKING_TYPE);
  }

  if (addons) {
    for (const addon of addons) {
      switch (addon.booking_type) {
        case TYPE_ROOM:
          t = await bookRoom(req.body, req.user, addon, t);
          break;

        case TYPE_FOOD:
          t = await bookFood(req, req.user, addon, t);
          break;

        case TYPE_ADHYAYAN:
          t = await bookAdhyayan(req.body, req.user, addon, t);
          break;

        default:
          throw new ApiError(400, ERR_INVALID_BOOKING_TYPE);
      }
    }
  }

  await t.commit();
  return res.status(200).send({ message: 'Booking Successful' });
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

  const taxes = Math.round(totalCharge * RAZORPAY_FEE * 100)/100; 
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
  // TODO: logic for nights = 0 is different for self and for guests
  if (nights <= 0) {
    throw new ApiError(400, ERR_ROOM_INVALID_DURATION);
  }

  const totalGuests = guestGroup.flatMap((group) => group.guests);
  const guest_db = await GuestDb.findAll({
    attributes: ['id', 'name', 'gender'],
    where: {
      id: {
        [Sequelize.Op.in]: totalGuests
      }
    }
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
      var roomStatus = STATUS_WAITING;
      var charge = 0;

      const gender = floorType
        ? floorType + guest_details.filter((item) => item.id == guest)[0].gender
        : guest_details.filter((item) => item.id == guest)[0].gender;

      const room = await findRoom(
        checkin_date,
        checkout_date,
        roomType,
        gender
      );

      if (room) {
        roomStatus = STATUS_AVAILABLE;
        charge =
          roomType == 'nac' ? NAC_ROOM_PRICE * nights : AC_ROOM_PRICE * nights;
      }

      roomDetails.push({
        guestId: guest,
        status: roomStatus,
        charge: charge
      });
    }
  }

  return roomDetails;
}

async function bookRoom(body, user, data, t) {
  const { checkin_date, checkout_date, guestGroup } = data.details;
  validateDate(checkin_date, checkout_date);

  const nights = await calculateNights(checkin_date, checkout_date);
  // TODO: logic for nights = 0 is different for self and for guests
  if (nights <= 0) {
    throw new ApiError(400, ERR_ROOM_INVALID_DURATION);
  }

  const totalGuests = guestGroup.flatMap((group) => group.guests);
  const guest_db = await GuestDb.findAll({
    attributes: ['id', 'name', 'gender'],
    where: {
      id: {
        [Sequelize.Op.in]: totalGuests
      }
    }
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

  for (const group of guestGroup) {
    const { roomType, floorType, guests } = group;

    for (const guest of guests) {
      await bookRoomForSingleGuest(
        body,
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
    }
  }
  return t;
}

async function bookRoomForSingleGuest(
  body,
  user,
  guest,
  guest_details,
  checkin_date,
  checkout_date,
  room_type,
  floor_type,
  nights,
  t
) {
  const gender = floor_type
    ? floor_type + guest_details.filter((item) => item.id == guest)[0].gender
    : guest_details.filter((item) => item.id == guest)[0].gender;

  const roomno = await findRoom(checkin_date, checkout_date, room_type, gender);

  if (!roomno) {
    throw new ApiError(400, ERR_ROOM_NO_BED_AVAILABLE);
  }

  const booking = await GuestRoomBooking.create(
    {
      bookingid: uuidv4(),
      cardno: user.cardno,
      guest: guest,
      roomno: roomno.dataValues.roomno,
      checkin: checkin_date,
      checkout: checkout_date,
      nights: nights,
      roomtype: room_type,
      status: ROOM_STATUS_PENDING_CHECKIN,
      gender: gender
    },
    { transaction: t }
  );

  if (!booking) {
    throw new ApiError(400, ERR_ROOM_FAILED_TO_BOOK);
  }

  const transaction = await Transactions.create(
    {
      cardno: user.cardno,
      bookingid: booking.dataValues.bookingid,
      category: TYPE_GUEST_ROOM,
      type: TYPE_EXPENSE,
      amount:
        room_type == 'nac' ? NAC_ROOM_PRICE * nights : AC_ROOM_PRICE * nights,
      upi_ref: body.transaction_ref || 'NA',
      status:
        body.transaction_type == TRANSACTION_TYPE_UPI
          ? STATUS_PAYMENT_COMPLETED
          : STATUS_PAYMENT_PENDING,
      updatedBy: 'USER'
    },
    { transaction: t }
  );

  if (!transaction) {
    throw new ApiError(400, ERR_ROOM_FAILED_TO_BOOK);
  }

  return t;
}

async function checkFoodAvailability(data) {
  const { start_date, end_date, guestGroup } = data.details;
  
  validateDate(start_date, end_date);

  const totalGuests = guestGroup.flatMap((group) => group.guests);

  if (await checkGuestFoodAlreadyBooked(start_date, end_date, totalGuests))
    throw new ApiError(403, ERR_FOOD_ALREADY_BOOKED);

  
  const allDates = getDates(start_date, end_date);
  var charge = 0;
  for (const group of guestGroup) {
    const { meals, guests } = group;

    const groupCharge = allDates.length * guests.length * (
      (meals.includes('breakfast') ? BREAKFAST_PRICE : 0) + 
      (meals.includes('lunch') ? LUNCH_PRICE : 0) + 
      (meals.includes('dinner') ? DINNER_PRICE : 0));

    charge += groupCharge;
  }

  return {
    status: STATUS_AVAILABLE,
    charge: charge
  }
}

async function bookFood(req, user, data, t) {
  const { start_date, end_date, guestGroup } = data.details;

  validateDate(start_date, end_date);

  const allDates = getDates(start_date, end_date);
  const totalGuests = guestGroup.flatMap((group) => group.guests);

  const bookingsToUpdate = await GuestFoodDb.findAll({
    where: {
      date: { [Sequelize.Op.in]: allDates },
      guest: { [Sequelize.Op.in]: totalGuests }
    }
  });

  var guestMeals = {};
  guestGroup.forEach((group) => {
    const { meals, spicy, high_tea, guests } = group;
    const mealFields = Object.fromEntries(
      ['breakfast', 'lunch', 'dinner'].map(
        (item) => ([item, meals.includes(item) ? 1 : 0 ])
      )
    );

    guests.forEach((guest) => {
      guestMeals[guest] = {
        mealFields,
        hightea: high_tea || 'NONE',
        spicy
      }
    });
  });

  var guestDatesUpdated = {};
  for (const booking of bookingsToUpdate) {
    const meals = guestMeals[booking.guest];

    Object.keys(meals.mealFields).forEach((type) => {
      const toBook = meals.mealFields[type];
      if (toBook && !booking[type])
        booking[type] = toBook;
    });
    booking.hightea = meals.hightea;
    booking.spicy = meals.spicy;
    await booking.save({ transaction: t });

    guestDatesUpdated[booking.guest] = guestDatesUpdated[booking.guest] || [];
    guestDatesUpdated[booking.guest].push(booking.date);
  }

  var bookingsToCreate = [];
  totalGuests.forEach((guest) => {
    const bookedDates = guestDatesUpdated[guest] || [];
    const remainingDates = allDates.filter(date => !bookedDates.includes(date));
    const meals = guestMeals[guest];

    for (const date of remainingDates) {
      bookingsToCreate.push({
        cardno: user.cardno,
        guest,
        date,
        breakfast: meals.mealFields.breakfast,
        lunch: meals.mealFields.lunch,
        dinner: meals.mealFields.dinner,
        hightea: meals.hightea,
        spicy: meals.spicy,
        plateissued: 0
      });
    }
  });

  await GuestFoodDb.bulkCreate(bookingsToCreate, { transaction: t });
  return t;
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

async function bookAdhyayan(body, user, data, t) {
  const { shibir_ids, guests } = data.details;

  const isBooked = await ShibirGuestBookingDb.findAll({
    where: {
      shibir_id: {
        [Sequelize.Op.in]: shibir_ids
      },
      guest: { [Sequelize.Op.in]: guests },
      status: {
        [Sequelize.Op.in]: [
          STATUS_CONFIRMED,
          STATUS_WAITING,
          STATUS_PAYMENT_PENDING
        ]
      }
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

  for (const guest of guests) {
    for (var shibir of shibirs) {
      const bookingid = uuidv4();

      if (shibir.dataValues.available_seats > 0) {
        booking_data.push({
          bookingid: bookingid,
          shibir_id: shibir.dataValues.id,
          cardno: user.cardno,
          guest: guest,
          status:
            body.transaction_type == TRANSACTION_TYPE_UPI
              ? STATUS_CONFIRMED
              : STATUS_PAYMENT_PENDING
        });

        shibir.available_seats -= 1;
        await shibir.save({ transaction: t });

        transaction_data.push({
          cardno: user.cardno,
          bookingid: bookingid,
          category: TYPE_GUEST_ADHYAYAN,
          type: TYPE_EXPENSE,
          amount: shibir.dataValues.amount,
          upi_ref: body.transaction_ref ? body.transaction_ref : 'NA',
          status:
            body.transaction_type == TRANSACTION_TYPE_UPI
              ? STATUS_PAYMENT_COMPLETED
              : STATUS_PAYMENT_PENDING
        });
      } else {
        booking_data.push({
          bookingid: bookingid,
          shibir_id: shibir.dataValues.id,
          cardno: user.cardno,
          guest: guest,
          status: STATUS_WAITING
        });
      }
    }
  }

  await ShibirGuestBookingDb.bulkCreate(booking_data, { transaction: t });
  await Transactions.bulkCreate(transaction_data, { transaction: t });

  return t;
}

export const fetchGuests = async (req, res) => {
  const { cardno } = req.user;

  const guests = await GuestDb.findAll({
    attributes: ['id', 'name', 'type', 'mobno', 'gender'],
    where: {
      cardno: cardno
    },
    raw: true,
    order: [['updatedAt', 'DESC']],
    limit: 10
  });

  return res.status(200).send({
    message: 'fetched results',
    data: guests
  });
};

export const updateGuests = async (req, res) => {
  const { cardno } = req.user;
  const { guests } = req.body;

  const t = await database.transaction();
  req.transaction = t;

  const guestsToUpdate = guests.filter((guest) => guest.id);
  const guestsToCreate = guests
    .filter((guest) => !guest.id)
    .map((guest) => ({
      ...guest,
      cardno: cardno
    }));

  for (const guest of guestsToUpdate) {
    const { id, ...updateData } = guest;
    await GuestDb.update(updateData, {
      where: { id },
      transaction: t
    });
  }

  const createdGuests = await GuestDb.bulkCreate(guestsToCreate, {
    transaction: t,
    returning: true
  });
  const createdGuestsData = createdGuests.map((guest) => ({
    id: guest.id,
    name: guest.name
  }));

  const updatedGuests = await GuestDb.findAll({
    where: { id: guestsToUpdate.map((guest) => guest.id) },
    attributes: ['id', 'name'],
    transaction: t
  });

  const allGuests = [
    ...updatedGuests.map((guest) => guest.toJSON()),
    ...createdGuestsData
  ];

  await t.commit();

  return res.status(200).send({
    message: 'Guests updated successfully',
    guests: allGuests
  });
};
