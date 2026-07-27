import {
  BREAKFAST_PRICE,
  DINNER_PRICE,
  ERR_BOOKING_NOT_FOUND,
  ERR_INVALID_MEAL_TIME,
  ERR_ROOM_MUST_BE_BOOKED,
  LUNCH_PRICE,
  ROLE_FOOD_ADMIN,
  ROLE_SUPER_ADMIN,
  STATUS_AVAILABLE,
  STATUS_CASH_PENDING,
  STATUS_GUEST,
  STATUS_PAYMENT_PENDING,
  STATUS_RESIDENT,
  STATUS_SEVA_KUTIR,
  TYPE_FOOD,
  TYPE_GUEST_BREAKFAST,
  TYPE_GUEST_DINNER,
  TYPE_GUEST_LUNCH,
  TYPE_UTSAV
} from '../config/constants.js';
import {
  checkFlatAlreadyBooked,
  checkRoomBookingProgress,
  checkSpecialAllowance,
  validateDate
} from '../controllers/helper.js';
import {
  CardDb,
  FoodDb,
  Transactions,
  UtsavDb
} from '../models/associations.js';
import { validateCards } from './card.helper.js';
import { checkRoomAlreadyBooked } from './roomBooking.helper.js';
import { v4 as uuidv4 } from 'uuid';
import { cancelTransactions, usableCredits } from './transactions.helper.js';
import ApiError from '../utils/ApiError.js';
import getDates from '../utils/getDates.js';
import moment from 'moment-timezone';
import logger from '../config/logger.js';

const mealTypeMapping = {
  breakfast: TYPE_GUEST_BREAKFAST,
  lunch: TYPE_GUEST_LUNCH,
  dinner: TYPE_GUEST_DINNER
};

const MEALS = [
  {
    type: TYPE_GUEST_BREAKFAST,
    price: BREAKFAST_PRICE
  },
  {
    type: TYPE_GUEST_LUNCH,
    price: LUNCH_PRICE
  },
  {
    type: TYPE_GUEST_DINNER,
    price: DINNER_PRICE
  }
];

export async function getFoodBookings(allDates, ...cardnos) {
  const bookings = await FoodDb.findAll({
    where: {
      date: allDates,
      cardno: cardnos
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
  bookedBy,
  t,
  updatedBy,
  userRoles = [],
  cashAllowed = false,
  log = logger
) {
  const mumukshus_peek = mumukshuGroup.flatMap((g) => g.mumukshus || g.guests);
  log.info('food_booking_start', {
    start_date,
    end_date,
    mumukshu_count: mumukshus_peek.length,
    bookedBy
  });
  if (!end_date) {
    end_date = start_date;
  }
  validateDate(start_date, end_date);

  const mumukshus = mumukshuGroup.flatMap(
    (group) => group.mumukshus || group.guests
  );
  const cards = await validateCards(mumukshus);
  for (const card of cards) {
    await validateFood(
      start_date,
      end_date,
      primary_booking,
      addons,
      card,
      userRoles
    );
  }

  const utsav =
    primary_booking?.booking_type == TYPE_UTSAV
      ? await UtsavDb.findOne({
          where: { id: primary_booking.details.utsavid }
        })
      : null;

  const allDates = getDatesDuringUtsav(start_date, end_date, utsav);
  const bookings = await getFoodBookings(allDates, mumukshus);

  const bookingsToCreate = [];
  const transactionsToCreate = [];
  let amount = 0;
  const userBookingIds = {};

  for (const group of mumukshuGroup) {
    const { meals, spicy, high_tea } = group;
    const mumukshus = group.mumukshus || group.guests;

    const breakfast = meals.includes('breakfast');
    const lunch = meals.includes('lunch');
    const dinner = meals.includes('dinner');

    const mealSelections = { breakfast, lunch, dinner };

    for (const mumukshu of mumukshus) {
      const card = cards.filter((item) => item.cardno == mumukshu)[0];
      const isGuest = card.res_status == STATUS_GUEST;

      var bookingIds = [];
      for (const date of allDates) {
        let bookingId;
        const existingMeals = {};
        const booking = bookings[mumukshu] && bookings[mumukshu][date];
        if (booking) {
          bookingId = booking.id;
          MEALS.forEach((meal) => {
            existingMeals[meal.type] = booking[meal.type];
          });

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
          bookingId = uuidv4();
          bookingsToCreate.push({
            id: bookingId,
            cardno: mumukshu,
            date,
            bookedBy: bookedBy !== mumukshu ? bookedBy : null,
            breakfast,
            lunch,
            dinner,
            spicy,
            hightea: high_tea,
            plateissued: 0,
            updatedBy
          });
        }
        bookingIds.push(bookingId);

        // Only charge for meals for guests
        if (isGuest) {
          MEALS.forEach((meal) => {
            if (mealSelections[meal.type] && !existingMeals[meal.type]) {
              amount += meal.price;

              transactionsToCreate.push({
                cardno: bookedBy,
                bookingid: bookingId,
                category: meal.type,
                amount: meal.price,
                status: cashAllowed
                  ? STATUS_CASH_PENDING
                  : STATUS_PAYMENT_PENDING,
                updatedBy
              });
            }
          });
        }
      }
      userBookingIds[mumukshu] = bookingIds;
    }
  }

  await FoodDb.bulkCreate(bookingsToCreate, { transaction: t });

  const transactions = await Transactions.bulkCreate(transactionsToCreate, {
    transaction: t
  });
  const transactionIds = transactions.map((item) => item.id);
  log.info('food_booking_result', {
    created: bookingsToCreate.length,
    transactions: transactionIds.length,
    amount
  });
  return { amount, userBookingIds, transactionIds };
}

export async function checkFoodAvailabilityForMumumkshus(
  start_date,
  end_date,
  mumukshuGroup,
  primary_booking,
  addons,
  utsav,
  user,
  isGuestBooking = false
) {
  if (!end_date) {
    end_date = start_date;
  }
  validateDate(start_date, end_date);

  const mumukshus = mumukshuGroup.flatMap(
    (group) => group.mumukshus || group.guests
  );
  const cards = await validateCards(mumukshus);

  for (const card of cards) {
    await validateFood(start_date, end_date, primary_booking, addons, card);
  }

  var charge = 0;
  var availableCredits = 0;

  if (isGuestBooking) {
    // Create a temp user with cloned credits to track usage during this validation loop without mutating the original user object.
    const tempUser = { ...user, credits: { ...user.credits } };

    const allDates = getDatesDuringUtsav(start_date, end_date, utsav);
    const bookings = await getFoodBookings(allDates, mumukshus);

    for (const group of mumukshuGroup) {
      const meals = group.meals;
      const mumukshus = group.mumukshus || group.guests;

      for (const date of allDates) {
        for (const mumukshu of mumukshus) {
          const booking = bookings[mumukshu] && bookings[mumukshu][date];

          if (booking) {
            // Only charge for meals that weren't previously booked
            charge +=
              meals.includes('breakfast') && !booking.breakfast
                ? BREAKFAST_PRICE
                : 0;
            charge +=
              meals.includes('lunch') && !booking.lunch ? LUNCH_PRICE : 0;
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

    availableCredits = usableCredits(tempUser, TYPE_FOOD, charge);
  }

  return {
    status: STATUS_AVAILABLE,
    charge,
    availableCredits
  };
}

function getDatesDuringUtsav(start_date, end_date, utsav) {
  let allDates = [];

  if (utsav) {
    const event_start_date = new Date(utsav.start_date);
    const event_end_date = new Date(utsav.end_date);
    if (new Date(start_date) < event_start_date) {
      const beforeEventDates = getDates(start_date, event_start_date);
      beforeEventDates.pop(); // Remove the event start date
      allDates = [...allDates, ...beforeEventDates];
    }
    if (new Date(end_date) > event_end_date) {
      const afterEventDates = getDates(event_end_date, end_date);
      afterEventDates.shift(); // Remove the event end date
      allDates = [...allDates, ...afterEventDates];
    }
  } else {
    allDates = getDates(start_date, end_date);
  }

  return allDates;
}

export async function validateFood(
  start_date,
  end_date,
  primary_booking,
  addons,
  card,
  userRoles = []
) {
  if (
    !(
      [STATUS_RESIDENT, STATUS_SEVA_KUTIR, STATUS_GUEST].includes(
        card.res_status
      ) ||
      [ROLE_FOOD_ADMIN, ROLE_SUPER_ADMIN].some((role) =>
        userRoles.includes(role)
      ) ||
      (await checkRoomBookingProgress(
        start_date,
        end_date,
        primary_booking,
        addons
      )) ||
      (await checkRoomAlreadyBooked(start_date, end_date, card.cardno)) ||
      (await checkFlatAlreadyBooked(start_date, end_date, card.cardno)) ||
      (await checkSpecialAllowance(
        start_date,
        end_date,
        primary_booking,
        addons,
        card.cardno
      ))
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

export async function cancelMeal(user, bookingId, mealType, t) {
  const updateFields = {};

  if (mealType === 'breakfast') updateFields.breakfast = 0;
  if (mealType === 'lunch') updateFields.lunch = 0;
  if (mealType === 'dinner') updateFields.dinner = 0;

  updateFields.updatedBy = user.username;

  await FoodDb.update(updateFields, {
    where: { id: bookingId },
    transaction: t
  });
}

export async function cancelFood(user, cardno, food_data, t, admin = false) {
  const now = moment().tz('Asia/Kolkata');
  const today = now.format('YYYY-MM-DD');
  const tomorrow = now.clone().add(1, 'day').format('YYYY-MM-DD');
  const validDate = admin ? today : tomorrow;

  const validFoodData = food_data.filter((item) => {
    if (admin) {
      return item.date >= validDate;
    }

    const mealCutoffTime = moment.tz(item.date, 'Asia/Kolkata')
      .subtract(1, 'day')
      .hour(20) // 8:00 PM IST previous day
      .minute(0)
      .second(0);

    return now.isSameOrBefore(mealCutoffTime);
  });

  if (food_data.length > 0 && validFoodData.length === 0 && !admin) {
    throw new ApiError(
      400,
      'Bookings can only be cancelled up to 8:00 PM of the previous day'
    );
  }

  const transactions = [];

  for (const item of validFoodData) {
    const { date, mealType, bookedFor } = item;

    const booking = await FoodDb.findOne({
      where: {
        cardno: bookedFor || cardno,
        date
      }
    });

    if (!booking) {
      continue;
    }

    await cancelMeal(user, booking.id, mealType, t);

    // FIXME: guests can book self meals too
    if (bookedFor) {
      const transaction = await Transactions.findOne({
        where: {
          bookingid: booking.id,
          category: mealTypeMapping[mealType]
        }
      });

      if (transaction) {
        transactions.push(transaction);
      }
    }
  }

  await cancelTransactions(user, transactions, t, admin);
}


async function bookFoodForMumukshusDuringUtsav_DEPRECATED(
  start_date,
  end_date,
  mumukshuGroup,
  primary_booking,
  addons,
  updatedBy,
  t,
  userRoles = []
) {
  validateDate(start_date, end_date);

  const utsav = await UtsavDb.findOne({
    where: { id: primary_booking.details.utsavid }
  });
  const event_start_date = new Date(utsav.start_date);
  const event_end_date = new Date(utsav.end_date);

  const mumukshus = mumukshuGroup.flatMap((group) => group.mumukshus);
  const cards = await validateCards(mumukshus);

  for (const card of cards) {
    await validateFood(
      start_date,
      end_date,
      primary_booking,
      addons,
      card,
      userRoles
    );
  }

  let bookingsToCreate = [];
  for (const group of mumukshuGroup) {
    const { meals, spicy, high_tea, mumukshus } = group;

    const breakfast = meals.includes('breakfast');
    const lunch = meals.includes('lunch');
    const dinner = meals.includes('dinner');

    // Handle food booking before the event
    if (new Date(start_date) < event_start_date) {
      const beforeEventDates = getDates(start_date, event_start_date);
      beforeEventDates.pop(); // Remove the event start date

      for (const mumukshu of mumukshus) {
        for (const date of beforeEventDates) {
          if (new Date(date) < event_start_date) {
            // Ensure date is before event
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

    // Handle food booking after the event
    if (new Date(end_date) > event_end_date) {
      const afterEventDates = getDates(event_end_date, end_date);
      afterEventDates.shift(); // Remove the event end date

      for (const mumukshu of mumukshus) {
        for (const date of afterEventDates) {
          if (new Date(date) > event_end_date) {
            // Ensure date is after event
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
  }

  await FoodDb.bulkCreate(bookingsToCreate, { transaction: t });
  return t;
}

export async function bookFoodForAllMeals(
  start_date,
  end_date,
  starting_meal,
  ending_meal,
  cardno,
  t,
  updatedBy
) {

  const allDates = getDates(start_date, end_date);

  const foodBookings = await FoodDb.findAll({
    where: {
      cardno: cardno,
      date: allDates
    },
    transaction: t
  });

  const bookingsToCreate = [], bookingsToUpdate = [];

  const firstDay = allDates[0];
  const lastDay = allDates.at(-1);

  for (const date of allDates) {
    const foodBooking = foodBookings.find((item) => item.date === date);

    let breakfast = 1, lunch = 1, dinner = 1;

    if (date === firstDay && starting_meal?.length) {
      breakfast = starting_meal.includes('breakfast') ? 1 : 0;
      lunch     = starting_meal.includes('lunch')     ? 1 : 0;
      dinner    = starting_meal.includes('dinner')    ? 1 : 0;
    }

    if (date === lastDay && ending_meal?.length) {
      breakfast = ending_meal.includes('breakfast') ? 1 : 0;
      lunch     = ending_meal.includes('lunch')     ? 1 : 0;
      dinner    = ending_meal.includes('dinner')    ? 1 : 0;
    }

    if (foodBooking) {
      foodBooking.breakfast = breakfast;
      foodBooking.lunch = lunch;
      foodBooking.dinner = dinner;
      foodBooking.spicy = 1;
      foodBooking.hightea = 'TEA';
      foodBooking.updatedBy = updatedBy;
      bookingsToUpdate.push(foodBooking);

      continue;
    }
    bookingsToCreate.push({
      id: uuidv4(),
      cardno: cardno,
      date: date,
      breakfast,
      lunch,
      dinner,
      spicy: 1,
      hightea: 'TEA',
      updatedBy: updatedBy
    });
  }
  if (bookingsToCreate.length > 0) {
    await FoodDb.bulkCreate(bookingsToCreate, { transaction: t });
  }
  if (bookingsToUpdate.length > 0) {
    await Promise.all(bookingsToUpdate.map(booking => booking.save({ transaction: t })));
  }

}

export async function cancelAllMeals(start_date, end_date, cardno, updatedBy, t) {
  const allDates = getDates(start_date, end_date);

  await FoodDb.update(
    { breakfast: 0, lunch: 0, dinner: 0, updatedBy: updatedBy },
    { where: { cardno: cardno, date: allDates }, transaction: t }
  );
}



export async function issueFoodPlate(cardno, meal, t, providedDate = null, scannedAt = null) {
  // ✅ Use scannedAt timestamp if provided, fallback to providedDate or current IST date
  const referenceTime = scannedAt ? moment(scannedAt).tz('Asia/Kolkata') : moment().tz('Asia/Kolkata');
  const targetDate = providedDate
    ? moment.tz(providedDate, 'Asia/Kolkata').format('YYYY-MM-DD')
    : referenceTime.format('YYYY-MM-DD');

  const currentTime = referenceTime;
  const mealTimes = {
    breakfast: referenceTime.clone().hour(10).minute(0).second(0), // Ends at 10:00 AM IST
    lunch: referenceTime.clone().hour(14).minute(0).second(0),     // Ends at 2:00 PM IST
    dinner: referenceTime.clone().hour(19).minute(0).second(0)     // Ends at 7:00 PM IST
  };

  // ✅ Find booking for the TARGET DATE (not always today)
  const booking = await FoodDb.findOne({
    where: {
      cardno: cardno,
      date: targetDate // ✅ CRITICAL FIX: Use target date instead of currentTime
    },
    transaction: t
  });

  if (!booking) {
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  const card = await CardDb.findOne({
    where: { cardno: cardno }
  });

  if (!card) {
    throw new ApiError(404, 'Card not found');
  }

  let currentMeal = meal;

  // Only auto-detect meal if not provided
  if (!currentMeal) {
    for (const mealType of ['breakfast', 'lunch', 'dinner']) {
      if (currentTime.isSameOrBefore(mealTimes[mealType])) {
        currentMeal = mealType;
        break;
      }
    }
  } else if (!['breakfast', 'lunch', 'dinner'].includes(currentMeal)) {
    throw new ApiError(400, 'Invalid meal type provided');
  }

  if (!currentMeal) {
    throw new ApiError(400, ERR_INVALID_MEAL_TIME);
  }

  if (!booking[currentMeal]) {
    throw new ApiError(400, `${currentMeal} not booked`);
  }

  const plateField = `${currentMeal}_plate_issued`;

  if (booking[plateField]) {
    throw new ApiError(400, `Plate for ${currentMeal} already issued`);
  }

  await booking.update({ [plateField]: true }, { transaction: t });

  logger.info('food_plate_issued', { cardno, meal: currentMeal, targetDate });

  return {
    message: `Plate for ${currentMeal} issued successfully`,
    issuedto: card.issuedto
  };
}
