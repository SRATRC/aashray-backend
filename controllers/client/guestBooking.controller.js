import {
  ShibirDb,
  GuestFoodDb,
  GuestDb,
  ShibirBookingDb,
  RoomBooking,
  FlatBooking,
  FlatDb
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
  ERR_FOOD_ALREADY_BOOKED,
  LUNCH_PRICE,
  BREAKFAST_PRICE,
  DINNER_PRICE,
  MSG_BOOKING_SUCCESSFUL,
  MSG_UPDATE_SUCCESSFUL
} from '../../config/constants.js';
import {
  calculateNights,
  validateDate,
  checkGuestRoomAlreadyBooked,
  checkGuestFoodAlreadyBooked,
  checkFlatAlreadyBookedForGuest
} from '../helper.js';
import { v4 as uuidv4 } from 'uuid';
import { findRoom, roomCharge } from '../../helpers/roomBooking.helper.js';
import {
  createPendingTransaction,
  useCredit,
  generateOrderId
} from '../../helpers/transactions.helper.js';
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

  let amount = 0;

  switch (primary_booking.booking_type) {
    case TYPE_ROOM:
      const roomResult = await bookRoom(req.user, primary_booking, t);
      t = roomResult.t;
      amount += roomResult.amount;
      break;

    case TYPE_FOOD:
      t = await bookFood(req.user, primary_booking, t);
      break;

    case TYPE_ADHYAYAN:
      const adhyayanResult = await bookAdhyayan(req.user, primary_booking, t);
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
          const roomResult = await bookRoom(req.user, addon, t);
          t = roomResult.t;
          amount += roomResult.amount;
          break;

        case TYPE_FOOD:
          t = await bookFood(req.user, addon, t);
          break;

        case TYPE_ADHYAYAN:
          const adhyayanResult = await bookAdhyayan(req.user, addon, t);
          t = adhyayanResult.t;
          amount += adhyayanResult.amount;
          break;

        default:
          throw new ApiError(400, ERR_INVALID_BOOKING_TYPE);
      }
    }
  }

  const taxes = Math.round(amount * RAZORPAY_FEE * 100) / 100;
  const finalAmount = amount + taxes;

  const order = await generateOrderId(finalAmount);

  await t.commit();
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
  const guest_db = await GuestDb.findAll({
    attributes: ['id', 'name', 'gender'],
    where: { id: totalGuests }
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
        ? floorType + guest_details.filter((item) => item.id == guest)[0].gender
        : guest_details.filter((item) => item.id == guest)[0].gender;

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

export const guestBookingFlat = async (req, res) => {
  const { flat_no, guests, checkin_date, checkout_date, } = req.body;

  const ownFlat = await FlatDb.findOne({
    where: {
      flatno: flat_no,
      owner: req.user.cardno
    }
  });
  if (!ownFlat) throw new ApiError(404, 'Flat not owned by you');

  validateDate(checkin_date, checkout_date);
  
  for(var guest of guests){
    if (
      await checkFlatAlreadyBookedForGuest(
        checkin_date,
        checkout_date,
        flat_no,
        req.user.cardno,
        guest["id"]
      )
    ) {
      throw new ApiError(400, 'Already Booked');
    }
  } 
  
  const nights = await calculateNights(checkin_date, checkout_date);
  var t = await database.transaction();

  for(var guest of guests){
    
    const booking = await FlatBooking.create({
      bookingid: uuidv4(),
      cardno: req.user.cardno,
      flatno: flat_no,
      checkin: checkin_date,
      checkout: checkout_date,
      nights: nights,
      status: ROOM_STATUS_PENDING_CHECKIN,
      guest:guest["id"]
    });
    if (!booking) {
      throw new ApiError(500, 'Failed to book your flat');
    }
  }

  await t.commit();

  return res.status(201).send({ message: MSG_BOOKING_SUCCESSFUL });
};

async function bookRoom(user, data, t) {
  const { checkin_date, checkout_date, guestGroup } = data.details;
  validateDate(checkin_date, checkout_date);

  let amount = 0;

  const nights = await calculateNights(checkin_date, checkout_date);

  const totalGuests = guestGroup.flatMap((group) => group.guests);
  const guest_db = await GuestDb.findAll({
    attributes: ['id', 'name', 'gender'],
    where: { id: totalGuests }
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
      }
    }
  }
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
      cardno: user.cardno,
      guest,
      roomno: 'NA',
      roomtype: 'NA',
      gender: 'NA',
      nights: 0,
      checkin,
      checkout,
      status: ROOM_STATUS_PENDING_CHECKIN
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
    ? floor_type + guest_details.filter((item) => item.id == guest)[0].gender
    : guest_details.filter((item) => item.id == guest)[0].gender;

  const roomno = await findRoom(checkin, checkout, roomtype, gender);

  if (!roomno) {
    throw new ApiError(400, ERR_ROOM_NO_BED_AVAILABLE);
  }

  const booking = await RoomBooking.create(
    {
      bookingid: uuidv4(),
      cardno: user.cardno,
      guest,
      roomno: roomno.dataValues.roomno,
      checkin,
      checkout,
      nights,
      roomtype,
      gender,
      status: ROOM_STATUS_PENDING_CHECKIN
    },
    { transaction: t }
  );

  if (!booking) {
    throw new ApiError(400, ERR_ROOM_FAILED_TO_BOOK);
  }

  const amount = roomCharge(roomtype) * nights;

  const transaction = await createPendingTransaction(
    user.cardno,
    booking.bookingid,
    TYPE_ROOM,
    amount,
    'USER',
    t
  );

  if (!transaction) {
    throw new ApiError(400, ERR_ROOM_FAILED_TO_BOOK);
  }

  const discountedAmount = await useCredit(
    user.cardno,
    booking,
    transaction,
    amount,
    'USER',
    t
  );

  return { t, discountedAmount };
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

    const groupCharge =
      allDates.length *
      guests.length *
      ((meals.includes('breakfast') ? BREAKFAST_PRICE : 0) +
        (meals.includes('lunch') ? LUNCH_PRICE : 0) +
        (meals.includes('dinner') ? DINNER_PRICE : 0));

    charge += groupCharge;
  }

  return {
    status: STATUS_AVAILABLE,
    charge: charge
  };
}

async function bookFood(user, data, t) {
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
      ['breakfast', 'lunch', 'dinner'].map((item) => [
        item,
        meals.includes(item) ? 1 : 0
      ])
    );

    guests.forEach((guest) => {
      guestMeals[guest] = {
        mealFields,
        hightea: high_tea || 'NONE',
        spicy
      };
    });
  });

  var guestDatesUpdated = {};
  for (const booking of bookingsToUpdate) {
    const meals = guestMeals[booking.guest];

    Object.keys(meals.mealFields).forEach((type) => {
      const toBook = meals.mealFields[type];
      if (toBook && !booking[type]) booking[type] = toBook;
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
    const remainingDates = allDates.filter(
      (date) => !bookedDates.includes(date)
    );
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

async function bookAdhyayan(user, data, t) {
  const { shibir_ids, guests } = data.details;
  let amount = 0;

  const isBooked = await ShibirBookingDb.findAll({
    where: {
      shibir_id: shibir_ids,
      guest: guests,
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

  for (const guest of guests) {
    for (var shibir of shibirs) {
      const bookingid = uuidv4();

      if (shibir.dataValues.available_seats > 0) {
        booking_data.push({
          bookingid: bookingid,
          shibir_id: shibir.dataValues.id,
          cardno: user.cardno,
          guest: guest,
          status: STATUS_PAYMENT_PENDING
        });

        shibir.available_seats -= 1;
        await shibir.save({ transaction: t });

        transaction_data.push({
          cardno: user.cardno,
          bookingid: bookingid,
          category: TYPE_GUEST_ADHYAYAN,
          type: TYPE_EXPENSE,
          amount: shibir.dataValues.amount,
          status: STATUS_PAYMENT_PENDING
        });

        amount += shibir.dataValues.amount;
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

  await ShibirBookingDb.bulkCreate(booking_data, { transaction: t });
  await Transactions.bulkCreate(transaction_data, { transaction: t });

  return { t, amount };
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

export const createGuests = async (req, res) => {
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
    message: MSG_UPDATE_SUCCESSFUL,
    guests: allGuests
  });
};

export const checkGuests = async (req, res) => {
  const { mobno } = req.params;

  const isGuest = await GuestDb.findOne({
    attributes: {
      exclude: ['updatedBy', 'createdAt', 'updatedAt']
    },
    where: { mobno: mobno }
  });
  if (!isGuest) {
    return res.status(200).send({ message: 'Guest not found', data: null });
  } else {
    return res.status(200).send({ message: 'Guest found', data: isGuest });
  }
};
