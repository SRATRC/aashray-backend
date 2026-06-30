import {
  BulkFoodBooking,
  CardDb,
  FoodDb,
  FoodPhysicalPlate,
  Menu,
  Transactions,
  UtsavDb
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
import Sequelize, { Op,  fn, col } from 'sequelize';
import ApiError from '../../utils/ApiError.js';
import {
  bookFoodForMumukshus,
  cancelMeal,
  createGroupFoodRequest,
  issueFoodPlate
} from '../../helpers/foodBooking.helper.js';
import { findCardByMobno, validateCard } from '../../helpers/card.helper.js';
import { adminCancelTransaction } from '../../helpers/transactions.helper.js';
import { sendUnifiedWhatsApp } from '../../helpers/whatsapp.helper.js';
import { sendWhatsAppMessage } from '../../utils/sendWhatsAppMessage.js';
import { formatWhatsAppPhone } from '../../utils/phoneFormatter.js';


export const issuePlate = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  req.log.info('issue_plate_start', { cardno: req.params.cardno, meal: req.body.meal });

  const { message, issuedto } = await issueFoodPlate(
    req.params.cardno,
    req.body.meal,
    t
  );

  await t.commit();
  req.log.info('issue_plate_success', { cardno: req.params.cardno, meal: req.body.meal, issuedto });
  return res.status(200).send({ message, issuedto });
};


export const bulkIssuePlate = async (req, res) => {
  const t = await database.transaction();
  try {
    const { cardnos, meal, date } = req.body; // ✅ Now accepts date from frontend
    req.log.info('bulk_issue_plate_start', { cardnoCount: cardnos?.length, meal, date });

    for (const cardno of cardnos) {
      await issueFoodPlate(cardno, meal, t, date); // ✅ Pass date to helper
    }

    await t.commit();
    req.log.info('bulk_issue_plate_success', { cardnoCount: cardnos?.length, meal, date });
    res.status(200).send({ message: 'Plates issued successfully' });
  } catch (err) {
    await t.rollback();
    req.log.error('bulk_issue_plate_error', { meal, error: err.message });
    res.status(400).send({ message: err.message });
  }
};


export const physicalPlatesIssued = async (req, res) => {
  const { date, type, count } = req.body;
  req.log.info('physical_plates_issued_start', { date, type, count });

  const alreadyExists = await FoodPhysicalPlate.findOne({
    where: {
      date: date,
      type: type
    }
  });
  if (alreadyExists) {
    req.log.warn('physical_plates_issued_already_exists', { date, type });
    throw new ApiError(
      400,
      `Physical plate count already exists for ${type} on ${date}`
    );
  }

  await FoodPhysicalPlate.create({
    date: date,
    type: type,
    count: count,
    updatedBy: req.user.username
  });

  req.log.info('physical_plates_issued_success', { date, type, count });
  return res.status(200).send({ message: 'Added plate count successfully' });
};

export const fetchPhysicalPlateIssued = async (req, res) => {
  const { date } = req.query;
  req.log.info('fetch_physical_plate_issued_start', { date });

  const where = date ? { date } : {};
  const data = await FoodPhysicalPlate.findAll({
    where,
    order: [['date', 'ASC']]
  });

  req.log.info('fetch_physical_plate_issued_success', { count: data.length });
  return res.status(200).send({ message: MSG_FETCH_SUCCESSFUL, data: data });
};

export const updatePhysicalPlate = async (req, res) => {
  const { date, type, count } = req.body;
  req.log.info('update_physical_plate_start', { date, type, count });

  const record = await FoodPhysicalPlate.findOne({ where: { date, type } });
  if (!record) {
    throw new ApiError(404, `No plate count found for ${type} on ${date}. Use Add instead.`);
  }

  await record.update({ count, updatedBy: req.user.username });

  req.log.info('update_physical_plate_success', { date, type, count });
  return res.status(200).send({ message: 'Plate count updated successfully' });
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

  req.log.info('book_food_start', { cardno, mobno, start_date, end_date, breakfast, lunch, dinner });

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

  const result = await bookFoodForMumukshus(
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
  req.log.info('book_food_success', { cardno: card.cardno, start_date, end_date });

  try {
    const userBookingIds = result?.userBookingIds || {};
    const bookingIds = userBookingIds[card.cardno] || [];
    if (bookingIds.length) {
      const foodBookings = await FoodDb.findAll({
        where: {
          id: { [Sequelize.Op.in]: bookingIds }
        },
        order: [['date', 'ASC']]
      });

      const foodBookingDetails = foodBookings.map((fb) => ({
        id: fb.id,
        bookingid: fb.id,
        cardno: fb.cardno,
        bookedBy: fb.bookedBy,
        date: fb.date,
        breakfast: fb.breakfast,
        lunch: fb.lunch,
        dinner: fb.dinner,
        spicy: fb.spicy,
        hightea: fb.hightea,
        name: card.issuedto
      }));

      sendUnifiedWhatsApp(
        card,
        [], // adhyan
        [], // travel
        [], // flat
        [], // utsav
        [], // room
        null, // bookedForCardno
        foodBookingDetails
      ).catch(err => console.error("Error sending admin food booking WhatsApp:", err));
    }
  } catch (waErr) {
    console.error("Error triggering WhatsApp notification for admin food booking:", waErr);
  }

  return res.status(200).send({ message: MSG_BOOKING_SUCCESSFUL });
};

export const fetchFoodBookings = async (req, res) => {
  var { cardno, mobno } = req.query;
  req.log.info('fetch_food_bookings_start', { cardno, mobno });

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

  req.log.info('fetch_food_bookings_success', { cardno, count: bookings.length });
  return res
    .status(200)
    .send({ message: MSG_FETCH_SUCCESSFUL, data: bookings });
};

export const cancelBooking = async (req, res) => {
  const bookingid = req.params.bookingid;
  const mealType = req.query.mealType;

  req.log.info('cancel_food_booking_start', { bookingid, mealType });

  const t = await database.transaction();
  req.transaction = t;

  const booking = await FoodDb.findOne({
    where: {
      id: bookingid,
      [mealType]: true
    }
  });

  if (!booking) {
    req.log.warn('cancel_food_booking_not_found', { bookingid, mealType });
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
    req.log.info('cancel_food_booking_transaction_cancelled', { bookingid, mealType, cardno: transaction.cardno, amount: transaction.amount });
  }

  await t.commit();
  req.log.info('cancel_food_booking_success', { bookingid, mealType });
  return res.status(200).send({ message: MSG_CANCEL_SUCCESSFUL });
};

export const cancelMultipleMeals = async (req, res) => {
  const { meals } = req.body;

  req.log.info('cancel_multiple_meals_start', { mealCount: meals?.length });

  if (!Array.isArray(meals) || meals.length === 0) {
    req.log.warn('cancel_multiple_meals_no_meals_provided');
    throw new ApiError(400, 'No meals provided');
  }

  const t = await database.transaction();

  try {
    let cancelledCount = 0;
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
      cancelledCount++;

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
    req.log.info('cancel_multiple_meals_success', { requested: meals.length, cancelled: cancelledCount });
    return res
      .status(200)
      .send({ message: 'Selected meals cancelled successfully' });
  } catch (err) {
    await t.rollback();
    req.log.error('cancel_multiple_meals_error', { error: err.message });
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

  req.log.info('bulk_food_booking_start', { cardno, mobno, date, guestCount, breakfast, lunch, dinner, department });

  // Ensure at least cardno or mobno is provided
  if (!cardno && !mobno) {
    req.log.warn('bulk_food_booking_missing_identifier');
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
      req.log.warn('bulk_food_booking_time_restriction', { date, role: 'smilesAdmin' });
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
    req.log.warn('bulk_food_booking_card_not_found', { cardno, mobno });
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

  req.log.info('bulk_food_booking_success', { cardno: finalCardNo, date, guestCount, bookingid: booking.bookingid });

  const phone = cardEntry.mobno;
  if (phone) {
    try {
      const formattedPhone = formatWhatsAppPhone(phone, cardEntry.country);

      const meals = [];
      if (breakfast) meals.push('Breakfast');
      if (lunch) meals.push('Lunch');
      if (dinner) meals.push('Dinner');
      const mealsStr = meals.join(', ') || 'None';

      const components = [
        {
          type: 'header',
          parameters: [
            {
              type: 'text',
              text: department || ' '
            }
          ]
        },
        {
          type: 'body',
          parameters: [
            {
              type: 'text',
              text: cardEntry.issuedto || 'Mumukshu'
            },
            {
              type: 'text',
              text: String(guestCount)
            },
            {
              type: 'text',
              text: moment(date).format('DD-MM-YYYY')
            },
            {
              type: 'text',
              text: mealsStr
            }
          ]
        }
      ];

      await sendWhatsAppMessage(formattedPhone, 'bulk_food_booking_confirmed', components);
    } catch (err) {
      console.error('Error sending WhatsApp message in bulkBooking:', err.message || err);
    }
  }

  return res.status(200).send({ message: MSG_BOOKING_SUCCESSFUL });
};

export const fetchBulkBookings = async (req, res) => {
  const { cardno, mobno } = req.query;
  req.log.info('fetch_bulk_bookings_start', { cardno, mobno });

  try {
    const cardWhereClause = {};
    if (cardno) cardWhereClause.cardno = cardno;
    if (mobno) cardWhereClause.mobno = mobno;

    const today = new Date();
    today.setHours(0, 0, 0, 0); // ensure only date part is considered

    const bookings = await BulkFoodBooking.findAll({
      where: {
        date: {
          [Op.gte]: today // date >= today
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

    req.log.info('fetch_bulk_bookings_success', { cardno, mobno, count: bookings.length });
    return res
      .status(200)
      .send({ message: MSG_FETCH_SUCCESSFUL, data: bookings });
  } catch (error) {
    req.log.error('fetch_bulk_bookings_error', { cardno, mobno, error: error.message });
    return res
      .status(500)
      .send({ message: 'Something went wrong.', error: error.message });
  }
};

// editBulkBooking: PUT /food/edit_bulk_booking/:bookingid
export const editBulkBooking = async (req, res) => {
  const { bookingid } = req.params;
  const { breakfast = 0, lunch = 0, dinner = 0, guestCount = 0 } = req.body;

  req.log.info('edit_bulk_booking_start', { bookingid, breakfast, lunch, dinner, guestCount });

  const booking = await BulkFoodBooking.findOne({ where: { bookingid } });
  if (!booking) {
    req.log.warn('edit_bulk_booking_not_found', { bookingid });
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

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
      req.log.warn('edit_bulk_booking_time_restriction', { bookingid, bookingDate: booking.date, role: 'smilesAdmin' });
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

  req.log.info('edit_bulk_booking_success', { bookingid, breakfast, lunch, dinner, guestCount: maxCount });

  const cardEntry = await CardDb.findOne({ where: { cardno: booking.cardno } });
  const phone = cardEntry ? cardEntry.mobno : null;
  if (phone) {
    try {
      const formattedPhone = formatWhatsAppPhone(phone, cardEntry.country);

      const meals = [];
      if (breakfast > 0) meals.push(`Breakfast (${breakfast})`);
      if (lunch > 0) meals.push(`Lunch (${lunch})`);
      if (dinner > 0) meals.push(`Dinner (${dinner})`);
      const mealsStr = meals.join(', ') || 'None';

      const components = [
        {
          type: 'body',
          parameters: [
            {
              type: 'text',
              text: cardEntry.issuedto || 'Mumukshu'
            },
            {
              type: 'text',
              text: moment(booking.date).format('DD-MM-YYYY')
            },
            {
              type: 'text',
              text: String(maxCount)
            },
            {
              type: 'text',
              text: mealsStr
            }
          ]
        }
      ];

      await sendWhatsAppMessage(formattedPhone, 'bulk_food_booking_updated', components);
    } catch (err) {
      console.error('Error sending WhatsApp message in editBulkBooking:', err.message || err);
    }
  }

  return res.status(200).send({ message: MSG_UPDATE_SUCCESSFUL });
};

export const updatePlateIssued = async (req, res) => {
  const { bookingid } = req.params;
  const { mealType, plateIssued } = req.body;

  req.log.info('update_plate_issued_start', { bookingid, mealType, plateIssued });

  if (!['breakfast', 'lunch', 'dinner'].includes(mealType)) {
    req.log.warn('update_plate_issued_invalid_meal_type', { bookingid, mealType });
    return res.status(400).json({ message: 'Invalid meal type' });
  }

  try {
    const booking = await BulkFoodBooking.findByPk(bookingid);

    if (!booking) {
      req.log.warn('update_plate_issued_not_found', { bookingid });
      return res.status(404).json({ message: 'Booking not found' });
    }

    // Ensure booking.date is treated as a Date object
    const bookingDate = new Date(booking.date);
    const today = new Date();

    // Compare only dates (ignoring time)
    const bookingDateStr = bookingDate.toISOString().slice(0, 10);
    const todayStr = today.toISOString().slice(0, 10);

    if (bookingDateStr !== todayStr) {
      req.log.warn('update_plate_issued_wrong_date', { bookingid, bookingDate: bookingDateStr, today: todayStr });
      return res.status(403).json({
        message: "Plates can only be issued for today's bookings."
      });
    }

    const bookedCount = booking[mealType]; // e.g., breakfast, lunch, dinner count

    if (plateIssued > bookedCount) {
      req.log.warn('update_plate_issued_exceeds_booked', { bookingid, mealType, plateIssued, bookedCount });
      return res.status(400).json({
        message: `Cannot issue more than ${bookedCount} plates for ${mealType}.`
      });
    }

    const updateFields = {
      [`${mealType}_plate_issued`]: plateIssued,
      updatedBy: req.user.username
    };

    await booking.update(updateFields);

    req.log.info('update_plate_issued_success', { bookingid, mealType, plateIssued });
    return res
      .status(200)
      .json({ message: 'Plate issued status updated successfully' });
  } catch (err) {
    req.log.error('update_plate_issued_error', { bookingid, mealType, error: err.message });
    return res.status(500).json({ message: 'Internal server error' });
  }
};

export const foodReport = async (req, res) => {
  const start_date = req.query.start_date;
  const end_date = req.query.end_date;
  req.log.info('food_report_start', { start_date, end_date });

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

  let filteredReport = report;

  // ── Ignore event dates logic ──────────────────────────────────────────────
  if (req.query.ignore_events === 'true') {
    // Fetch all utsav events overlapping the requested date range
    const events = await UtsavDb.findAll({
      attributes: ['start_date', 'end_date', 'starting_meal', 'ending_meal'],
      where: {
        start_date: { [Op.lte]: end_date },
        end_date:   { [Op.gte]: start_date }
      }
    });

    const MEAL_ORDER = ['breakfast', 'lunch', 'dinner'];

    // Build a map: dateStr → Set of meals to exclude
    const excludedMeals = {};
    const addExclude = (dateStr, meal) => {
      if (!excludedMeals[dateStr]) excludedMeals[dateStr] = new Set();
      excludedMeals[dateStr].add(meal);
    };

    for (const event of events) {
      const evStart = event.start_date.substring(0, 10);
      const evEnd   = event.end_date.substring(0, 10);

      // First event meal on start date (fallback: breakfast = whole day from start)
      const startingMeals = Array.isArray(event.starting_meal) && event.starting_meal.length
        ? event.starting_meal : MEAL_ORDER;
      const firstEventMeal    = MEAL_ORDER.find(m => startingMeals.includes(m)) || 'breakfast';
      const firstEventMealIdx = MEAL_ORDER.indexOf(firstEventMeal);

      // Last event meal on end date (fallback: dinner = whole day until end)
      const endingMeals = Array.isArray(event.ending_meal) && event.ending_meal.length
        ? event.ending_meal : MEAL_ORDER;
      const lastEventMeal    = [...MEAL_ORDER].reverse().find(m => endingMeals.includes(m)) || 'dinner';
      const lastEventMealIdx = MEAL_ORDER.indexOf(lastEventMeal);

      // Walk every date in event range
      const cursor = new Date(evStart);
      const endD   = new Date(evEnd);
      while (cursor <= endD) {
        const dateStr    = cursor.toISOString().split('T')[0];
        const isStartDay = dateStr === evStart;
        const isEndDay   = dateStr === evEnd;

        if (isStartDay && isEndDay) {
          // Single-day event
          for (let i = firstEventMealIdx; i <= lastEventMealIdx; i++)
            addExclude(dateStr, MEAL_ORDER[i]);
        } else if (isStartDay) {
          // Exclude from first event meal to end of day
          for (let i = firstEventMealIdx; i < MEAL_ORDER.length; i++)
            addExclude(dateStr, MEAL_ORDER[i]);
        } else if (isEndDay) {
          // Exclude from start of day up to last event meal
          for (let i = 0; i <= lastEventMealIdx; i++)
            addExclude(dateStr, MEAL_ORDER[i]);
        } else {
          // Full middle day: exclude all meals
          MEAL_ORDER.forEach(m => addExclude(dateStr, m));
        }

        cursor.setDate(cursor.getDate() + 1);
      }
    }

    // Zero-out excluded meals per row; drop rows where all 3 meals are excluded
    filteredReport = report.map(row => {
      const dateStr = (row.date || '').substring(0, 10);
      const excluded = excludedMeals[dateStr];
      if (!excluded) return row;

      const r = { ...row };
      for (const meal of MEAL_ORDER) {
        if (excluded.has(meal)) {
          r[meal]                      = 0;
          r[`${meal}_plate_issued`]    = 0;
          r[`${meal}_noshow`]          = 0;
          r[`${meal}_physical_plates`] = 0;
          r[`${meal}_guest_count`]     = 0;
          r[`${meal}_guest_issued`]    = 0;
          r[`${meal}_guest_noshow`]    = 0;
        }
      }

      // Drop row entirely if all 3 meals are excluded
      if (MEAL_ORDER.every(m => excluded.has(m))) return null;
      return r;
    }).filter(Boolean);
  }
  // ─────────────────────────────────────────────────────────────────────────

  req.log.info('food_report_success', { start_date, end_date, count: filteredReport.length });
  return res.status(200).send({ message: MSG_FETCH_SUCCESSFUL, data: filteredReport });
};

export const foodReportDetails = async (req, res) => {
  const { meal, is_issued, date } = req.query;
  req.log.info('food_report_details_start', { meal, is_issued, date });

  if (!['breakfast', 'lunch', 'dinner'].includes(meal)) {
    req.log.warn('food_report_details_invalid_meal', { meal });
    return res.status(400).json({ message: 'Invalid meal type' });
  }

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
    order: [[CardDb, 'issuedto', 'ASC']]
  });

  req.log.info('food_report_details_success', { meal, date, count: bookings.length });
  return res.status(200).send({ data: bookings });
};

export const foodReportDetailsGuests = async (req, res) => {
  const { meal, date, is_issued } = req.query;
  req.log.info('food_report_details_guests_start', { meal, date, is_issued });

  if (!meal || !date) {
    req.log.warn('food_report_details_guests_missing_params', { meal, date });
    return res.status(400).json({ message: 'Missing meal or date parameter' });
  }

  if (!['breakfast', 'lunch', 'dinner'].includes(meal)) {
    req.log.warn('food_report_details_guests_invalid_meal', { meal });
    return res.status(400).json({ message: 'Invalid meal type' });
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

    req.log.info('food_report_details_guests_success', { meal, date, count: bookings.length });
    return res.status(200).send({ data: bookings });
  } catch (error) {
    req.log.error('food_report_details_guests_error', { meal, date, error: error.message });
    return res.status(500).json({ message: 'Internal server error' });
  }
};

export const fetchMenu = async (req, res) => {
  const { startDate, endDate } = req.query;
  req.log.info('fetch_menu_start', { startDate, endDate });

  const menu = await Menu.findAll({
    where: {
      date: { [Sequelize.Op.between]: [startDate, endDate] }
    }
  });

  req.log.info('fetch_menu_success', { startDate, endDate, count: menu.length });
  return res.status(200).send({ data: menu });
};

export const addMenu = async (req, res) => {
  const { date, breakfast, lunch, dinner } = req.body;
  req.log.info('add_menu_start', { date });

  const menu = await Menu.findOne({
    where: { date }
  });

  if (menu) {
    req.log.warn('add_menu_already_exists', { date });
    throw new ApiError(400, 'Menu already exists for given date');
  }

  await Menu.create({
    date,
    breakfast,
    lunch,
    dinner,
    updatedBy: req.user.username
  });

  req.log.info('add_menu_success', { date });
  return res.status(200).send({ message: 'Menu added' });
};

export const updateMenu = async (req, res) => {
  const { date, breakfast, lunch, dinner } = req.body;
  req.log.info('update_menu_start', { date });

  const menu = await Menu.findOne({
    where: { date }
  });

  if (!menu) {
    req.log.warn('update_menu_not_found', { date });
    throw new ApiError(404, 'Menu not found for the given date.');
  }

  await menu.update({
    breakfast,
    lunch,
    dinner,
    updatedBy: req.user.username
  });

  req.log.info('update_menu_success', { date });
  return res.status(200).send({ message: MSG_UPDATE_SUCCESSFUL });
};

export const deleteMenu = async (req, res) => {
  const { date } = req.query;
  req.log.info('delete_menu_start', { date });

  const item = await Menu.destroy({
    where: {
      date: date
    }
  });

  if (item == 0) {
    req.log.warn('delete_menu_not_found', { date });
    throw new ApiError(404, 'Menu not found');
  }

  req.log.info('delete_menu_success', { date });
  return res.status(200).send({ message: 'Menu deleted' });
};

export const addBulkMenu = async (req, res) => {
  const { menus } = req.body;
  req.log.info('add_bulk_menu_start', { count: menus?.length });

  if (!Array.isArray(menus)) {
    req.log.warn('add_bulk_menu_invalid_format');
    return res.status(400).json({ message: 'Invalid format' });
  }

  try {
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
        updatedBy: req.user.username,
        createdAt: new Date(),
        updatedAt: new Date()
      }));

    req.log.info('add_bulk_menu_valid_records', { total: menus.length, valid: validMenus.length });

    if (validMenus.length === 0) {
      req.log.warn('add_bulk_menu_no_valid_records');
      return res.status(400).json({ message: 'No valid menu records found.' });
    }

    await Menu.bulkCreate(validMenus, {
      updateOnDuplicate: ['breakfast', 'lunch', 'dinner', 'updatedAt']
    });

    req.log.info('add_bulk_menu_success', { count: validMenus.length });
    res.status(200).json({ message: 'Menus uploaded successfully' });
  } catch (err) {
    req.log.error('add_bulk_menu_error', { error: err.message });
    res.status(500).json({ message: 'Server error while uploading menus' });
  }
};




export const getMealCountByMobile = async (req, res) => {
  const { mobno, fromDate, toDate } = req.body;
  req.log.info('get_meal_count_by_mobile_start', { mobno, fromDate, toDate });

  // Find utsavs overlapping the requested date range at Research Centre
  const utsavs = await UtsavDb.findAll({
    where: {
      start_date: { [Op.lte]: toDate },
      end_date: { [Op.gte]: fromDate },
      location: 'Research Centre'
    },
    attributes: ['id', 'name', 'start_date', 'end_date', 'location'],
    raw: true
  });

  // Build date exclusion conditions for utsav periods
  const exclusionConditions = utsavs.map((u) => ({
    date: {
      [Op.between]: [
        u.start_date > fromDate ? u.start_date : fromDate,
        u.end_date < toDate ? u.end_date : toDate
      ]
    }
  }));

  // Aggregate meal counts excluding utsav dates
  const result = await FoodDb.findAll({
    attributes: [
      [fn('COALESCE', fn('SUM', col('breakfast')), 0), 'breakfastBooked'],
      [fn('COALESCE', fn('SUM', col('breakfast_plate_issued')), 0), 'breakfastIssued'],
      [fn('COALESCE', fn('SUM', col('lunch')), 0), 'lunchBooked'],
      [fn('COALESCE', fn('SUM', col('lunch_plate_issued')), 0), 'lunchIssued'],
      [fn('COALESCE', fn('SUM', col('dinner')), 0), 'dinnerBooked'],
      [fn('COALESCE', fn('SUM', col('dinner_plate_issued')), 0), 'dinnerIssued']
    ],
    include: [
      {
        model: CardDb,
        attributes: [],
        required: true,
        where: { mobno }
      }
    ],
    where: {
      date: { [Op.between]: [fromDate, toDate] },
      ...(exclusionConditions.length > 0 && {
        [Op.not]: { [Op.or]: exclusionConditions }
      })
    },
    raw: true
  });

  const data = result[0] || {};

  const person = await CardDb.findOne({
    where: { mobno },
    attributes: ['issuedto', 'mobno', 'cardno'],
    raw: true
  });

  req.log.info('get_meal_count_by_mobile_success', { mobno, fromDate, toDate, utsavExcludedCount: utsavs.length });
  return res.status(200).send({
    message: MSG_FETCH_SUCCESSFUL,
    data,
    person,
    utsavExcluded: utsavs
  });
};