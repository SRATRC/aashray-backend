import { RoomBooking, FoodDb, GuestFoodDb } from '../../models/associations.js';
import getDates from '../../utils/getDates.js';
import database from '../../config/database.js';
import Sequelize from 'sequelize';
import moment from 'moment';

export const RegisterFood = async (req, res) => {
  const t = await database.transaction();
  try {
    // food is already booked then it wont register
    if (await isFoodBooked(req)) {
      return res
        .status(200)
        .send({ message: 'Food Already booked on one on more of the dates' });
    }

    // if room is not booked on thoese dates then it'll not let user's register
    if (await isRoomBooked(req)) {
      return res.status(200).send({
        message: 'You do not have a room booked on one or more dates selected'
      });
    }

    const startDate = new Date(req.body.start_date);
    const endDate = new Date(req.body.end_date);

    const allDates = getDates(startDate, endDate);

    for (var date of allDates) {
      const temp = await FoodDb.create(
        {
          cardno: req.user.cardno,
          date: date,
          breakfast: req.body.breakfast,
          lunch: req.body.lunch,
          dinner: req.body.dinner,
          hightea: req.body.high_tea,
          spicy: req.body.spicy,
          plateissued: 0
        },
        { transaction: t }
      );

      if (temp.dataValues == undefined) {
        await t.rollback();
        return res.status(500).send({ message: 'Failed to book food' });
      }
    }

    await t.commit();

    return res.status(200).send({
      message: 'Food Booked successfully'
    });
  } catch (err) {
    await t.rollback();
    return res
      .status(404)
      .send({ error: err.message, message: 'An error Occurred' });
  }
};

export const RegisterForGuest = async (req, res) => {
  const t = await database.transaction();
  try {
    // TODO: all add a check if user has booked food on dates of guest booking
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

// TODO: Passbook might not be needed

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

async function isRoomBooked(req) {
  const startDate = new Date(req.body.start_date);
  const endDate = new Date(req.body.end_date);

  const allDates = getDates(startDate, endDate);

  const user_bookings = await RoomBooking.findAll({
    where: {
      cardno: req.body.cardno || req.user.cardno,
      status: { [Sequelize.Op.in]: ['checkedin', 'waiting'] }
    }
  });

  for (var booking of user_bookings) {
    var chk_in = new Date(booking.dataValues.checkin);
    var chk_out = new Date(booking.dataValues.checkout);
    for (var date of allDates) {
      var dt3 = new Date(date);
      if (chk_in <= dt3 && chk_out >= dt3) {
        return false;
      }
    }
  }
  return true;
}
