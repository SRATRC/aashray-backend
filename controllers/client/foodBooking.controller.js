import {
  FoodDb,
  GuestDb,
  GuestFoodDb,
  Menu
} from '../../models/associations.js';
import { STATUS_RESIDENT } from '../../config/constants.js';
import {
  checkFlatAlreadyBooked,
  checkSpecialAllowance,
  isFoodBooked,
  validateDate,
  checkGuestFoodAlreadyBooked,
  checkGuestRoomAlreadyBooked,
  checkGuestSpecialAllowance
} from '../helper.js';
import {
  checkRoomAlreadyBooked
} from '../../helpers/roomBooking.helper.js';
import getDates from '../../utils/getDates.js';
import database from '../../config/database.js';
import Sequelize from 'sequelize';
import moment from 'moment';
import ApiError from '../../utils/ApiError.js';

const mealTimes = {
  breakfast: '7:30 AM - 9:00 AM',
  lunch: '12:00 PM - 2:00 PM',
  dinner: '7:00 PM - 9:00 PM'
};

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
  const t = await database.transaction();
  req.transaction = t;

  const { startDay, endDay, guests } = req.body;

  validateDate(startDay, endDay);

  const guestsToUpdate = guests.filter((guest) => guest.id);
  const guestsToCreate = guests
    .filter((guest) => !guest.id)
    .map((guest) => ({ ...guest, cardno: req.user.cardno }));

  if (guestsToUpdate.length > 0) {
    await Promise.all(
      guestsToUpdate.map(({ id, ...updateData }) =>
        GuestDb.update(updateData, {
          where: { id },
          transaction: t
        })
      )
    );
  }

  const createdGuests = guestsToCreate.length
    ? await GuestDb.bulkCreate(guestsToCreate, {
        transaction: t,
        returning: true
      })
    : [];

  const updatedGuests = guestsToUpdate.length
    ? await GuestDb.findAll({
        where: { id: guestsToUpdate.map((guest) => guest.id) },
        attributes: ['id', 'name', 'gender', 'mobno', 'type'],
        transaction: t
      })
    : [];

  const allGuests = [
    ...updatedGuests.map((guest) => guest.toJSON()),
    ...createdGuests.map((guest) => guest.toJSON())
  ];

  const guestIdMap = allGuests.reduce((map, guest) => {
    const key = `${guest.name}${guest.mobno}${guest.type}${guest.gender}`;
    map[key] = guest.id;
    return map;
  }, {});

  const guestsWithIds = guests.map((guest) => {
    const key = `${guest.name}${guest.mobno}${guest.type}${guest.gender}`;
    const id = guestIdMap[key];

    if (!id) {
      throw new ApiError(404, `Guest not found for key: ${key}`);
    }

    return { ...guest, id };
  });

  const totalGuestIds = guestsWithIds.map((guest) => guest.id);
  const isFoodAlreadyBooked = await checkGuestFoodAlreadyBooked(
    startDay,
    endDay,
    totalGuestIds
  );

  if (isFoodAlreadyBooked) {
    throw new ApiError(403, 'Food already booked for one or more guests');
  }

  if (
    (await checkGuestRoomAlreadyBooked(
      startDay,
      endDay,
      req.user.cardno,
      totalGuestIds
    )) ||
    (await checkGuestSpecialAllowance(startDay, endDay, totalGuestIds))
  ) {
    throw new ApiError(403, 'Room is not booked for one or more guests');
  }

  const allDates = getDates(startDay, endDay);
  const foodData = allDates.flatMap((date) =>
    guestsWithIds.map(({ meals, spicy, hightea, id }) => ({
      cardno: req.user.cardno,
      guest: id,
      date,
      breakfast: meals.includes('breakfast') ? 1 : 0,
      lunch: meals.includes('lunch') ? 1 : 0,
      dinner: meals.includes('dinner') ? 1 : 0,
      hightea,
      spicy
    }))
  );

  await GuestFoodDb.bulkCreate(foodData, { transaction: t });

  await t.commit();

  return res.status(200).json({
    message: 'Food booking successful'
  });
};

export const FetchFoodBookings = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;
  const offset = (page - 1) * pageSize;
  const { date, meal = 'all', spice = 'all', bookedFor = 'all' } = req.query;

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
  const isAll = bookedFor === 'all';
  const isGuest = !isNaN(Number(bookedFor));

  const [selfData, guestData] = await Promise.all([
    isSelf || isAll
      ? FoodDb.findAll({
          attributes: ['date', 'breakfast', 'lunch', 'dinner', 'spicy'],
          where: {
            cardno: req.query.cardno,
            ...dateFilter
          },
          order: [['date', 'DESC']],
          offset,
          limit: pageSize
        })
      : Promise.resolve([]),

    isGuest || isAll
      ? GuestFoodDb.findAll({
          attributes: [
            'date',
            'breakfast',
            'lunch',
            'dinner',
            'spicy',
            'guest'
          ],
          where: {
            cardno: req.query.cardno,
            ...dateFilter,
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
        })
      : Promise.resolve([])
  ]);

  const classifyBooking = (bookingDate) => {
    return bookingDate >= today ? 'upcoming' : 'past';
  };

  const processBookings = (data, isGuestBooking = false) => {
    return data.reduce((acc, item) => {
      const { date, breakfast, lunch, dinner, spicy } = item.dataValues;
      const classify = classifyBooking(date);

      const meals = [
        { type: 'breakfast', exists: breakfast },
        { type: 'lunch', exists: lunch },
        { type: 'dinner', exists: dinner }
      ];

      const guestID = isGuestBooking ? item.guest : null;
      const guestName = isGuestBooking ? item.GuestDb?.name || null : null;

      meals.forEach(({ type, exists }) => {
        if (mealFilter(type, exists) && spiceFilter(spicy)) {
          const mealData = {
            date,
            mealType: type,
            spicy,
            bookedFor: guestID,
            name: guestName
          };

          if (!acc[classify]) {
            acc[classify] = [];
          }
          acc[classify].push(mealData);
        }
      });

      return acc;
    }, {});
  };

  const selfGroupedData = processBookings(selfData);
  const guestGroupedData = processBookings(guestData, true);

  const finalGroupedData = { ...selfGroupedData };

  Object.keys(guestGroupedData).forEach((key) => {
    if (!finalGroupedData[key]) {
      finalGroupedData[key] = [];
    }
    finalGroupedData[key] = [
      ...finalGroupedData[key],
      ...guestGroupedData[key]
    ];
  });

  let responseData = Object.keys(finalGroupedData).map((key) => ({
    title: key,
    data: finalGroupedData[key]
  }));

  responseData = responseData.sort((a, b) => {
    if (a.title === 'upcoming') return -1;
    if (b.title === 'upcoming') return 1;
    if (a.title === 'past') return 1;
    if (b.title === 'past') return -1;
    return 0;
  });

  return res
    .status(200)
    .send({ message: 'fetched results', data: responseData });
};

export const FetchGuestsForFilter = async (req, res) => {
  const { cardno } = req.user;

  const guests = await GuestDb.findAll({
    attributes: ['id', 'name'],
    where: {
      id: {
        [Sequelize.Op.in]: Sequelize.literal(`(
          SELECT DISTINCT guest
          FROM guest_food_db
          WHERE cardno = :cardno
          ORDER BY updatedAt DESC
        )`)
      }
    },
    replacements: { cardno: cardno },
    raw: true,
    limit: 10
  });

  var guestNames = [];
  guestNames.push({ key: 'all', value: 'All' });
  guestNames.push({ key: 'self', value: 'Self' });

  guestNames.push(
    ...guests.map((guest) => ({
      key: guest.id,
      value: guest.name
    }))
  );

  return res.status(200).send({
    message: 'fetched results',
    data: guestNames
  });
};

export const CancelFood = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const { cardno, food_data } = req.body;
  const today = moment().format('YYYY-MM-DD');
  const validFoodData = food_data.filter((item) => item.date > today + 1);

  const selfUpdates = {};
  const guestUpdates = {};

  validFoodData.forEach((item) => {
    const { date, mealType, bookedFor } = item;

    if (bookedFor) {
      if (!guestUpdates[bookedFor]) {
        guestUpdates[bookedFor] = {};
      }
      if (!guestUpdates[bookedFor][mealType]) {
        guestUpdates[bookedFor][mealType] = [];
      }
      guestUpdates[bookedFor][mealType].push(date);
    } else {
      if (!selfUpdates[mealType]) {
        selfUpdates[mealType] = [];
      }
      selfUpdates[mealType].push(date);
    }
  });

  for (const [mealType, dates] of Object.entries(selfUpdates)) {
    const updateFields = {};
    updateFields[mealType] = false;
    updateFields['updatedBy'] = 'USER';

    await FoodDb.update(updateFields, {
      where: {
        cardno,
        date: dates
      },
      transaction: t
    });
  }

  await FoodDb.destroy({
    where: {
      cardno,
      breakfast: false,
      lunch: false,
      dinner: false
    },
    transaction: t
  });

  for (const [guestId, meals] of Object.entries(guestUpdates)) {
    for (const [mealType, dates] of Object.entries(meals)) {
      const updateFields = {};
      updateFields[mealType] = false;
      updateFields['updatedBy'] = 'USER';

      await GuestFoodDb.update(updateFields, {
        where: {
          cardno,
          guest: guestId,
          date: dates
        },
        transaction: t
      });
    }
  }

  await GuestFoodDb.destroy({
    where: {
      cardno,
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
