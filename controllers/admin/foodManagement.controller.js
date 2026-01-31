import {
  BulkFoodBooking,
  CardDb,
  FoodDb,
  FoodPhysicalPlate,
  Menu,
  Transactions
} from '../../models/associations.js';
import {
  MSG_CANCEL_SUCCESSFUL,
  ERR_BOOKING_NOT_FOUND,
  MSG_BOOKING_SUCCESSFUL,
  MSG_FETCH_SUCCESSFUL,
  MSG_UPDATE_SUCCESSFUL
} from '../../config/constants.js';
import { v4 as uuidv4 } from 'uuid';
import database from '../../config/database.js';
import moment from 'moment';
import Sequelize, { Op } from 'sequelize';
import ApiError from '../../utils/ApiError.js';
import {
  bookFoodForMumukshus,
  cancelMeal,
  createGroupFoodRequest,
  issueFoodPlate
} from '../../helpers/foodBooking.helper.js';
import { findCardByMobno, validateCard } from '../../helpers/card.helper.js';
import { adminCancelTransaction } from '../../helpers/transactions.helper.js';

export const issuePlate = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const { message, issuedto } = await issueFoodPlate(
    req.params.cardno,
    req.body.meal,
    t
  );

  await t.commit();
  return res.status(200).send({ message, issuedto });
};


export const bulkIssuePlate = async (req, res) => {
  const t = await database.transaction();
  try {
    const { cardnos, meal, date } = req.body; // ✅ Now accepts date from frontend
    
    for (const cardno of cardnos) {
      await issueFoodPlate(cardno, meal, t, date); // ✅ Pass date to helper
    }
    
    await t.commit();
    res.status(200).send({ message: 'Plates issued successfully' });
  } catch (err) {
    await t.rollback();
    res.status(400).send({ message: err.message });
  }
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

  return res.status(200).send({ message: 'Added plate count successfully' });
};

export const fetchPhysicalPlateIssued = async (req, res) => {
  const data = await FoodPhysicalPlate.findAll({
    order: [['date', 'ASC']]
  });

  return res.status(200).send({ message: MSG_FETCH_SUCCESSFUL, data: data });
};

export const bookFood = async (req, res) => {
  const {
    cardno,
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

  var card;
  if (cardno) {
    card = await validateCard(cardno);
  } else {
    card = await findCardByMobno(mobno);
  }

  const mumukshuGroup = createGroupFoodRequest(
    card.cardno,
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
    card.cardno,
    t,
    req.user.username,
    req.roles,
    true
  );

  await t.commit();
  return res.status(200).send({ message: MSG_BOOKING_SUCCESSFUL });
};

export const fetchFoodBookings = async (req, res) => {
  var { cardno, mobno } = req.query;

  if ((cardno == undefined || cardno == '') && mobno) {
    cardno = (await findCardByMobno(mobno)).cardno;
  }

  const today = moment().format('YYYY-MM-DD');

  const bookings = await FoodDb.findAll({
    attributes: [
      'id',
      'date',
      'breakfast',
      'lunch',
      'dinner',
      'spicy',
      'hightea'
    ],
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
};

export const cancelBooking = async (req, res) => {
  const bookingid = req.params.bookingid;
  const mealType = req.query.mealType;

  const t = await database.transaction();

  const booking = await FoodDb.findOne({
    where: {
      id: bookingid,
      [mealType]: true
    }
  });

  if (!booking) {
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  await cancelMeal(req.user, bookingid, mealType, t);

  const transaction = await Transactions.findOne({
    where: {
      bookingid: booking.id,
      category: mealType
    }
  });

  if (transaction) {
    const card = await validateCard(transaction.cardno);
    await adminCancelTransaction(req.user, card, transaction, t);
  }

  await t.commit();
  return res.status(200).send({ message: MSG_CANCEL_SUCCESSFUL });
};

export const cancelMultipleMeals = async (req, res) => {
  const { meals } = req.body;

  if (!Array.isArray(meals) || meals.length === 0) {
    throw new ApiError(400, 'No meals provided');
  }

  const t = await database.transaction();

  try {
    for (const { bookingid, mealType } of meals) {
      const booking = await FoodDb.findOne({
        where: {
          id: bookingid,
          [mealType]: true
        },
        transaction: t
      });

      if (!booking) continue; // Skip invalid ones

      await cancelMeal(req.user, bookingid, mealType, t);

      const transaction = await Transactions.findOne({
        where: {
          bookingid: booking.id,
          category: mealType
        },
        transaction: t
      });

      if (transaction) {
        const card = await validateCard(transaction.cardno);
        await adminCancelTransaction(req.user, card, transaction, t);
      }
    }

    await t.commit();
    return res
      .status(200)
      .send({ message: 'Selected meals cancelled successfully' });
  } catch (err) {
    await t.rollback();
    console.error('Bulk cancel failed:', err);
    throw new ApiError(500, 'Failed to cancel selected meals');
  }
};

export const bulkBooking = async (req, res) => {
  const {
    cardno,
    mobno,
    date,
    guestCount,
    breakfast,
    lunch,
    dinner,
    department
  } = req.body;

  // Ensure at least cardno or mobno is provided
  if (!cardno && !mobno) {
    return res
      .status(400)
      .send({ message: 'Either cardno or mobno is required.' });
  }

  // Time restriction for smilesAdmin role
  if (req.roles?.includes('smilesAdmin')) {
    const bookingDate = new Date(date);
    const now = new Date();

    const tomorrow = new Date();
    tomorrow.setDate(now.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const cutoff = new Date();
    cutoff.setHours(11, 0, 0, 0); // today 11:00 AM

    if (
      bookingDate.toDateString() === tomorrow.toDateString() &&
      now > cutoff
    ) {
      return res.status(403).send({
        message: "You can't book food for tomorrow after 11:00 AM today."
      });
    }
  }

  // Find the card
  const cardEntry = await CardDb.findOne({
    where: {
      ...(cardno && { cardno }),
      ...(mobno && { mobno })
    }
  });

  if (!cardEntry) {
    return res
      .status(404)
      .send({ message: 'No card found for the given cardno or mobno.' });
  }

  const finalCardNo = cardEntry.cardno;

  // Create booking
  const booking = await BulkFoodBooking.create({
    bookingid: uuidv4(),
    cardno: finalCardNo,
    date,
    guestCount,
    breakfast: breakfast ? guestCount : 0,
    lunch: lunch ? guestCount : 0,
    dinner: dinner ? guestCount : 0,
    breakfast_plate_issued: 0,
    lunch_plate_issued: 0,
    dinner_plate_issued: 0,
    department,
    updatedBy: req.user.username
  });

  return res.status(200).send({ message: MSG_BOOKING_SUCCESSFUL });
};

export const fetchBulkBookings = async (req, res) => {
  const { cardno, mobno } = req.query;

  try {
    const cardWhereClause = {};
    if (cardno) cardWhereClause.cardno = cardno;
    if (mobno) cardWhereClause.mobno = mobno;

    const today = new Date();
    today.setHours(0, 0, 0, 0); // ensure only date part is considered

    const bookings = await BulkFoodBooking.findAll({
      where: {
        date: {
          [Op.gte]: today // 👉 date >= today
        }
      },
      include: [
        {
          model: CardDb,
          required: true,
          where: cardWhereClause,
          attributes: ['cardno', 'issuedto', 'mobno']
        }
      ],
      order: [['date', 'ASC']]
    });

    return res
      .status(200)
      .send({ message: MSG_FETCH_SUCCESSFUL, data: bookings });
  } catch (error) {
    console.error('Fetch error:', error);
    return res
      .status(500)
      .send({ message: 'Something went wrong.', error: error.message });
  }
};

// editBulkBooking: PUT /food/edit_bulk_booking/:bookingid
export const editBulkBooking = async (req, res) => {
  const { bookingid } = req.params;
  const { breakfast = 0, lunch = 0, dinner = 0, guestCount = 0 } = req.body;

  const booking = await BulkFoodBooking.findOne({ where: { bookingid } });
  if (!booking) throw new ApiError(404, ERR_BOOKING_NOT_FOUND);

  // Time restriction logic for smilesAdmin
  if (req.roles?.includes('smilesAdmin')) {
    const bookingDate = new Date(booking.date); // date stored in DB
    const now = new Date();

    const tomorrow = new Date();
    tomorrow.setDate(now.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0); // reset to midnight

    const cutoff = new Date();
    cutoff.setHours(20, 0, 0, 0); // today 8:00 PM

    if (
      bookingDate.toDateString() === tomorrow.toDateString() &&
      now > cutoff
    ) {
      return res.status(403).send({
        message: "You can't edit tomorrow's booking after 8:00 PM today."
      });
    }
  }

  const maxCount = Math.max(breakfast, lunch, dinner, guestCount);

  await booking.update({
    breakfast,
    lunch,
    dinner,
    guestCount: maxCount
  });

  return res.status(200).send({ message: MSG_UPDATE_SUCCESSFUL });
};

export const updatePlateIssued = async (req, res) => {
  const { bookingid } = req.params;
  const { mealType, plateIssued, updatedBy } = req.body;

  if (!['breakfast', 'lunch', 'dinner'].includes(mealType)) {
    return res.status(400).json({ message: 'Invalid meal type' });
  }

  try {
    const booking = await BulkFoodBooking.findByPk(bookingid);

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    // Ensure booking.date is treated as a Date object
    const bookingDate = new Date(booking.date);
    const today = new Date();

    // Compare only dates (ignoring time)
    const bookingDateStr = bookingDate.toISOString().slice(0, 10);
    const todayStr = today.toISOString().slice(0, 10);

    if (bookingDateStr !== todayStr) {
      return res.status(403).json({
        message: "Plates can only be issued for today's bookings."
      });
    }

    const bookedCount = booking[mealType]; // e.g., breakfast, lunch, dinner count

    if (plateIssued > bookedCount) {
      return res.status(400).json({
        message: `Cannot issue more than ${bookedCount} plates for ${mealType}.`
      });
    }

    const updateFields = {
      [`${mealType}_plate_issued`]: plateIssued
    };

    if (updatedBy) updateFields.updatedBy = updatedBy;

    await booking.update(updateFields);

    return res
      .status(200)
      .json({ message: 'Plate issued status updated successfully' });
  } catch (err) {
    console.error('Error updating plate issued:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

export const foodReport = async (req, res) => {
  const start_date = req.query.start_date;
  const end_date = req.query.end_date;

  const report = await database.query(
    `WITH all_dates AS (
      SELECT DISTINCT date FROM food_db
      WHERE date >= :start_date AND date <= :end_date
      UNION
      SELECT DISTINCT date FROM bulk_food_booking
      WHERE date >= :start_date AND date <= :end_date
    )
    SELECT
      d.date,
      -- food_db counts
      COALESCE(SUM(CASE WHEN f.breakfast = 1 THEN 1 ELSE 0 END), 0) AS breakfast,
      COALESCE(SUM(CASE WHEN f.lunch = 1 THEN 1 ELSE 0 END), 0) AS lunch,
      COALESCE(SUM(CASE WHEN f.dinner = 1 THEN 1 ELSE 0 END), 0) AS dinner,
      COALESCE(SUM(CASE WHEN f.breakfast_plate_issued = 1 THEN 1 ELSE 0 END), 0) AS breakfast_plate_issued,
      COALESCE(SUM(CASE WHEN f.lunch_plate_issued = 1 THEN 1 ELSE 0 END), 0) AS lunch_plate_issued,
      COALESCE(SUM(CASE WHEN f.dinner_plate_issued = 1 THEN 1 ELSE 0 END), 0) AS dinner_plate_issued,
      COALESCE(SUM(CASE WHEN f.breakfast = 1 AND f.breakfast_plate_issued = 0 THEN 1 ELSE 0 END), 0) AS breakfast_noshow,
      COALESCE(SUM(CASE WHEN f.lunch = 1 AND f.lunch_plate_issued = 0 THEN 1 ELSE 0 END), 0) AS lunch_noshow,
      COALESCE(SUM(CASE WHEN f.dinner = 1 AND f.dinner_plate_issued = 0 THEN 1 ELSE 0 END), 0) AS dinner_noshow,
      COALESCE(SUM(CASE WHEN f.hightea = 'COFFEE' THEN 1 ELSE 0 END), 0) AS coffee,
      COALESCE(SUM(CASE WHEN f.hightea = 'TEA' THEN 1 ELSE 0 END), 0) AS tea,
      COALESCE(SUM(CASE WHEN f.spicy = 0 THEN 1 ELSE 0 END), 0) AS non_spicy,

      -- physical plate counts
      COALESCE(x.breakfast_physical_plates, 0) AS breakfast_physical_plates,
      COALESCE(x.lunch_physical_plates, 0) AS lunch_physical_plates,
      COALESCE(x.dinner_physical_plates, 0) AS dinner_physical_plates,

      -- guest counts from bulk_food_booking
      COALESCE(b.breakfast_guest_count, 0) AS breakfast_guest_count,
      COALESCE(b.lunch_guest_count, 0) AS lunch_guest_count,
      COALESCE(b.dinner_guest_count, 0) AS dinner_guest_count,

      COALESCE(b.breakfast_guest_issued, 0) AS breakfast_guest_issued,
      COALESCE(b.lunch_guest_issued, 0) AS lunch_guest_issued,
      COALESCE(b.dinner_guest_issued, 0) AS dinner_guest_issued,

      COALESCE(b.breakfast_guest_noshow, 0) AS breakfast_guest_noshow,
      COALESCE(b.lunch_guest_noshow, 0) AS lunch_guest_noshow,
      COALESCE(b.dinner_guest_noshow, 0) AS dinner_guest_noshow

    FROM all_dates d
    LEFT JOIN food_db f ON f.date = d.date
    LEFT JOIN (
        SELECT date,
          SUM(CASE WHEN type = 'breakfast' THEN count ELSE 0 END) AS breakfast_physical_plates,
          SUM(CASE WHEN type = 'lunch' THEN count ELSE 0 END) AS lunch_physical_plates,
          SUM(CASE WHEN type = 'dinner' THEN count ELSE 0 END) AS dinner_physical_plates
        FROM food_physical_plate
        WHERE date >= :start_date AND date <= :end_date
        GROUP BY date
    ) AS x ON d.date = x.date
    LEFT JOIN (
        SELECT date,
          SUM(breakfast) AS breakfast_guest_count,
          SUM(lunch) AS lunch_guest_count,
          SUM(dinner) AS dinner_guest_count,

          SUM(breakfast_plate_issued) AS breakfast_guest_issued,
          SUM(lunch_plate_issued) AS lunch_guest_issued,
          SUM(dinner_plate_issued) AS dinner_guest_issued,

          SUM(breakfast) - SUM(breakfast_plate_issued) AS breakfast_guest_noshow,
          SUM(lunch) - SUM(lunch_plate_issued) AS lunch_guest_noshow,
          SUM(dinner) - SUM(dinner_plate_issued) AS dinner_guest_noshow
        FROM bulk_food_booking
        WHERE date >= :start_date AND date <= :end_date
        GROUP BY date
    ) AS b ON d.date = b.date

    GROUP BY d.date,
             x.breakfast_physical_plates, x.lunch_physical_plates, x.dinner_physical_plates,
             b.breakfast_guest_count, b.lunch_guest_count, b.dinner_guest_count,
             b.breakfast_guest_issued, b.lunch_guest_issued, b.dinner_guest_issued,
             b.breakfast_guest_noshow, b.lunch_guest_noshow, b.dinner_guest_noshow

    ORDER BY d.date ASC;`,
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
    attributes: ['id', 'date'],
    include: [
      {
        model: CardDb,
        attributes: ['cardno', 'issuedto', 'mobno'],
        required: true
      }
    ],
    where: {
      date,
      [meal]: true,
      [meal + '_plate_issued']: is_issued
    },
    order: [[CardDb, 'issuedto', 'ASC']] // 👈 sort by issuedto A–Z
  });

  return res.status(200).send({ data: bookings });
};

export const foodReportDetailsGuests = async (req, res) => {
  const { meal, date, is_issued } = req.query;

  if (!meal || !date) {
    return res.status(400).json({ message: 'Missing meal or date parameter' });
  }

  const mealField = Sequelize.col(`BulkFoodBooking.${meal}`);
  const plateIssuedField = Sequelize.col(
    `BulkFoodBooking.${meal}_plate_issued`
  );

  const whereConditions = {
    date,
    [Op.and]: Sequelize.where(mealField, '>', 0)
  };

  if (is_issued === '1') {
    // Show only if plates were issued
    whereConditions[Op.and] = [
      whereConditions[Op.and],
      Sequelize.where(plateIssuedField, '>', 0)
    ];
  } else if (is_issued === '0') {
    // Show only if plates were NOT issued
    whereConditions[Op.and] = [
      whereConditions[Op.and],
      Sequelize.where(plateIssuedField, '<', Sequelize.col(meal))
    ];
  }

  try {
    const bookings = await BulkFoodBooking.findAll({
      attributes: [
        'bookingid',
        'cardno',
        'date',
        'breakfast',
        'lunch',
        'dinner',
        'breakfast_plate_issued',
        'lunch_plate_issued',
        'dinner_plate_issued',
        'department',
        [
          // Calculate pending plates dynamically
          Sequelize.literal(
            `BulkFoodBooking.${meal} - BulkFoodBooking.${meal}_plate_issued`
          ),
          'pending_plates'
        ]
      ],
      include: [
        {
          model: CardDb,
          attributes: ['issuedto', 'mobno'],
          required: true
        }
      ],
      where: whereConditions,
      order: [[CardDb, 'issuedto', 'ASC']]
    });

    return res.status(200).send({ data: bookings });
  } catch (error) {
    console.error('Error fetching guest report:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
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

  await menu.update({
    breakfast,
    lunch,
    dinner,
    updatedBy: req.user.username
  });

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

export const addBulkMenu = async (req, res) => {
  const { menus } = req.body;

  if (!Array.isArray(menus)) {
    console.log('Invalid menus payload:', req.body);
    return res.status(400).json({ message: 'Invalid format' });
  }

  try {
    console.log('Received menus:', menus);

    const validMenus = menus
      .filter(
        (item) =>
          item.date &&
          item.breakfast !== undefined &&
          item.lunch !== undefined &&
          item.dinner !== undefined
      )
      .map((item) => ({
        date: item.date,
        breakfast: item.breakfast || '',
        lunch: item.lunch || '',
        dinner: item.dinner || '',
        updatedBy: 'admin',
        createdAt: new Date(),
        updatedAt: new Date()
      }));

    console.log('Valid menus to upload:', validMenus);

    if (validMenus.length === 0) {
      return res.status(400).json({ message: 'No valid menu records found.' });
    }

    await Menu.bulkCreate(validMenus, {
      updateOnDuplicate: ['breakfast', 'lunch', 'dinner', 'updatedAt']
    });

    res.status(200).json({ message: 'Menus uploaded successfully' });
  } catch (err) {
    console.error('Bulk Upload Error:', err);
    res.status(500).json({ message: 'Server error while uploading menus' });
  }
};
