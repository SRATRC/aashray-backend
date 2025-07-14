import {
  BREAKFAST_PRICE,
  DINNER_PRICE,
  ERR_ROOM_MUST_BE_BOOKED,
  LUNCH_PRICE,
  ROLE_FOOD_ADMIN,
  ROLE_SUPER_ADMIN,
  STATUS_CASH_PENDING,
  STATUS_GUEST,
  STATUS_PAYMENT_PENDING,
  STATUS_RESIDENT,
  STATUS_SEVA_KUTIR,
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
import {
  CardDb,
  FoodDb,
  Transactions,
  UtsavDb
} from '../models/associations.js';
import { validateCards } from './card.helper.js';
import { checkRoomAlreadyBooked } from './roomBooking.helper.js';
import { v4 as uuidv4 } from 'uuid';
import { cancelTransactions } from './transactions.helper.js';
import ApiError from '../utils/ApiError.js';
import getDates from '../utils/getDates.js';
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
  userRoles = []
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
      card,
      userRoles
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
          await booking.update(
            {
              breakfast: booking.breakfast || breakfast,
              lunch: booking.lunch || lunch,
              dinner: booking.dinner || dinner,
              hightea: high_tea,
              spicy,
              updatedBy: updatedBy ? updatedBy : bookedBy
            },
            { transaction: t }
          );
        } else {
          bookingsToCreate.push({
            id: uuidv4(),
            cardno: mumukshu,
            date,
            bookedBy: bookedBy !== mumukshu ? bookedBy : null,
            breakfast,
            lunch,
            dinner,
            spicy,
            hightea: high_tea,
            plateissued: 0,
            updatedBy: updatedBy ? updatedBy : bookedBy
          });
        }
      }
    }
  }

  await FoodDb.bulkCreate(bookingsToCreate, { transaction: t });
  return t;
}

export async function bookFoodForGuests(
  start_date,
  end_date,
  guestGroup,
  bookedBy,
  updatedBy,
  t,
  utsaveId,
  cashAllowed = false
) {
  const meals_object = [
    {
      name: 'breakfast',
      price: BREAKFAST_PRICE,
      type: TYPE_GUEST_BREAKFAST
    },
    {
      name: 'lunch',
      price: LUNCH_PRICE,
      type: TYPE_GUEST_LUNCH
    },
    {
      name: 'dinner',
      price: DINNER_PRICE,
      type: TYPE_GUEST_DINNER
    }
  ];

  validateDate(start_date, end_date);

  const guests = guestGroup.flatMap((group) => group.guests);
  const guestDb = await CardDb.findAll({
    where: { cardno: guests, res_status: STATUS_GUEST },
    attributes: ['cardno']
  });

  if (guestDb.length != guests.length) {
    throw new ApiError(404, 'Guest not found');
  }

  let allDates = [];

  if (utsaveId) {
    const utsav = await UtsavDb.findOne({
      where: { id: utsaveId }
    });
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

  const bookings = await getFoodBookings(allDates, guests);

  var bookingsToCreate = [];
  var transactionsToCreate = [];
  var amount = 0;
  const userBookingIds = {};

  for (const group of guestGroup) {
    const { meals, spicy, high_tea, guests } = group;

    const breakfast = meals.includes('breakfast');
    const lunch = meals.includes('lunch');
    const dinner = meals.includes('dinner');

    const mealSelections = { breakfast, lunch, dinner };

    for (const guest of guests) {
      const bookingIds = [];
      for (const date of allDates) {
        const booking = bookings[guest] && bookings[guest][date];

        if (booking) {
          // Only charge for meals that weren't previously booked
          meals_object.forEach((meal) => {
            if (mealSelections[meal.name] && !booking[meal.name]) {
              amount += meal.price;

              transactionsToCreate.push({
                cardno: bookedBy || guest,
                bookingid: booking.dataValues.id,
                category: meal.type,
                amount: meal.price,
                status: cashAllowed
                  ? STATUS_CASH_PENDING
                  : STATUS_PAYMENT_PENDING,
                updatedBy
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
              updatedBy
            },
            { transaction: t }
          );

          bookingIds.push(booking.id);
        } else {
          const bookingId = uuidv4();

          bookingsToCreate.push({
            id: bookingId,
            cardno: guest,
            bookedBy: bookedBy,
            date,
            breakfast,
            lunch,
            dinner,
            spicy,
            hightea: high_tea,
            plateissued: 0,
            updatedBy
          });

          meals_object.forEach((meal) => {
            if (mealSelections[meal.name]) {
              amount += meal.price;

              transactionsToCreate.push({
                cardno: bookedBy || guest,
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

          bookingIds.push(bookingId);
        }
      }
      userBookingIds[guest] = bookingIds;
    }
  }

  await FoodDb.bulkCreate(bookingsToCreate, { transaction: t });
  const transactions = await Transactions.bulkCreate(transactionsToCreate, {
    transaction: t
  });
  const transactionIds = transactions.map((item) => item.id);

  return { amount, userBookingIds, transactionIds };
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
      card.res_status === STATUS_RESIDENT ||
      card.res_status === STATUS_SEVA_KUTIR ||
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

export function createGroupFoodRequestForGuest(
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
      guests: [cardno],
      meals,
      spicy,
      high_tea
    }
  ];
}

export async function cancelMeal(user, bookingId, mealType, t) {
  // Create the update object: setting the specific meal to 0 (cancelled)
  const updateFields = {};

  if (mealType === 'breakfast') updateFields.breakfast = 0;
  if (mealType === 'lunch') updateFields.lunch = 0;
  if (mealType === 'dinner') updateFields.dinner = 0;

  updateFields.updatedBy = user.username;

  // Update the meal booking
  await FoodDb.update(updateFields, {
    where: { id: bookingId },
    transaction: t
  });
}

export async function cancelFood(user, cardno, food_data, t, admin = false) {
  const today = moment().format('YYYY-MM-DD');
  const validDate = admin ? today : today + 1;
  const validFoodData = food_data.filter((item) => item.date >= validDate);

  const transactions = [];

  for (const item of validFoodData) {
    const { date, mealType, bookedFor } = item;

    // Fetch the booking from the database to get the id
    const booking = await FoodDb.findOne({
      where: {
        cardno: bookedFor || cardno,
        date
      }
    });

    if (!booking) {
      continue; // Skip if no matching booking found
    }

    await cancelMeal(user, booking.id, mealType, t);

    // Handle guest meal transaction cancellation
    if (bookedFor) {
      // Find and update the transaction to mark it as credited
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
