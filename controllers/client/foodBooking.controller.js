import {
  FoodDb,
  GuestFoodDb,
  GuestFoodTransactionDb,
  Menu
} from '../../models/associations.js';
import {
  BREAKFAST_PRICE,
  LUNCH_PRICE,
  DINNER_PRICE,
  TYPE_EXPENSE,
  STATUS_RESIDENT
} from '../../config/constants.js';
import {
  checkRoomAlreadyBooked,
  checkFlatAlreadyBooked,
  checkSpecialAllowance,
  isFoodBooked,
  validateDate
} from '../helper.js';
import getDates from '../../utils/getDates.js';
import database from '../../config/database.js';
import Sequelize from 'sequelize';
import moment from 'moment';
import { v4 as uuidv4 } from 'uuid';
import ApiError from '../../utils/ApiError.js';

const mealTimes = {
  breakfast: '7:30 AM - 9:00 AM',
  lunch: '12:00 PM - 2:00 PM',
  dinner: '7:00 PM - 9:00 PM'
};

// TODO: DEPRECATE THIS ENDPOINT
export const RegisterFood = async (req, res) => {
  validateDate(req.body.start_date, req.body.end_date);

  if (
    await isFoodBooked(req.body.start_date, req.body.end_date, req.user.cardno)
  )
    throw new ApiError(403, 'Food already booked');

  if (
    !(
      (await checkRoomAlreadyBooked(
        req.body.start_date,
        req.body.end_date,
        req.user.cardno
      )) ||
      (await checkFlatAlreadyBooked(
        req.body.start_date,
        req.body.end_date,
        req.user.cardno
      )) ||
      req.user.res_status === STATUS_RESIDENT ||
      (await checkSpecialAllowance(
        req.body.start_date,
        req.body.end_date,
        req.user.cardno
      ))
    )
  ) {
    throw new ApiError(
      403,
      'You do not have a room booked on one or more dates selected'
    );
  }

  const allDates = getDates(req.body.start_date, req.body.end_date);

  var food_data = [];
  for (var date of allDates) {
    food_data.push({
      cardno: req.user.cardno,
      date: date,
      breakfast: req.body.breakfast,
      lunch: req.body.lunch,
      dinner: req.body.dinner,
      hightea: req.body.high_tea,
      spicy: req.body.spicy,
      plateissued: 0
    });
  }

  await FoodDb.bulkCreate(food_data);

  return res.status(201).send({
    message: 'Food Booked successfully'
  });
};

export const RegisterForGuest = async (req, res) => {
  const { start_date, end_date, guest_count, breakfast, lunch, dinner } =
    req.body;

  validateDate(start_date, end_date);

  const t = await database.transaction();
  req.transaction = t;

  const allDates = getDates(start_date, end_date);
  const days = allDates.length;

  var food_data = [];
  const bookingid = uuidv4();
  for (var date of allDates) {
    food_data.push({
      bookingid: bookingid,
      cardno: req.user.cardno,
      date: date,
      guest_count: guest_count,
      breakfast: req.body.breakfast,
      lunch: req.body.lunch,
      dinner: req.body.dinner
    });
  }

  await GuestFoodDb.bulkCreate(food_data, { transaction: t });

  const food_cost =
    (breakfast ? BREAKFAST_PRICE : 0) +
    (lunch ? LUNCH_PRICE : 0) +
    (dinner ? DINNER_PRICE : 0);
  const amount = food_cost * guest_count * days;

  await GuestFoodTransactionDb.create(
    {
      cardno: req.user.cardno,
      bookingid: bookingid,
      type: TYPE_EXPENSE,
      amount: amount,
      description: `Food Booking for ${guest_count} guests`
    },
    { transaction: t }
  );

  await t.commit();

  return res.status(201).send({ message: 'successfully booked guest food' });
};

// TODO: Implementation of this function
export const updateGuestCount = async (req, res) => {
  const { bookingid, guest_count } = req.body;
};

export const FetchFoodBookings = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;
  const offset = (page - 1) * pageSize;

  const today = moment().format('YYYY-MM-DD');

  const data = await FoodDb.findAll({
    attributes: ['date', 'breakfast', 'lunch', 'dinner', 'spicy'],
    where: {
      cardno: req.query.cardno
    },
    order: [['date', 'DESC']],
    offset,
    limit: pageSize
  });

  const groupedData = data.reduce((acc, item) => {
    const { id, date, breakfast, lunch, dinner, spicy } = item.dataValues;
    const classify = date > today + 1 ? 'upcoming' : 'past';

    const meals = [
      { type: 'breakfast', exists: breakfast },
      { type: 'lunch', exists: lunch },
      { type: 'dinner', exists: dinner }
    ];

    meals.forEach(({ type, exists }) => {
      if (exists) {
        const mealData = { date, mealType: type, spicy };

        if (!acc[classify]) {
          acc[classify] = [];
        }

        acc[classify].push(mealData);
      }
    });

    return acc;
  }, {});

  const responseData = Object.keys(groupedData).map((key) => ({
    title: key,
    data: groupedData[key]
  }));

  return res
    .status(200)
    .send({ message: 'fetched results', data: responseData });
};

export const FetchGuestFoodBookings = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;
  const offset = (page - 1) * pageSize;

  const today = moment().format('YYYY-MM-DD');

  const data = await GuestFoodDb.findAll({
    where: {
      cardno: req.query.cardno,
      date: {
        [Sequelize.Op.gte]: today
      }
    },
    order: [['date', 'ASC']],
    offset,
    limit: pageSize
  });
  return res.status(200).send({ message: 'fetched results', data: data });
};

export const CancelFood = async (req, res) => {
  const t = await database.transaction();

  const { cardno, food_data } = req.body;
  const today = moment().format('YYYY-MM-DD');
  const foodData = food_data.filter((item) => item.date > today + 1);

  // Group updates by mealType
  const updates = foodData.reduce((acc, item) => {
    if (!acc[item.mealType]) {
      acc[item.mealType] = [];
    }
    acc[item.mealType].push(item.date);
    return acc;
  }, {});

  // Perform updates in bulk for each mealType
  for (const [mealType, dates] of Object.entries(updates)) {
    const updateFields = {};
    updateFields[mealType] = 0;
    updateFields['updatedBy'] = 'user';

    await FoodDb.update(updateFields, {
      where: {
        cardno: cardno,
        date: dates
      },
      transaction: t
    });
  }

  await FoodDb.destroy({
    where: {
      cardno: cardno,
      breakfast: false,
      lunch: false,
      dinner: false
    },
    transaction: t
  });

  await t.commit();
  return res
    .status(200)
    .send({ message: 'Successfully Canceled Food Booking' });
};

export const CancelGuestFood = async (req, res) => {
  const updateData = req.body.food_data;

  const t = await database.transaction();

  for (let i = 0; i < updateData.length; i++) {
    const isAvailable = await GuestFoodDb.findOne({
      where: {
        cardno: req.body.cardno,
        bookingid: req.body.food_data[i].bookingid,
        date: req.body.food_data[i].date
      }
    });
    if (!isAvailable) continue;

    await GuestFoodDb.update(
      {
        guest_count: updateData[i].guest_count,
        breakfast: updateData[i].breakfast,
        lunch: updateData[i].lunch,
        dinner: updateData[i].dinner,
        updatedBy: 'user'
      },
      {
        where: {
          id: updateData[i].id
        },
        transaction: t
      }
    );
  }

  await GuestFoodDb.destroy({
    where: {
      breakfast: false,
      lunch: false,
      dinner: false
    },
    transaction: t
  });

  await t.commit();

  const revisedPayments = await GuestFoodDb.findAll({
    where: {
      bookingid: updateData[0].bookingid
    }
  });

  var total = 0;

  for (let data of revisedPayments) {
    total +=
      data.dataValues.guest_count *
      ((data.dataValues.breakfast ? BREAKFAST_PRICE : 0) +
        (data.dataValues.lunch ? LUNCH_PRICE : 0) +
        (data.dataValues.dinner ? DINNER_PRICE : 0));
  }

  const makeTransaction = await GuestFoodTransactionDb.update(
    {
      amount: total,
      updatedBy: 'user'
    },
    {
      where: {
        bookingid: updateData[0].bookingid
      }
    }
  );

  if (makeTransaction != 1)
    throw new ApiError(500, 'Error occured while updating transaction');

  return res.status(200).send({ message: 'Successfully deleted' });
};

export const fetchMenu = async (req, res) => {
  const menuItems = await Menu.findAll({
    attributes: ['date', 'breakfast', 'lunch', 'dinner'],
    where: {
      date: {
        [Sequelize.Op.gte]: moment().format('YYYY-MM-DD')
      }
    },
    order: [['date', 'ASC']]
  });

  if (menuItems.length === 0) {
    return res.status(404).json({ data: null, message: 'No menu available' });
  }

  const formattedMenu = menuItems.reduce(
    (acc, { date, breakfast, lunch, dinner }) => {
      acc[date] = [
        { meal: 'Breakfast', name: breakfast, time: mealTimes.breakfast },
        { meal: 'Lunch', name: lunch, time: mealTimes.lunch },
        { meal: 'Dinner', name: dinner, time: mealTimes.dinner }
      ];
      return acc;
    },
    {}
  );

  return res.status(200).send({ data: formattedMenu });
};
