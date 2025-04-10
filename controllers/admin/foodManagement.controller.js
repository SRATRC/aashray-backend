import {
  BulkFoodBooking,
  CardDb,
  FoodDb,
  FoodPhysicalPlate,
  Menu
} from '../../models/associations.js';
import {
  MSG_CANCEL_SUCCESSFUL,
  ERR_BOOKING_NOT_FOUND,
  ERR_INVALID_MEAL_TIME,
  MSG_BOOKING_SUCCESSFUL,
  MSG_FETCH_SUCCESSFUL,
  MSG_UPDATE_SUCCESSFUL
} from '../../config/constants.js';
import { v4 as uuidv4 } from 'uuid';
import database from '../../config/database.js';
import moment from 'moment';
import Sequelize from 'sequelize';
import ApiError from '../../utils/ApiError.js';
import { bookFoodForMumukshus, cancelFood, createGroupFoodRequest } from '../../helpers/foodBooking.helper.js';
import { findCardByMobno } from '../../helpers/card.helper.js';

export const issuePlate = async (req, res) => {
  const currentTime = moment.utc();
  const mealTimes = {
    breakfast: moment.utc().hour(4).minute(30).second(0),
    lunch: moment.utc().hour(8).minute(30).second(0),
    dinner: moment.utc().hour(13).minute(30).second(0)
  };

  const booking = await FoodDb.findOne({
    where: {
      cardno: req.params.cardno,
      date: currentTime.format('YYYY-MM-DD')
    }
  });

  if (!booking) {
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  // Determine current meal period
  let currentMeal = null;
  for (const meal of ['breakfast', 'lunch', 'dinner']) {
    if (currentTime.isSameOrBefore(mealTimes[meal])) {
      currentMeal = meal;
      break;
    }
  }

  if (!currentMeal) {
    throw new ApiError(400, ERR_INVALID_MEAL_TIME);
  }

  // Check if meal is booked
  if (!booking[currentMeal]) {
    throw new ApiError(400, `${currentMeal} not booked`);
  }

  // Check if plate is already issued
  const plateField = `${currentMeal}_plate_issued`;
  if (booking[plateField]) {
    throw new ApiError(400, `Plate for ${currentMeal} already issued`);
  }

  // Issue plate
  await booking.update(
    {
      [plateField]: true
    }
  );

  return res.status(200).send({ message: `Plate for ${currentMeal} issued successfully` });
};

export const physicalPlatesIssued = async (req, res) => {
  const { date, type, count } = req.body;

  const alreadyExists = await FoodPhysicalPlate.findOne({
    where: {
      date: date,
      type: type
    }
  });
  if (alreadyExists)
    throw new ApiError(
      400,
      `Physical plate count already exists for ${type} on ${date}`
    );

  await FoodPhysicalPlate.create({
    date: date,
    type: type,
    count: count,
    updatedBy: req.user.username
  });

  return res
    .status(200)
    .send({ message: 'Added plate count successfully' });
};

export const fetchPhysicalPlateIssued = async (req, res) => {
  
  const data = await FoodPhysicalPlate.findAll({
    order: [['date', 'ASC']]
  });

  return res
    .status(200)
    .send({ message: MSG_FETCH_SUCCESSFUL, data: data });
};

export const bookFood = async (req, res) => {
  var cardno = req.body.cardno;
  const {
    mobno,
    start_date, 
    end_date, 
    breakfast, 
    lunch,
    dinner,
    spicy,
    hightea
  } = req.body;

  var t = await database.transaction();
  req.transaction = t;

  if (!cardno && mobno) {
    cardno = (await findCardByMobno(mobno)).cardno;
  }

  const mumukshuGroup = createGroupFoodRequest(
    cardno,
    breakfast,
    lunch,
    dinner, 
    spicy,
    hightea
  );
  
  await bookFoodForMumukshus(
    start_date,
    end_date,
    mumukshuGroup,
    null,
    null,
    req.user.username,
    t
  );

  await t.commit();
  return res.status(200).send({ message: MSG_BOOKING_SUCCESSFUL });
};

export const fetchFoodBookings = async (req, res) => {
  var { cardno, mobno } = req.query;

  if ((cardno == undefined || cardno == "") && mobno) {
    cardno = (await findCardByMobno(mobno)).cardno;
  }

  const today = moment().format('YYYY-MM-DD');

  const bookings = await FoodDb.findAll({
    attributes: ['id', 'date', 'breakfast', 'lunch', 'dinner', 'spicy', 'hightea'],
    where: {
      cardno,
      date: { [Sequelize.Op.gte]: today },
      [Sequelize.Op.or]: [
        { breakfast: true },
        { lunch: true },
        { dinner: true }
      ]
    },
    order: [['date', 'ASC']]
  });

  return res
    .status(200)
    .send({ message: MSG_FETCH_SUCCESSFUL, data: bookings });
}

export const cancelBooking = async (req, res) => {
  const bookingid = req.params.bookingid;
  const mealType = req.query.mealType;

  const booking = await FoodDb.findOne({
    where: { 
      id: bookingid,
      [mealType]: true
    }
  });

  if (!booking) {
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  const bookedBy = booking.bookedBy || booking.cardno;
  const bookedFor = booking.bookedBy ? booking.cardno : null;
  const food_data = [];

  food_data.push({
    date: booking.date,
    mealType,
    bookedFor
  });
  
  const t = await database.transaction();

  await cancelFood(
    req.user, 
    bookedBy, 
    food_data, 
    t, 
    true);

  await t.commit();
  return res
    .status(200)
    .send({ message: MSG_CANCEL_SUCCESSFUL });
};

export const bulkBooking = async (req, res) => {
  const {
    cardno,
    date,
    guestCount, 
    breakfast,
    lunch, 
    dinner,
    department
  } = req.body;

  const booking = await BulkFoodBooking.create(
    {
      bookingid: uuidv4(),
      cardno,
      date,
      guestCount,
      breakfast,
      lunch,
      dinner,
      department,
      updatedBy: req.user.username
    }
  );

  return res.status(200).send({ message: MSG_BOOKING_SUCCESSFUL });
};

export const fetchBulkBookings = async (req, res) => {
  const cardno = req.query.cardno;
  const today = moment().format('YYYY-MM-DD');

  const bookings = await BulkFoodBooking.findAll({
    include: [
      {
        model: CardDb,
        attributes: ['cardno', 'issuedto', 'mobno'],
        required: true
      }
    ],
    where: {
      ...((cardno != "") && { cardno }),
      date: { [Sequelize.Op.gt]: today }
    },
    order: [['date', 'ASC']]
  });

  return res
    .status(200)
    .send({ message: MSG_FETCH_SUCCESSFUL, data: bookings });
};

export const cancelBulkBooking = async (req, res) => {
  const bookingid = req.params.bookingid;

  const booking = await BulkFoodBooking.findOne({
    where: { bookingid }
  });

  if (!booking) {
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  await booking.destroy();
  
  return res.status(200).send({ message: MSG_CANCEL_SUCCESSFUL });
};

export const foodReport = async (req, res) => {
  const start_date = req.query.start_date;
  const end_date = req.query.end_date;

  const report = await database.query(
    `SELECT
      food_db.date,
      SUM(CASE WHEN breakfast = 1 THEN 1 ELSE 0 END) AS breakfast,
      SUM(CASE WHEN lunch = 1 THEN 1 ELSE 0 END) AS lunch,
      SUM(CASE WHEN dinner = 1 THEN 1 ELSE 0 END) as dinner,
      SUM(CASE WHEN breakfast_plate_issued = 1 THEN 1 ELSE 0 END) as breakfast_plate_issued,
      SUM(CASE WHEN lunch_plate_issued = 1 THEN 1 ELSE 0 END) AS lunch_plate_issued,
      SUM(CASE WHEN dinner_plate_issued = 1 THEN 1 ELSE 0 END) AS dinner_plate_issued,
      SUM(CASE WHEN breakfast_plate_issued = 0 THEN 1 ELSE 0 END) AS breakfast_noshow,
      SUM(CASE WHEN lunch_plate_issued = 0 THEN 1 ELSE 0 END) AS lunch_noshow,
      SUM(CASE WHEN dinner_plate_issued = 0 THEN 1 ELSE 0 END) AS dinner_noshow,
      SUM(CASE WHEN hightea = 'TEA' THEN 1 ELSE 0 END) AS tea,
      SUM(CASE WHEN hightea = 'COFFEE' THEN 1 ELSE 0 END) AS coffee,
      SUM(CASE WHEN spicy = 0 THEN 1 ELSE 0 END) as non_spicy,
      COALESCE(breakfast_physical_plates, 0) AS breakfast_physical_plates,
      COALESCE(lunch_physical_plates, 0) AS lunch_physical_plates,
      COALESCE(dinner_physical_plates, 0) AS dinner_physical_plates
    FROM
      food_db 
    LEFT JOIN 
      (
        SELECT date,
          SUM(CASE WHEN type = 'breakfast' THEN count ELSE 0 END) AS breakfast_physical_plates,
          SUM(CASE WHEN type = 'lunch' THEN count ELSE 0 END) AS lunch_physical_plates,
          SUM(CASE WHEN type = 'dinner' THEN count ELSE 0 END) AS dinner_physical_plates 
        FROM food_physical_plate
        WHERE food_physical_plate.date >= :start_date
          AND food_physical_plate.date <= :end_date
        GROUP BY food_physical_plate.date 
      ) AS x ON food_db.date = x.date
    WHERE food_db.date >= :start_date
      AND food_db.date <= :end_date 
    GROUP BY food_db.date 
    ORDER BY food_db.date ASC;`,
    {
      replacements: { 
        start_date,
        end_date 
      },
      type: Sequelize.QueryTypes.SELECT
    }
  );

  return res.status(200).send({ message: MSG_FETCH_SUCCESSFUL, data: report });
};

export const foodReportDetails = async (req, res) => {
  const { meal, is_issued, date } = req.query;

  const bookings = await FoodDb.findAll({
    attributes: ['id','date'],
    include: [
      {
        model: CardDb,
        attributes: ['cardno', 'issuedto', 'mobno'],
        required: true
      }
    ],
    where: {
      date,
      [meal + '_plate_issued']: is_issued
    },
    // order: [['CardDb.issuedto', 'ASC']]
  });

  return res.status(200).send({ data: bookings });
};

export const fetchMenu = async (req, res) => {
  const { startDate, endDate } = req.query;

  const menu = await Menu.findAll({
    where: {
      date: { [Sequelize.Op.between]: [startDate, endDate] }
    }
  });

  return res.status(200).send({ data: menu });
};

export const addMenu = async (req, res) => {
  const { date, breakfast, lunch, dinner } = req.body;

  const menu = await Menu.findOne({
    where: { date }
  });

  if (menu) {
    throw new ApiError(400, 'Menu already exists for given date');
  }

  await Menu.create({
    date,
    breakfast,
    lunch,
    dinner,
    updatedBy: req.user.username
  });

  return res.status(200).send({ message: 'Menu added' });
};

export const updateMenu = async (req, res) => {
  const { date, breakfast, lunch, dinner } = req.body;

  const menu = await Menu.findOne({
    where: { date }
  });

  if (!menu) {
    throw new ApiError(404, 'Menu not found for the given date.');
  }

  await menu.update(
    {
      breakfast,
      lunch,
      dinner,
      updatedBy: req.user.username
    }
  );

  return res.status(200).send({ message: MSG_UPDATE_SUCCESSFUL });
};

export const deleteMenu = async (req, res) => {
  const { date } = req.query;

  const item = await Menu.destroy({
    where: {
      date: date
    }
  });

  if (item == 0) throw new ApiError(404, 'Menu not found');

  return res.status(200).send({ message: 'Menu deleted' });
};
