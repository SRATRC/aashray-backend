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
  const pageSize = parseInt(page_size) || 15;
  const offset = (page_no - 1) * pageSize;

  const today = moment().format('YYYY-MM-DD');

  const isSelf = bookedFor === 'self';
  const isGuest = !isNaN(Number(bookedFor));

  let mealConditions = [];
  if (meal !== 'all') {
    const mealTypes = meal.split(',');
    if (mealTypes.includes('breakfast')) {
      mealConditions.push("'breakfast'");
    }
    if (mealTypes.includes('lunch')) {
      mealConditions.push("'lunch'");
    }
    if (mealTypes.includes('dinner')) {
      mealConditions.push("'dinner'");
    }
  }

  let spiceCondition = '';
  if (spice === 'true') {
    spiceCondition = 'AND meals.spicy = 1';
  } else if (spice === 'false') {
    spiceCondition = 'AND meals.spicy = 0';
  }

  let mealTypeCondition = '';
  if (meal !== 'all' && mealConditions.length > 0) {
    mealTypeCondition = `AND meals.mealType IN (${mealConditions.join(', ')})`;
  }

  const foodData = await database.query(
    `
    SELECT * FROM (
      SELECT 
        f.id,
        f.date,
        'breakfast' as mealType,
        f.spicy,
        f.cardno as bookedFor,
        f.bookedBy,
        c.issuedto as name
      FROM food_db f
      LEFT JOIN card_db c ON f.cardno = c.cardno
      WHERE (f.cardno = :userCardno OR f.bookedBy = :userCardno)
        AND f.date >= :today
        AND f.breakfast = 1
        ${date ? 'AND f.date = :date' : ''}
        ${isSelf ? 'AND f.bookedBy IS NULL' : ''}
        ${isGuest ? 'AND f.cardno = :bookedFor' : ''}
      
      UNION ALL
      
      SELECT 
        f.id,
        f.date,
        'lunch' as mealType,
        f.spicy,
        f.cardno as bookedFor,
        f.bookedBy,
        c.issuedto as name
      FROM food_db f
      LEFT JOIN card_db c ON f.cardno = c.cardno
      WHERE (f.cardno = :userCardno OR f.bookedBy = :userCardno)
        AND f.date >= :today
        AND f.lunch = 1
        ${date ? 'AND f.date = :date' : ''}
        ${isSelf ? 'AND f.bookedBy IS NULL' : ''}
        ${isGuest ? 'AND f.cardno = :bookedFor' : ''}
      
      UNION ALL
      
      SELECT 
        f.id,
        f.date,
        'dinner' as mealType,
        f.spicy,
        f.cardno as bookedFor,
        f.bookedBy,
        c.issuedto as name
      FROM food_db f
      LEFT JOIN card_db c ON f.cardno = c.cardno
      WHERE (f.cardno = :userCardno OR f.bookedBy = :userCardno)
        AND f.date >= :today
        AND f.dinner = 1
        ${date ? 'AND f.date = :date' : ''}
        ${isSelf ? 'AND f.bookedBy IS NULL' : ''}
        ${isGuest ? 'AND f.cardno = :bookedFor' : ''}
    ) as meals
    WHERE 1=1
      ${mealTypeCondition}
      ${spiceCondition}
    ORDER BY meals.date ASC
    LIMIT :limit 
    OFFSET :offset
    `,
    {
      replacements: {
        userCardno: req.user.cardno,
        today: today,
        date: date,
        bookedFor: bookedFor,
        limit: pageSize,
        offset: offset
      },
      type: QueryTypes.SELECT
    }
  );

  return res.status(200).send({ message: 'fetched results', data: foodData });
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
    return res.status(200).json({ data: null });
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
