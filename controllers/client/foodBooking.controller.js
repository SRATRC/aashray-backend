import {
  FoodDb,
  GuestDb,
  Menu
} from '../../models/associations.js';
import {
  MSG_CANCEL_SUCCESSFUL
} from '../../config/constants.js';
import database from '../../config/database.js';
import Sequelize, { col, QueryTypes } from 'sequelize';
import moment from 'moment';
import { cancelFood } from '../../helpers/foodBooking.helper.js';

const mealTimes = {
  breakfast: '7:30 AM - 9:00 AM',
  lunch: '12:00 PM - 2:00 PM',
  dinner: '7:00 PM - 9:00 PM'
};

export const FetchFoodBookings = async (req, res) => {
  const {
    date,
    meal = 'all',
    spice = 'all',
    bookedFor = 'all',
    page,
    page_size
  } = req.query;
  const page_no = parseInt(page) || 1;
  const pageSize = parseInt(page_size) || 10;
  const offset = (page_no - 1) * pageSize;

  const today = moment().format('YYYY-MM-DD');
  const dateFilter = date ? { date } : {};

  const mealFilter = (mealType, exists) => {
    if (meal === 'all') return exists;
    return meal.split(',').includes(mealType) && exists;
  };

  const spiceFilter = (spiceValue) => {
    if (spice === 'all') return true;
    return spice === 'true' ? spiceValue === true : spiceValue === false;
  };

  const isSelf = bookedFor === 'self';
  const isGuest = !isNaN(Number(bookedFor));

  const foodData = await FoodDb.findAll({
    attributes: [
      'id',
      'date',
      'breakfast',
      'lunch',
      'dinner',
      'spicy',
      [col('FoodDb.guest'), 'bookedFor']
    ],
    where: {
      cardno: req.query.cardno,
      ...dateFilter,
      ...(isSelf && { guest: null }),
      ...(isGuest && { guest: bookedFor })
    },
    include: [
      {
        model: GuestDb,
        attributes: ['id', 'name']
      }
    ],
    order: [['date', 'DESC']],
    offset,
    limit: pageSize
  });

  const formattedData = foodData.flatMap((item) => {
    const { id, date, breakfast, lunch, dinner, spicy, bookedFor, GuestDb } =
      item.dataValues;
    const name = GuestDb ? GuestDb.name : null;

    return [
      breakfast && { id, date, mealType: 'breakfast', spicy, bookedFor, name },
      lunch && { id, date, mealType: 'lunch', spicy, bookedFor, name },
      dinner && { id, date, mealType: 'dinner', spicy, bookedFor, name }
    ].filter(Boolean); // Remove null entries (if mealType is not present)
  });

  // Apply meal and spice filters
  const filteredData = formattedData.filter(
    (item) => mealFilter(item.mealType, true) && spiceFilter(item.spicy)
  );

  let groupedData = [];
  const upcomingData = filteredData.filter((item) =>
    moment(item.date).isSameOrAfter(today)
  );
  const pastData = filteredData.filter((item) =>
    moment(item.date).isBefore(today)
  );

  if (upcomingData.length > 0) {
    groupedData.push({
      title: 'upcoming',
      data: upcomingData
    });
  }

  if (pastData.length > 0) {
    groupedData.push({
      title: 'past',
      data: pastData
    });
  }

  return res
    .status(200)
    .send({ message: 'fetched results', data: groupedData });
};

export const FetchGuestsForFilter = async (req, res) => {
  const { cardno } = req.user;

  const guests = await database.query(
    `
    SELECT DISTINCT f.guest, g.name, f.updatedAt
    FROM food_db f
    JOIN guest_db g ON f.guest = g.id
    WHERE f.cardno = :cardno
    ORDER BY f.updatedAt DESC;
    `,
    { replacements: { cardno: cardno }, type: QueryTypes.SELECT }
  );

  const formattedGuests = guests.flat().map((guest) => ({
    key: guest.guest,
    value: guest.name
  }));

  var guestNames = [];
  guestNames.push({ key: 'all', value: 'All' });
  guestNames.push({ key: 'self', value: 'Self' });
  guestNames.push(...formattedGuests);

  return res.status(200).send({
    message: 'fetched results',
    data: guestNames
  });
};

export const CancelFood = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const { cardno, food_data } = req.body;

  await cancelFood(
    req.user, 
    cardno, 
    food_data,
    t
  );

  await t.commit();
  return res.status(200).send({ message: MSG_CANCEL_SUCCESSFUL });
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
