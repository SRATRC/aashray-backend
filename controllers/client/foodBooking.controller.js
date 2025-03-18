import Sequelize, { QueryTypes } from 'sequelize';
import { cancelFood } from '../../helpers/foodBooking.helper.js';
import { Menu } from '../../models/associations.js';
import { MSG_CANCEL_SUCCESSFUL } from '../../config/constants.js';
import database from '../../config/database.js';
import moment from 'moment';

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

  const foodData = await database.query(
    `
    SELECT 
      f.id,
      f.date,
      f.breakfast,
      f.lunch,
      f.dinner,
      f.spicy,
      f.bookedBy,
      f.cardno as bookedFor,
      c.issuedto as name
    FROM food_db f
    LEFT JOIN card_db c ON f.cardno = c.cardno
    WHERE (f.cardno = :userCardno OR f.bookedBy = :userCardno)
      ${date ? 'AND f.date = :date' : ''}
      ${isSelf ? 'AND f.bookedBy IS NULL' : ''}
      ${isGuest ? 'AND f.cardno = :bookedFor' : ''}
    ORDER BY f.date DESC
    LIMIT :limit 
    OFFSET :offset
    `,
    {
      replacements: {
        userCardno: req.user.cardno,
        date: date,
        bookedFor: bookedFor,
        limit: pageSize,
        offset: offset
      },
      type: QueryTypes.SELECT
    }
  );

  const formattedData = foodData.flatMap((item) => {
    const {
      id,
      date,
      breakfast,
      lunch,
      dinner,
      spicy,
      bookedFor,
      bookedBy,
      name
    } = item;

    return [
      breakfast && {
        id,
        date,
        mealType: 'breakfast',
        spicy,
        bookedFor,
        bookedBy,
        name
      },
      lunch && {
        id,
        date,
        mealType: 'lunch',
        spicy,
        bookedFor,
        bookedBy,
        name
      },
      dinner && {
        id,
        date,
        mealType: 'dinner',
        spicy,
        bookedFor,
        bookedBy,
        name
      }
    ].filter(Boolean);
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
    SELECT f.cardno AS bookedFor, c.issuedto AS name, MAX(f.updatedAt) AS latestUpdate
    FROM food_db f
    JOIN card_db c ON f.cardno = c.cardno
    WHERE f.bookedBy = :cardno
    GROUP BY f.cardno, c.issuedto
    ORDER BY latestUpdate DESC;
    `,
    { replacements: { cardno: cardno }, type: QueryTypes.SELECT }
  );

  const formattedGuests = guests.flat().map((guest) => ({
    key: guest.bookedFor,
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

  await cancelFood(req.user, cardno, food_data, t);

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
