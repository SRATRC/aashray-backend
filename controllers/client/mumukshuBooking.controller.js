import {
  CardDb,
  FoodDb
} from '../../models/associations.js';
import {
  STATUS_AVAILABLE,
  TYPE_ROOM,
  STATUS_WAITING,
  TYPE_FOOD,
  TYPE_ADHYAYAN,
  RAZORPAY_FEE,
  ERR_INVALID_BOOKING_TYPE,
  ERR_ROOM_ALREADY_BOOKED,
  LUNCH_PRICE,
  BREAKFAST_PRICE,
  DINNER_PRICE,
  ERR_CARD_NOT_FOUND,
  TYPE_TRAVEL
} from '../../config/constants.js';
import {
  calculateNights,
  validateDate
} from '../helper.js';
import { 
  checkRoomAlreadyBooked,
  createRoomBooking,
  findRoom,
  roomCharge
} from '../../helpers/roomBooking.helper.js';
import database from '../../config/database.js';
import getDates from '../../utils/getDates.js';
import ApiError from '../../utils/ApiError.js';
import { 
  createAdhyayanBooking, 
  checkAdhyayanAlreadyBooked, 
  validateAdhyayans 
} from '../../helpers/adhyayanBooking.helper.js';


export const mumukshuBooking = async (req, res) => {
  const { primary_booking, addons } = req.body;
  var t = await database.transaction();
  req.transaction = t;

  switch (primary_booking.booking_type) {
    case TYPE_ROOM:
      t = await bookRoom(req.body, req.body.primary_booking, t);
      break;

    case TYPE_FOOD:
      t = await bookFood(req.body.primary_booking, t);
      break;

    case TYPE_TRAVEL:
      t = await bookTravel(req.body.primary_booking, t);
      break;

    case TYPE_ADHYAYAN:
      t = await bookAdhyayan(req.body, req.body.primary_booking, t);
      break;

    default:
      throw new ApiError(400, ERR_INVALID_BOOKING_TYPE);
  }

  if (addons) {
    for (const addon of addons) {
      switch (addon.booking_type) {
        case TYPE_ROOM:
          t = await bookRoom(req.body, addon, t);
          break;

        case TYPE_FOOD:
          t = await bookFood(addon, t);
          break;

        case TYPE_TRAVEL:
          t = await bookTravel(addon, t);
          break;

        case TYPE_ADHYAYAN:
          t = await bookAdhyayan(req.body, addon, t);
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
  var travelDetails = {};
  var totalCharge = 0;

  switch (primary_booking.booking_type) {
    case TYPE_ROOM:
      roomDetails = await checkRoomAvailability(req.body.primary_booking);
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
      adhyayanDetails = await checkAdhyayanAvailability(req.body.primary_booking);
      totalCharge += adhyayanDetails.reduce(
        (partialSum, adhyayan) => partialSum + adhyayan.charge,
        0
      );
      break;

    case TYPE_TRAVEL:
      travelDetails = await checkTravelAvailability();
      totalCharge += travelDetails.charge;
      break;

    default:
      throw new ApiError(400, ERR_INVALID_BOOKING_TYPE);
  }

  if (addons) {
    for (const addon of addons) {
      switch (addon.booking_type) {
        case TYPE_ROOM:
          roomDetails = await checkRoomAvailability(addon);
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
          adhyayanDetails = await checkAdhyayanAvailability(addon);
          totalCharge += adhyayanDetails.reduce(
            (partialSum, adhyayan) => partialSum + adhyayan.charge,
            0
          );
          break;

        case TYPE_TRAVEL:
          travelDetails = await checkTravelAvailability();
          totalCharge += travelDetails.charge;
          break;

        default:
          throw new ApiError(400, ERR_INVALID_BOOKING_TYPE);
      }
    }
  }

  const taxes = Math.round(totalCharge * RAZORPAY_FEE * 100)/100; 
  return res.status(200).send({
    data: {
      roomDetails,
      adhyayanDetails,
      foodDetails,
      travelDetails,
      taxes,
      totalCharge: totalCharge + taxes
    }
  });
};

async function checkRoomAvailability(data) {
  const { checkin_date, checkout_date, mumukshuGroup } = data.details;
  validateDate(checkin_date, checkout_date);

  const mumukshus = mumukshuGroup.flatMap((group) => group.mumukshus);
  const cardDb = await validateMumukshus(mumukshus);

  if (await checkRoomAlreadyBooked(checkin_date, checkout_date, mumukshus)) {
    throw new ApiError(400, ERR_ROOM_ALREADY_BOOKED);
  }

  const nights = await calculateNights(checkin_date, checkout_date);
  
  var roomDetails = [];
  for (const group of mumukshuGroup) {
    const { roomType, floorType, mumukshus } = group;

    for (const mumukshu of mumukshus) {
      const card = cardDb.filter(
        (item) => (item.dataValues.cardno == mumukshu)
      )[0];

      var status = STATUS_WAITING;
      var charge = 0;

      const gender = floorType
        ? floorType + card.dataValues.gender
        : card.dataValues.gender;

      if (nights > 0) {
        const roomno = await findRoom(
          checkin_date,
          checkout_date,
          roomType,
          gender
        );
        if (roomno) {
          status = STATUS_AVAILABLE;
          charge = roomCharge(roomType) * nights;
        }
      } else {
        status = STATUS_AVAILABLE;
        charge = 0;
      }
    
      roomDetails.push({
        mumukshu,
        status,
        charge
      });
    }
  }

  return roomDetails;
}

async function bookRoom(body, data, t) {
  const { checkin_date, checkout_date, mumukshuGroup } = data.details;
  validateDate(checkin_date, checkout_date);

  const mumukshus = mumukshuGroup.flatMap((group) => group.mumukshus);
  const cardDb = await validateMumukshus(mumukshus);

  if (await checkRoomAlreadyBooked(checkin_date, checkout_date, mumukshus)) {
    throw new ApiError(400, ERR_ROOM_ALREADY_BOOKED);
  }

  const nights = await calculateNights(checkin_date, checkout_date);

  for (const group of mumukshuGroup) {
    const { roomType, floorType, mumukshus } = group;

    for (const mumukshu of mumukshus) {
      const card = cardDb.filter(
        (item) => (item.dataValues.cardno == mumukshu)
      )[0];

      if (nights == 0) {
        await bookDayVisit(
          card.dataValues.cardno,
          checkin_date,
          checkout_date,
          t
        );
      } else {
        await createRoomBooking(
          card.dataValues.cardno,
          checkin_date,
          checkout_date,
          nights,
          roomType,
          card.dataValues.gender,
          floorType,
          body.transaction_ref || 'NA',
          body.transaction_type,
          t
        )
      }
    }
  }

  return t;
}

async function checkFoodAvailability(data) {
  const { start_date, end_date, mumukshuGroup } = data.details;
  validateDate(start_date, end_date);

  const mumukshus = mumukshuGroup.flatMap((group) => group.mumukshus);
  await validateMumukshus(mumukshus);

  const allDates = getDates(start_date, end_date);
  const bookings = await getFoodBookings(mumukshus, allDates);

  var charge = 0;

  for (const group of mumukshuGroup) {
    const { meals, mumukshus } = group;
    for (const date of allDates) {
      for (const mumukshu of mumukshus) {
        const booking = bookings[mumukshu] ? bookings[mumukshu][date] : null;
        if (booking) {
          charge +=
            (meals.includes('breakfast') && !booking['breakfast'] ? BREAKFAST_PRICE : 0) +
            (meals.includes('lunch') && !booking['lunch'] ? LUNCH_PRICE : 0) +
            (meals.includes('dinner') && !booking['dinner'] ? DINNER_PRICE : 0);
        } else {
          charge +=
            (meals.includes('breakfast') ? BREAKFAST_PRICE : 0) +
            (meals.includes('lunch') ? LUNCH_PRICE : 0) +
            (meals.includes('dinner') ? DINNER_PRICE : 0);
        }
      }
    }
  }

  return {
    status: STATUS_AVAILABLE,
    charge
  }
}

async function bookFood(data, t) {
  const { start_date, end_date, mumukshuGroup } = data.details;
  validateDate(start_date, end_date);

  const mumukshus = mumukshuGroup.flatMap((group) => group.mumukshus);
  await validateMumukshus(mumukshus);

  const allDates = getDates(start_date, end_date);
  const bookings = await getFoodBookings(mumukshus, allDates);

  var bookingsToCreate = [];
  for (const group of mumukshuGroup) {
    const { meals, spicy, high_tea, mumukshus } = group;

    for (const date of allDates) {
      for (const mumukshu of mumukshus) {
        const booking = bookings[mumukshu] ? bookings[mumukshu][date] : null;
        if (booking) {
          ['breakfast', 'lunch', 'dinner'].forEach((type) => {
            if (meals.includes(type) && !booking[type])
              booking[type] = 1;
          });
          booking['spicy'] = spicy;
          booking['hightea'] = high_tea;
          await booking.save({ transaction: t });
        } else {
          bookingsToCreate.push({
            cardno: mumukshu,
            date,
            spicy,
            breakfast: meals.includes('breakfast'),
            lunch: meals.includes('lunch'),
            dinner: meals.includes('dinner'),
            hightea: high_tea,
            plateissued: 0
          });
        }
      }
    }
  }

  await FoodDb.bulkCreate(bookingsToCreate, { transaction: t });
  return t;
}

async function checkAdhyayanAvailability(data) {
  const { shibir_ids, mumukshus } = data.details;

  await validateMumukshus(mumukshus);
  await checkAdhyayanAlreadyBooked(shibir_ids, mumukshus);
  const shibirs = await validateAdhyayans(shibir_ids);

  var adhyayanDetails = [];
  for (var shibir of shibirs) {
    var available = mumukshus.length;
    var waiting = 0;
    var charge = 0;

    if (shibir.dataValues.available_seats < mumukshus.length) {
      available = shibir.dataValues.available_seats;
      waiting = mumukshus.length - shibir.dataValues.available_seats;
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

async function bookAdhyayan(body, data, t) {
  const { shibir_ids, mumukshus } = data.details;

  await validateMumukshus(mumukshus);
  await checkAdhyayanAlreadyBooked(shibir_ids, mumukshus);
  const shibirs = await validateAdhyayans(shibir_ids);

  await createAdhyayanBooking(
    shibirs, 
    body.transaction_type,
    body.transaction_ref || 'NA',
    t,
    mumukshus, 
  );

  return t;
}

async function checkTravelAvailability() {
  return {
    status: STATUS_WAITING,
    charge: 0
  };
}

async function bookTravel(data, t) {
  // const { date, pickup_point, drop_point, luggage, comments, type } =
  //   data.details;

  // const today = moment().format('YYYY-MM-DD');
  // if (date <= today) {
  //   throw new ApiError(400, 'Invalid Date');
  // }

  // const isBooked = await TravelDb.findOne({
  //   where: {
  //     cardno: user.cardno,
  //     status: { [Sequelize.Op.in]: [STATUS_CONFIRMED, STATUS_WAITING] },
  //     date: date
  //   }
  // });
  // if (isBooked) {
  //   throw new ApiError(400, 'Travel already booked on the selected date');
  // }

  // await TravelDb.create(
  //   {
  //     bookingid: uuidv4(),
  //     cardno: user.cardno,
  //     date: date,
  //     type: type,
  //     pickup_point: pickup_point,
  //     drop_point: drop_point,
  //     luggage: luggage,
  //     comments: comments,
  //     status: STATUS_WAITING
  //   },
  //   { transaction: t }
  // );

  return t;
}

async function validateMumukshus(mumukshus) {
  const cardDb = await CardDb.findAll({
    where: { cardno: mumukshus },
    attributes: ['id', 'cardno', 'gender']
  });

  if (cardDb.length != mumukshus.length) {
    throw new ApiError(400, ERR_CARD_NOT_FOUND);
  }

  return cardDb;
}

async function getFoodBookings(mumukshus, allDates) {
  const bookings = await FoodDb.findAll({
    where: {
      date: allDates,
      cardno: mumukshus
    }
  });

  const mumukshuBookings = {};
  for (const booking of bookings) {
    mumukshuBookings[booking.cardno] ||= {};
    mumukshuBookings[booking.cardno][booking.date] = booking;
  }

  return mumukshuBookings;
}

