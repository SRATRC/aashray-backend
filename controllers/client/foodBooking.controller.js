import Sequelize, { QueryTypes } from 'sequelize';
import { cancelFood } from '../../helpers/foodBooking.helper.js';
import { Menu } from '../../models/associations.js';
import { MSG_CANCEL_SUCCESSFUL } from '../../config/constants.js';
import { attachUserContext } from '../../middleware/Logger.js';
import ApiError from '../../utils/ApiError.js';
import database from '../../config/database.js';
import moment from 'moment';

const mealTimes = {
  breakfast: '7:45 AM - 8:45 AM',
  lunch: '12:00 PM - 1:00 PM',
  dinner: '5:45 PM - 6:45 PM'
};

export const FetchFoodBookings = async (req, res) => {
  attachUserContext(req);
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

  req.log.info('fetch_food_bookings_start', {
    cardno: req.user.cardno,
    date,
    meal,
    spice,
    bookedFor,
    page: page_no,
    pageSize
  });

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
    ORDER BY meals.date ASC, FIELD(meals.mealType,'breakfast','lunch','dinner') ASC, meals.id
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

  req.log.info('fetch_food_bookings_success', { cardno: req.user.cardno, count: foodData.length });
  return res.status(200).send({ message: 'fetched results', data: foodData });
};

export const FetchGuestsForFilter = async (req, res) => {
  attachUserContext(req);
  const { cardno } = req.user;
  req.log.info('fetch_food_guests_filter_start', { cardno });

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

  req.log.info('fetch_food_guests_filter_success', { cardno, count: formattedGuests.length });
  return res.status(200).send({
    message: 'fetched results',
    data: guestNames
  });
};

export const CancelFood = async (req, res) => {
  attachUserContext(req);
  const t = await database.transaction();
  req.transaction = t;

  const { cardno, food_data } = req.body;
  req.log.info('cancel_food_start', {
    requestedBy: req.user.cardno,
    cancelForCardno: cardno,
    mealCount: Array.isArray(food_data) ? food_data.length : 0
  });

  if (!cardno || !Array.isArray(food_data)) {
    req.log.warn('cancel_food_invalid_data', { cardno: req.user.cardno });
    throw new ApiError(400, 'Invalid request data');
  }

  await cancelFood(req.user, cardno, food_data, t);
  req.log.info('cancel_food_cancelled', {
    requestedBy: req.user.cardno,
    cancelForCardno: cardno,
    mealCount: food_data.length
  });

  await t.commit();
  req.log.info('cancel_food_success', { requestedBy: req.user.cardno, cancelForCardno: cardno });
  return res.status(200).send({ message: MSG_CANCEL_SUCCESSFUL });
};

export const fetchMenu = async (req, res) => {
  req.log.info('fetch_menu_start');
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
    req.log.info('fetch_menu_empty');
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

  req.log.info('fetch_menu_success', { dateCount: Object.keys(formattedMenu).length });
  return res.status(200).send({ data: formattedMenu });
};
