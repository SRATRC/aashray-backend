import {
  CardDb,
  FoodDb,
  GuestFoodDb,
  GuestFoodTransactionDb,
  FoodPhysicalPlate
} from '../../models/associations.js';
import {
  BREAKFAST_PRICE,
  LUNCH_PRICE,
  DINNER_PRICE,
  TYPE_EXPENSE
} from '../../config/constants.js';
import {
  checkRoomAlreadyBooked,
  checkFlatAlreadyBooked,
  isFoodBooked
} from '../helper.js';
import getDates from '../../utils/getDates.js';
import database from '../../config/database.js';
import moment from 'moment';
import Sequelize from 'sequelize';
import { v4 as uuidv4 } from 'uuid';
import ApiError from '../../utils/ApiError.js';

export const issuePlate = async (req, res) => {
  const currentTime = moment();
  const breakfastEnd = moment().hour(10).minute(0).second(0); // Adjust timings as needed
  const lunchEnd = moment().hour(14).minute(0).second(0);
  const dinnerEnd = moment().hour(19).minute(0).second(0);

  const food_booking = await FoodDb.findOne({
    where: {
      cardno: req.params.cardno,
      date: currentTime.format('YYYY-MM-DD')
    }
  });

  if (!food_booking) throw new ApiError(404, 'booking not found');

  if (currentTime.isBefore(breakfastEnd)) {
    if (food_booking.dataValues.breakfast == 1) {
      if (food_booking.dataValues.breakfast_plate_issued == 0) {
        food_booking.breakfast_plate_issued = 1;
        await food_booking.save();
      } else {
        throw new ApiError(200, 'Plate already issued');
      }
    } else {
      throw new ApiError(404, 'Breakfast not booked');
    }
  } else if (
    currentTime.isBefore(lunchEnd) &&
    currentTime.isAfter(breakfastEnd)
  ) {
    if (food_booking.dataValues.lunch == 1) {
      if (food_booking.dataValues.lunch_plate_issued == 0) {
        food_booking.lunch_plate_issued = 1;
        await food_booking.save();
      } else {
        throw new ApiError(200, 'Plate already issued');
      }
    } else {
      throw new ApiError(404, 'Lunch not booked');
    }
  } else if (currentTime.isBefore(dinnerEnd) && currentTime.isAfter(lunchEnd)) {
    if (food_booking.dataValues.dinner == 1) {
      if (food_booking.dataValues.dinner_plate_issued == 0) {
        food_booking.dinner_plate_issued = 1;
        await food_booking.save();
      } else {
        throw new ApiError(200, 'Plate already issued');
      }
    } else {
      throw new ApiError(404, 'Dinner not booked');
    }
  } else {
    throw new ApiError(404, 'Invalid meal time');
  }

  return res.status(200).send({ message: 'Plate issued successfully' });
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
      'Physical plate count already exists for given date and type'
    );

  await FoodPhysicalPlate.create({
    date: date,
    type: type,
    count: count,
    updatedBy: req.user.username
  });

  return res
    .status(201)
    .send({ message: 'successfully added physical plate count' });
};

export const fetchPhysicalPlateIssued = async (req, res) => {
  const page = req.body.page || 1;
  const pageSize = req.body.page_size || 10;
  const offset = (page - 1) * pageSize;

  const data = await FoodPhysicalPlate.findAll({
    offset,
    limit: pageSize,
    order: [['date', 'ASC']]
  });

  return res
    .status(200)
    .send({ message: 'fetched physical plate count', data: data });
};

export const bookFoodForMumukshu = async (req, res) => {
  if (await isFoodBooked(req)) {
    return res
      .status(200)
      .send({ message: 'Food Already booked on one on more of the dates' });
  }

  if (
    !(
      (await checkRoomAlreadyBooked(
        req.body.start_date,
        req.body.end_date,
        req.body.cardno
      )) ||
      (await checkFlatAlreadyBooked(
        req.body.start_date,
        req.body.end_date,
        req.body.cardno
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
      cardno: req.body.cardno,
      date: date,
      breakfast: req.body.breakfast,
      lunch: req.body.lunch,
      dinner: req.body.dinner,
      hightea: req.body.high_tea,
      spicy: req.body.spicy,
      plateissued: 0,
      updatedBy: req.user.username
    });
  }

  await FoodDb.bulkCreate(food_data);

  return res.status(201).send({
    message: 'Food Booked successfully'
  });
};

export const cancelFoodByCard = async (req, res) => {
  const updateData = req.body.food_data;

  const t = await database.transaction();

  for (let i = 0; i < updateData.length; i++) {
    const isAvailable = await FoodDb.findOne({
      where: {
        cardno: req.body.cardno,
        date: req.body.food_data[i].date
      }
    });
    if (isAvailable) {
      isAvailable.breakfast = req.body.food_data[i].breakfast;
      isAvailable.lunch = req.body.food_data[i].lunch;
      isAvailable.dinner = req.body.food_data[i].dinner;
      await isAvailable.save({ transaction: t });
    }
  }

  await FoodDb.destroy({
    where: {
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

export const cancelFoodByMob = async (req, res) => {
  const updateData = req.body.food_data;

  const t = await database.transaction();

  const userData = await CardDb.findOne({
    where: {
      mobno: req.body.mobno
    }
  });
  if (!userData)
    throw new ApiError(404, 'No user found with given mobile number');

  for (let i = 0; i < updateData.length; i++) {
    const isAvailable = await FoodDb.findOne({
      where: {
        cardno: userData.dataValues.cardno,
        date: req.body.food_data[i].date
      }
    });
    if (isAvailable) {
      isAvailable.breakfast = req.body.food_data[i].breakfast;
      isAvailable.lunch = req.body.food_data[i].lunch;
      isAvailable.dinner = req.body.food_data[i].dinner;
      await isAvailable.save({ transaction: t });
    }
  }

  await FoodDb.destroy({
    where: {
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

export const bookFoodForGuest = async (req, res) => {
  const { start_date, end_date, guest_count, breakfast, lunch, dinner } =
    req.body;

  const t = await database.transaction();
  req.transaction = t;

  const allDates = getDates(start_date, end_date);
  const days = allDates.length;

  var food_data = [];
  const bookingid = uuidv4();
  for (var date of allDates) {
    food_data.push({
      bookingid: bookingid,
      cardno: req.body.cardno,
      date: date,
      guest_count: guest_count,
      breakfast: req.body.breakfast,
      lunch: req.body.lunch,
      dinner: req.body.dinner,
      updatedBy: req.user.username
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
      cardno: req.body.cardno,
      bookingid: bookingid,
      type: TYPE_EXPENSE,
      amount: amount,
      description: `Food Booking for ${guest_count} guests`,
      updatedBy: req.user.username
    },
    { transaction: t }
  );

  await t.commit();

  return res.status(201).send({ message: 'successfully booked guest food' });
};

export const cancelFoodForGuest = async (req, res) => {
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
        updatedBy: req.user.username
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
      updatedBy: req.user.username
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

export const foodReport = async (req, res) => {
  const date = req.query.date;

  const report = await database.query(
    `SELECT
  date,
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
  SUM(CASE WHEN hightea = 'COFFEE' THEN 1 ELSE 0 END) AS coffee
FROM
  food_db
WHERE
  date = :date
GROUP BY
  date;`,
    {
      replacements: { date: date },
      type: Sequelize.QueryTypes.SELECT
    }
  );

  const physical_plates = await FoodPhysicalPlate.findAll({
    attributes: ['date', 'type', 'count'],
    where: {
      date: date
    }
  });
  const data = {
    report: report[0],
    physical_plates: physical_plates ? physical_plates : []
  };

  return res.status(200).send({ data: data });
};

export const foodReportDetails = async (req, res) => {
  const { meal, is_issued, date } = req.query;

  const data = await database.query(
    `SELECT food_db.date, card_db.mobno, card_db.issuedto
    FROM food_db 
    join card_db 
    on food_db.cardno = card_db.cardno
    WHERE date='${date}' AND ${meal}_plate_issued=${is_issued};`,
    {
      type: Sequelize.QueryTypes.SELECT
    }
  );

  return res.status(200).send({ data: data });
};
