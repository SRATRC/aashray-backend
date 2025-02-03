import { 
  ERR_ROOM_MUST_BE_BOOKED, 
  STATUS_RESIDENT 
} from '../config/constants.js';
import { 
  checkFlatAlreadyBooked, 
  checkRoomBookingProgress, 
  checkSpecialAllowance, 
  validateDate
} from '../controllers/helper.js';
import {
  FoodDb,
} from '../models/associations.js'
import ApiError from '../utils/ApiError.js';
import getDates from '../utils/getDates.js';
import { validateCards } from './card.helper.js';
import { 
  checkRoomAlreadyBooked 
} from './roomBooking.helper.js';

export async function getFoodBookings(allDates, ...cardnos) {
  const bookings = await FoodDb.findAll({
    where: {
      date: allDates,
      cardno: cardnos,
      guest: null
    }
  });

  const bookingsByCard = {};
  for (const booking of bookings) {
    bookingsByCard[booking.cardno] ||= {};
    bookingsByCard[booking.cardno][booking.date] = booking;
  }

return bookingsByCard;
}

export async function bookFoodForMumukshus(
  start_date,
  end_date,
  mumukshuGroup,
  primary_booking,
  addons,
  t
) {

  validateDate(start_date, end_date);

  const mumukshus = mumukshuGroup.flatMap((group) => group.mumukshus);
  const cards = await validateCards(mumukshus);
  for (const card of cards) {
    await validateFood(
      start_date, 
      end_date, 
      primary_booking, 
      addons, 
      card
    );
  }

  const allDates = getDates(start_date, end_date);
  const bookings = await getFoodBookings(allDates, mumukshus);

  var bookingsToCreate = [];
  for (const group of mumukshuGroup) {
    const { meals, spicy, high_tea, mumukshus } = group;

    const breakfast = meals.includes('breakfast');
    const lunch = meals.includes('lunch');
    const dinner = meals.includes('dinner');

    for (const mumukshu of mumukshus) {
      for (const date of allDates) { 
        const booking = bookings[mumukshu] ? bookings[mumukshu][date] : null;
        if (booking) {
          await updateFoodBooking(
            booking, 
            breakfast,
            lunch,
            dinner,
            spicy, 
            high_tea, 
            t
          );
        } else {
          bookingsToCreate.push({
            cardno: mumukshu,
            date,
            breakfast,
            lunch,
            dinner,
            spicy,
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

async function updateFoodBooking(
  booking, 
  breakfast, 
  lunch, 
  dinner, 
  spicy, 
  hightea, 
  t
) {

  booking.update(
    {
      breakfast: booking.breakfast || breakfast,
      lunch: booking.lunch || lunch,
      dinner: booking.dinner || dinner,
      spicy,
      hightea
    },
    { transaction: t }
  );
}

export async function validateFood(
  start_date, 
  end_date, 
  primary_booking, 
  addons, 
  card
) {
  if (
    !(
      (await checkRoomBookingProgress(
        start_date,
        end_date,
        primary_booking,
        addons
      )) ||
      (await checkRoomAlreadyBooked(
        start_date, 
        end_date, 
        card.cardno
      )) ||
      (await checkFlatAlreadyBooked(
        start_date, 
        end_date, 
        card.cardno
      )) ||
      card.res_status === STATUS_RESIDENT ||
      (await checkSpecialAllowance(
        start_date, 
        end_date, 
        card.cardno
      ))
    )
  ) {
    throw new ApiError(400, ERR_ROOM_MUST_BE_BOOKED);
  }
}

