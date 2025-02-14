import {
  ERR_ROOM_MUST_BE_BOOKED,
  STATUS_ADMIN_CANCELLED,
  STATUS_CANCELLED,
  STATUS_RESIDENT,
  TYPE_GUEST_BREAKFAST,
  TYPE_GUEST_DINNER,
  TYPE_GUEST_LUNCH
} from '../config/constants.js';
import {
  checkFlatAlreadyBooked,
  checkRoomBookingProgress,
  checkSpecialAllowance,
  validateDate
} from '../controllers/helper.js';
import { FoodDb, Transactions } from '../models/associations.js';
import ApiError from '../utils/ApiError.js';
import getDates from '../utils/getDates.js';
import { validateCards } from './card.helper.js';
import { checkRoomAlreadyBooked } from './roomBooking.helper.js';
import { v4 as uuidv4 } from 'uuid';
import { cancelTransaction } from './transactions.helper.js';
import moment from 'moment';

const mealTypeMapping = {
  breakfast: TYPE_GUEST_BREAKFAST,
  lunch: TYPE_GUEST_LUNCH,
  dinner: TYPE_GUEST_DINNER
};

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
  updatedBy,
  t
) {
  validateDate(start_date, end_date);

  const mumukshus = mumukshuGroup.flatMap((group) => group.mumukshus);
  const cards = await validateCards(mumukshus);
  for (const card of cards) {
    await validateFood(start_date, end_date, primary_booking, addons, card);
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
          await booking.update(
            {
              breakfast: booking.breakfast || breakfast,
              lunch: booking.lunch || lunch,
              dinner: booking.dinner || dinner,
              hightea: high_tea,
              spicy,
              updatedBy
            },
            { transaction: t }
          );
        } else {
          bookingsToCreate.push({
            id: uuidv4(),
            cardno: mumukshu,
            date,
            breakfast,
            lunch,
            dinner,
            spicy,
            hightea: high_tea,
            plateissued: 0,
            updatedBy
          });
        }
      }
    }
  }

  await FoodDb.bulkCreate(bookingsToCreate, { transaction: t });
  return t;
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
      (await checkRoomAlreadyBooked(start_date, end_date, card.cardno)) ||
      (await checkFlatAlreadyBooked(start_date, end_date, card.cardno)) ||
      card.res_status === STATUS_RESIDENT ||
      (await checkSpecialAllowance(start_date, end_date, card.cardno))
    )
  ) {
    throw new ApiError(400, ERR_ROOM_MUST_BE_BOOKED);
  }
}

export function createGroupFoodRequest(
  cardno,
  breakfast,
  lunch,
  dinner,
  spicy,
  high_tea
) {
  const meals = [];
  if (breakfast) meals.push('breakfast');
  if (lunch) meals.push('lunch');
  if (dinner) meals.push('dinner');

  return [
    {
      mumukshus: [cardno],
      meals,
      spicy,
      high_tea
    }
  ];
}

export async function cancelFood(user, cardno, food_data, t, admin = false) {
  if (!cardno || !Array.isArray(food_data)) {
    return res.status(400).json({ message: 'Invalid request data' });
  }

  const today = moment().format('YYYY-MM-DD');
  const validFoodData = food_data.filter((item) => item.date > today + 1);

  for (const item of food_data) {
    const { date, mealType, bookedFor } = item;

    // Fetch the booking from the database to get the id
    const booking = await FoodDb.findOne({
      where: {
        cardno,
        date,
        ...(bookedFor !== null && { guest: bookedFor })
      }
    });

    if (!booking) {
      return; // Skip if no matching booking found
    }

    // Create the update object: setting the specific meal to 0 (cancelled)
    const updateFields = {};
    if (mealType === 'breakfast') updateFields.breakfast = 0;
    if (mealType === 'lunch') updateFields.lunch = 0;
    if (mealType === 'dinner') updateFields.dinner = 0;

    // Update the meal booking
    await FoodDb.update(updateFields, {
      where: { id: booking.id },
      transaction: t
    });

    // Handle guest meal transaction cancellation
    if (bookedFor) {
      // Find and update the transaction to mark it as credited
      const transaction = await Transactions.findOne({
        where: {
          cardno,
          bookingid: booking.id,
          category: mealTypeMapping[mealType]
        }
      });

      await cancelTransaction(user, transaction, t, admin);
    }
  }
}
