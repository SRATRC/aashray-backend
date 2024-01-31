import {
  RoomBooking,
  FlatBooking,
  FoodDb,
  GuestFoodDb
} from '../../models/associations.js';
import getDates from '../../utils/getDates.js';
import database from '../../config/database.js';
import Sequelize from 'sequelize';
import moment from 'moment';
import ApiError from '../../utils/ApiError.js';

// FIXME: check the whole codebase and optimise it
export const RegisterFood = async (req, res) => {
  if (await isFoodBooked(req)) {
    return res
      .status(200)
      .send({ message: 'Food Already booked on one on more of the dates' });
  }

  if (
    !(
      (await isRoomBooked(
        req.body.start_date,
        req.body.end_date,
        req.user.cardno
      )) ||
      (await isFlatBooked(
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

  const startDate = new Date(req.body.start_date);
  const endDate = new Date(req.body.end_date);
  const allDates = getDates(startDate, endDate);

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

  return res.status(200).send({
    message: 'Food Booked successfully'
  });
};

export const RegisterForGuest = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  try {
    // TODO: add a check if user has booked food on dates of guest booking
    for (let i = 0; i < req.body.guests; i++) {
      for (var data of req.body.bookings) {
        const temp = await GuestFoodDb.create(
          {
            cardno: req.body.cardno,
            date: data.date,
            breakfast: data.breakfast,
            lunch: data.lunch,
            dinner: data.dinner
          },
          { transaction: t }
        );
        if (temp.dataValues == undefined) {
          await t.rollback();
          return res
            .status(500)
            .send({ message: 'Failed to book food for guests' });
        }
      }
    }

    // TODO: ask if you should directly add the expnse for guest food to transaction db

    await t.commit();

    return res
      .status(200)
      .send({ message: 'Food Booked for guests successfully' });
  } catch (err) {
    await t.rollback();
    return res
      .status(404)
      .send({ error: err.message, message: 'An error Occurred' });
  }
};

export const FetchFoodBookings = async (req, res) => {
  try {
    const page = req.body.page || 1;
    const pageSize = req.body.page_size || 10;
    const offset = (page - 1) * pageSize;

    const today = moment().format('YYYY-MM-DD');

    const data = await FoodDb.findAll({
      where: {
        cardno: req.body.cardno,
        date: {
          [Sequelize.Op.gte]: today
        }
      },
      order: [['date', 'ASC']],
      offset,
      limit: pageSize
    });
    return res.status(200).send({ message: 'fetched results', data: data });
  } catch (err) {
    return res
      .status(404)
      .send({ error: err.message, message: 'An error Occurred' });
  }
};

export const FetchGuestFoodBookings = async (req, res) => {
  try {
    const page = req.body.page || 1;
    const pageSize = req.body.page_size || 10;
    const offset = (page - 1) * pageSize;

    const today = moment().format('YYYY-MM-DD');

    const data = await GuestFoodDb.findAll({
      attributes: [
        'date',
        [Sequelize.fn('COUNT', Sequelize.literal('*')), 'count']
      ],
      where: {
        cardno: req.body.cardno,
        date: {
          [Sequelize.Op.gte]: today
        }
      },
      group: ['date'],
      order: [['date', 'ASC']],
      offset,
      limit: pageSize
    });
    return res.status(200).send({ message: 'fetched results', data: data });
  } catch (err) {
    return res
      .status(404)
      .send({ error: err.message, message: 'An error Occurred' });
  }
};

export const CancelFood = async (req, res) => {
  const t = await database.transaction();
  try {
    for (var id of req.body.ids) {
      var temp = await FoodDb.destroy(
        {
          where: { id: id }
        },
        { transaction: t }
      );
      if (temp != 1) {
        return res.status(404).send({ error: 'There was an error deleting' });
      }
    }
    await t.commit();
    return res.status(200).send({ message: 'Successfully deleted' });
  } catch (err) {
    await t.rollback();
    return res
      .status(404)
      .send({ error: err.message, message: 'An error Occurred' });
  }
};

export const CancelGuestFood = async (req, res) => {
  const t = await database.transaction();
  try {
    for (var id of req.body.ids) {
      var temp = await GuestFoodDb.destroy(
        {
          where: { id: id }
        },
        { transaction: t }
      );
      if (temp != 1) {
        return res.status(404).send({ error: 'There was an error deleting' });
      }
    }
    await t.commit();
    return res.status(200).send({ message: 'Successfully deleted' });
  } catch (err) {
    await t.rollback();
    return res
      .status(404)
      .send({ error: err.message, message: 'An error Occurred' });
  }
};

async function isFoodBooked(req) {
  const startDate = new Date(req.body.start_date);
  const endDate = new Date(req.body.end_date);

  const allDates = getDates(startDate, endDate);
  const food_bookings = await FoodDb.findAll({
    where: {
      cardno: req.body.cardno || req.user.cardno,
      date: { [Sequelize.Op.in]: allDates }
    }
  });

  if (food_bookings.length > 0) return true;
  else return false;
}

async function isRoomBooked(checkin, checkout, cardno) {
  const result = await RoomBooking.findAll({
    where: {
      [Sequelize.Op.or]: [
        {
          checkin: {
            [Sequelize.Op.gte]: checkin,
            [Sequelize.Op.lt]: checkout
          }
        },
        {
          checkout: {
            [Sequelize.Op.gt]: checkin,
            [Sequelize.Op.lte]: checkout
          }
        }
      ],
      cardno: cardno,
      status: {
        [Sequelize.Op.in]: [
          STATUS_WAITING,
          ROOM_STATUS_CHECKEDIN,
          ROOM_STATUS_PENDING_CHECKIN
        ]
      }
    }
  });

  if (result.length > 0) {
    return true;
  } else {
    return false;
  }
}

async function isFlatBooked(checkin, checkout, cardno) {
  const result = await FlatBooking.findAll({
    where: {
      [Sequelize.Op.or]: [
        {
          checkin: {
            [Sequelize.Op.gte]: checkin,
            [Sequelize.Op.lt]: checkout
          }
        },
        {
          checkout: {
            [Sequelize.Op.gt]: checkin,
            [Sequelize.Op.lte]: checkout
          }
        }
      ],
      cardno: cardno,
      status: {
        [Sequelize.Op.in]: [
          STATUS_WAITING,
          ROOM_STATUS_CHECKEDIN,
          ROOM_STATUS_PENDING_CHECKIN
        ]
      }
    }
  });

  if (result.length > 0) {
    return true;
  } else {
    return false;
  }
}
