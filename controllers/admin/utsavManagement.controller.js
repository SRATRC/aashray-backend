import {
  UtsavDb,
  UtsavPackagesDb,
  UtsavBooking,
  CardDb,
  RoomBooking
} from '../../models/associations.js';
import BlockDates from '../../models/block_dates.model.js';
import {
  validateUtsavBooking,
  reserveUtsavSeat,
  openUtsavSeat,
  validateUtsavPackage,
  bookUtsavForMumukshus,
  cancelUtsavFoodBookings,
  bookFoodForUtsav,
  bookUtsavForMumukshusAdmin
} from '../../helpers/utsavBooking.helper.js';
import { sendUtsavBookingUpdateEmail } from '../../helpers/utsavBooking.helper.js';
import Sequelize, { QueryTypes } from 'sequelize';
import {
  adminCancelTransaction,
  createPendingTransaction,
  cancelTransaction
} from '../../helpers/transactions.helper.js';

import {
  STATUS_WAITING,
  STATUS_CONFIRMED,
  STATUS_PAYMENT_PENDING,
  STATUS_ADMIN_CANCELLED,
  STATUS_CASH_COMPLETED,
  STATUS_CASH_PENDING,
  TYPE_UTSAV,
  STATUS_CREDITED,
  STATUS_CANCELLED,
  ROOM_STATUS_CHECKEDIN,
  RESEARCH_CENTRE,
  STATUS_OPEN,
  STATUS_PAYMENT_COMPLETED,
  ERR_BOOKING_ALREADY_CANCELLED
} from '../../config/constants.js';
import { validateCard } from '../../helpers/card.helper.js';
import Transactions from '../../models/transactions.model.js';
import database from '../../config/database.js';
import moment from 'moment';
import ApiError from '../../utils/ApiError.js';
import XLSX from 'xlsx';
import { sendUtsavStatusChangeWhatsApp, sendUnifiedWhatsApp } from '../../helpers/whatsapp.helper.js';
import { issueFoodPlate } from '../../helpers/foodBooking.helper.js';

export const createUtsavBookingByAdmin = async (req, res) => {
  const { utsavid, mumukshus } = req.body;

  req.log.info('create_utsav_booking_by_admin_start', { utsavid, mumukshuCount: mumukshus?.length });

  // Validation
  if (!utsavid || !Array.isArray(mumukshus) || mumukshus.length === 0) {
    req.log.warn('create_utsav_booking_by_admin_invalid_input', { utsavid });
    return res
      .status(400)
      .send({ message: 'utsavid and mumukshus are required' });
  }

  for (const m of mumukshus) {
    if (!m?.cardno || !m?.packageid) {
      req.log.warn('create_utsav_booking_by_admin_missing_fields', { utsavid });
      return res
        .status(400)
        .send({ message: 'Each mumukshu must include cardno and packageid' });
    }
  }

  // Start transaction
  const t = await database.transaction();
  req.transaction = t;

  try {
    // Create bookings
    const result = await bookUtsavForMumukshusAdmin(
      utsavid,
      mumukshus,
      t,
      req.user
    );

    // Commit transaction
    await t.commit();

    console.log("✅ Transaction committed successfully");
    console.log("📦 Booking result:", result);

    // Send notifications AFTER successful commit (with separate error handling)
    try {
      for (const cardno in result.userBookingIds) {
        const bookingIds = result.userBookingIds[cardno];

        for (const id of bookingIds) {
          console.log(`\n📋 Processing booking: ${id}`);

          // Fetch booking and card details
          const booking = await UtsavBooking.findOne({
            where: { bookingid: id },
            include: [
              { model: UtsavDb },
              { model: UtsavPackagesDb }
            ]
          });

          if (!booking) {
            console.warn(`⚠️ Booking not found: ${id}`);
            continue;
          }

          const card = await CardDb.findOne({
            where: { cardno: booking.cardno }
          });

          if (!card) {
            console.warn(`⚠️ Card not found for booking: ${id}`);
            continue;
          }

          console.log("📋 Booking details:", {
            bookingid: booking.bookingid,
            cardno: card.cardno,
            name: card.issuedto,
            mobno: card.mobno,
            roomno: booking.roomno,
            status: booking.status
          });

          // Send Email (with separate error handling)
          try {
            await sendUtsavBookingUpdateEmail(booking, null);
            console.log(`✅ Email sent for booking: ${id}`);
          } catch (emailError) {
            console.error(`❌ Email failed for booking: ${id}`);
            console.error("Email error:", emailError.message);
          }

          // Send WhatsApp (with separate error handling)
          try {
            if (card.mobno) {
              await sendUnifiedWhatsApp(
                card.cardno,
                [],
                [],
                [],
                [booking]
              );
              console.log(`✅ WhatsApp sent successfully for booking: ${id}`);
            } else {
              console.warn(`⚠️ No phone number for booking: ${id}`);
            }
          } catch (err) {
            console.error(`❌ WhatsApp failed for cardno=${card.cardno}:`, err.message);
          }
        }
      }
    } catch (e) {
      req.log.warn('create_utsav_booking_by_admin_email_failed', { utsavid, error: e?.message });
    }

    req.log.info('create_utsav_booking_by_admin_success', { utsavid, mumukshuCount: mumukshus.length });
    // Return success response
    return res.status(200).send({
      message: "Utsav booking(s) created by admin",
      data: result,
    });

  } catch (err) {
    // Rollback transaction on error
    await t.rollback();
    console.error("❌ Transaction failed and rolled back:", err);
    throw err;
  }
};

const VALID_MEALS = ['breakfast', 'lunch', 'dinner'];

function validateMealField(value, fieldName) {
  if (value === null || value === undefined) return;
  if (!Array.isArray(value))
    throw new ApiError(400, `${fieldName} must be an array`);
  if (value.length === 0)
    throw new ApiError(400, `${fieldName} cannot be an empty array`);
  const invalid = value.filter(m => !VALID_MEALS.includes(m));
  if (invalid.length)
    throw new ApiError(400, `${fieldName} contains invalid values: ${invalid.join(', ')}. Allowed: breakfast, lunch, dinner`);
  if (new Set(value).size !== value.length)
    throw new ApiError(400, `${fieldName} contains duplicate values`);
}

export const createUtsav = async (req, res) => {
  const {
    name,
    start_date,
    end_date,
    total_seats,
    location,
    registration_deadline,
    starting_meal,
    ending_meal
  } = req.body;

  validateMealField(starting_meal, 'starting_meal');
  validateMealField(ending_meal, 'ending_meal');

  req.log.info('create_utsav_start', { name, start_date, end_date, total_seats, location });

  if (
    !moment(registration_deadline, 'YYYY-MM-DD').isBefore(
      moment(start_date, 'YYYY-MM-DD'),
      'day'
    )
  ) {
    req.log.warn('create_utsav_invalid_deadline', { name, registration_deadline, start_date });
    return res.status(400).send({
      message: 'Registration deadline must be before the start date'
    });
  }

  const alreadyExists = await UtsavDb.findOne({
    where: {
      name: { [Sequelize.Op.like]: name },
      start_date: start_date
    }
  });

  if (alreadyExists) {
    req.log.warn('create_utsav_already_exists', { name, start_date });
    throw new ApiError(400, 'Utsav Already Exists');
  }

  const month = moment(start_date).format('MMMM');

  const t = await database.transaction();
  req.transaction = t;

  const utsavDetails = await UtsavDb.create(
    {
      name,
      start_date,
      end_date,
      month,
      total_seats,
      location: location || RESEARCH_CENTRE,
      available_seats: total_seats,
      status: STATUS_OPEN,
      registration_deadline,
      starting_meal,
      ending_meal,
      updatedBy: req.user.username
    },
    { transaction: t }
  );

  if ((location || RESEARCH_CENTRE) === RESEARCH_CENTRE) {
    await BlockDates.create(
      {
        checkin: start_date,
        checkout: moment(end_date).add(1, 'day').format('YYYY-MM-DD'),
        comments: name,
        updatedBy: req.user.username
      },
      { transaction: t }
    );
  }

  await t.commit();

  req.log.info('create_utsav_success', { utsavId: utsavDetails.id, name, start_date, end_date });
  return res.status(200).send({ message: 'Created Utsav', data: utsavDetails });
};

export const addUtsavPackagesBulk = async (req, res) => {
  const { packages } = req.body;

  req.log.info('add_utsav_packages_bulk_start', { count: packages?.length });

  // ✅ Basic payload check
  if (!Array.isArray(packages) || packages.length === 0) {
    req.log.warn('add_utsav_packages_bulk_no_packages');
    return res.status(400).send({
      message: 'No packages provided'
    });
  }

  // ✅ In-request duplicate name check (NEW — IMPORTANT)
  const names = packages.map(p =>
    p?.name?.trim()?.toLowerCase()
  );

  const duplicateNames = names.filter(
    (name, index) => name && names.indexOf(name) !== index
  );

  if (duplicateNames.length) {
    return res.status(400).send({
      message: `Duplicate package names in request: ${[
        ...new Set(duplicateNames)
      ].join(', ')}`
    });
  }

  const t = await database.transaction();

  try {
    for (const pkg of packages) {
      const {
        utsavid,
        name,
        start_date,
        end_date,
        amount
      } = pkg;

      // ✅ Required field validation (NEW)
      if (!utsavid || !name || !start_date || !end_date || !amount) {
        throw new ApiError(
          400,
          `All fields required for package "${name || 'unknown'}"`
        );
      }

      // ✅ Amount validation (NEW recommended)
      if (Number(amount) <= 0) {
        throw new ApiError(
          400,
          `Invalid amount for package "${name}"`
        );
      }

      // ✅ Validate utsav exists
      const utsav = await validateUtsav(utsavid);

      const packageStart = moment(start_date);
      const packageEnd = moment(end_date);
      const utsavStart = moment(utsav.start_date);
      const utsavEnd = moment(utsav.end_date);

      // ✅ Package within utsav range
      if (
        packageStart.isBefore(utsavStart, 'day') ||
        packageEnd.isAfter(utsavEnd, 'day')
      ) {
        throw new ApiError(
          400,
          `Package "${name}" dates must be within the Utsav dates`
        );
      }

      // ✅ End >= Start
      if (packageEnd.isBefore(packageStart, 'day')) {
        throw new ApiError(
          400,
          `Package "${name}" end date cannot be before start date`
        );
      }

      // ✅ Duplicate check in DB (same as old API)
      const exists = await UtsavPackagesDb.findOne({
        where: {
          utsavid,
          name
        },
        transaction: t
      });

      if (exists) {
        throw new ApiError(
          400,
          `Package "${name}" already exists for this Utsav`
        );
      }

      // ✅ Create package
      await UtsavPackagesDb.create(
        {
          utsavid,
          name,
          start_date,
          end_date,
          amount,
          updatedBy: req.user.username
        },
        { transaction: t }
      );
    }

    await t.commit();

    req.log.info('add_utsav_packages_bulk_success', { count: packages.length });
    return res.status(200).send({
      message: 'Packages Created Successfully'
    });

  } catch (err) {
    await t.rollback();
    throw err;
  }
};

export const addUtsavPackage = async (req, res) => {
  const { utsavid, name, start_date, end_date, amount } = req.body;

  req.log.info('add_utsav_package_start', { utsavid, name, start_date, end_date, amount });

  // 1. Get the Utsav details first
  const utsav = await UtsavDb.findOne({ where: { id: utsavid } });

  if (!utsav) {
    req.log.warn('add_utsav_package_utsav_not_found', { utsavid });
    return res.status(404).send({ message: 'Utsav not found' });
  }

  // Convert dates to moment objects
  const packageStart = moment(start_date);
  const packageEnd = moment(end_date);
  const utsavStart = moment(utsav.start_date);
  const utsavEnd = moment(utsav.end_date);

  // 2. Check if package dates fall within Utsav dates
  if (
    packageStart.isBefore(utsavStart, 'day') ||
    packageEnd.isAfter(utsavEnd, 'day')
  ) {
    return res.status(400).send({
      message: 'Package dates must be within the Utsav start and end dates'
    });
  }
  // 3. Check if package start is before or same as package end
  if (packageEnd.isBefore(packageStart, 'day')) {
    return res.status(400).send({
      message: 'Package end date cannot be before start date'
    });
  }
  // 4. Check for duplicate package name in the same Utsav
  const alreadyExists = await UtsavPackagesDb.findOne({
    where: {
      utsavid,
      name
    }
  });

  if (alreadyExists) {
    throw new ApiError(
      400,
      'Package with this name already exists for the Utsav'
    );
  }

  // 5. Create the package
  const packageData = await UtsavPackagesDb.create({
    utsavid,
    name,
    start_date,
    end_date,
    amount,
    updatedBy: req.user.username
  });

  req.log.info('add_utsav_package_success', { utsavid, name });
  return res
    .status(200)
    .send({ message: 'Package Created', data: packageData });
};

const validateUtsav = async (id) => {
  const utsav = await UtsavDb.findByPk(id);
  if (!utsav) throw new ApiError(404, 'Utsav not found');
  return utsav;
};

export const updateUtsav = async (req, res) => {
  const {
    name,
    start_date,
    end_date,
    status,
    total_seats,
    available_seats, // optional manual override
    comments,
    location,
    registration_deadline,
    starting_meal,
    ending_meal
  } = req.body;

  validateMealField(starting_meal, 'starting_meal');
  validateMealField(ending_meal, 'ending_meal');

  const utsavId = req.params.id;
  req.log.info('update_utsav_start', { utsavId, name, start_date, end_date, status, total_seats });

  const utsav = await validateUtsav(utsavId);
  const month = moment(start_date).format('MMMM');

  // 🧩 Hybrid available_seats logic
  let newAvailableSeats;

  // If total_seats changed → auto adjust
  if (total_seats != utsav.total_seats) {
    const diff = total_seats - utsav.total_seats;
    newAvailableSeats = Math.max(0, utsav.available_seats + diff);
  }
  // If same total_seats but frontend sent available_seats → allow manual override
  else if (available_seats !== undefined && available_seats !== null) {
    newAvailableSeats = available_seats;
  }
  // Otherwise → keep existing
  else {
    newAvailableSeats = utsav.available_seats;
  }

  await utsav.update({
    name,
    start_date,
    end_date,
    month,
    status,
    total_seats,
    available_seats: newAvailableSeats,
    comments,
    location,
    registration_deadline,
    starting_meal,
    ending_meal,
    updatedBy: req.user.username
  });

  req.log.info('update_utsav_success', { utsavId, newAvailableSeats });
  return res.status(200).send({ message: 'Updated Utsav' });
};

export const fetchUtsavBookings = async (req, res) => {
  const utsavid = req.query.utsavid;
  let status = req.query.status;
  req.log.info('fetch_utsav_bookings_start', { utsavid, status });

  if (status != null || status != undefined) {
    status = status.replace(/^"|"$/g, '').trim();
  }

  let statusToBeIncluded = [STATUS_CONFIRMED];
  if (status === 'waiting') {
    statusToBeIncluded = [STATUS_WAITING];
  } else if (status === 'confirmed') {
    statusToBeIncluded = [
      STATUS_CONFIRMED,
      STATUS_CASH_COMPLETED,
      ROOM_STATUS_CHECKEDIN
    ];
  } else if (status === 'checkedin') {
    statusToBeIncluded = [
      ROOM_STATUS_CHECKEDIN,
      STATUS_CONFIRMED,
      STATUS_CASH_COMPLETED
    ];
  } else if (status === 'pending') {
    statusToBeIncluded = [STATUS_PAYMENT_PENDING, STATUS_CASH_PENDING];
  } else if (status === 'cancelled') {
    statusToBeIncluded = [STATUS_CANCELLED];
  } else if (status === 'admin cancelled') {
    statusToBeIncluded = [STATUS_ADMIN_CANCELLED];
  }

  const page = parseInt(req.query.page) || req.body.page || 1;
  const pageSize = parseInt(req.query.page_size) || req.body.page_size || 10;
  const offset = (page - 1) * pageSize;

  await validateUtsav(utsavid);

  const utsavData = await database.query(
    `SELECT 
      t1.bookingid, t1.utsavid, t1.bookedby, t1.status, t1.packageid, t1.roomno, t1.arrival, t1.carno, t1.other, t1.volunteer, t1.createdAt,
      t2.cardno, t2.issuedto, t2.mobno, t2.gender, t2.center, t2.res_status, t2.dob,
      TIMESTAMPDIFF(YEAR, t2.dob, CURDATE()) AS age,
      t3.location, t3.name AS utsav_name,
      t4.name AS package_name,
      t5.status AS transaction_status,  -- 👈 fetch status from transactions table
      t5.description as comments
    FROM utsav_booking AS t1
    LEFT JOIN card_db AS t2 ON t1.cardno = t2.cardno
    LEFT JOIN utsav_db AS t3 ON t1.utsavid = t3.id
    LEFT JOIN utsav_packages_db AS t4 ON t1.packageid = t4.id AND t1.utsavid = t4.utsavid
    LEFT JOIN transactions AS t5 ON t1.bookingid = t5.bookingid
    WHERE t1.utsavid = :utsavid AND t1.status IN (:status)
    `,
    {
      replacements: {
        utsavid,
        status: statusToBeIncluded,
        pageSize,
        offset
      },
      raw: true,
      type: QueryTypes.SELECT
    }
  );

  req.log.info('fetch_utsav_bookings_success', { utsavid, count: utsavData.length });
  return res
    .status(200)
    .send({ message: 'Found Utsav Bookings', data: utsavData });
};

export const fetchUtsavBookingsVolunteer = async (req, res) => {
  const utsavid = req.query.utsavid;
  req.log.info('fetch_utsav_bookings_volunteer_start', { utsavid });

  if (!utsavid) {
    req.log.warn('fetch_utsav_bookings_volunteer_missing_utsavid');
    return res.status(400).send({ message: 'Missing utsavid' });
  }

  const statusToBeIncluded = [
    ROOM_STATUS_CHECKEDIN,
    STATUS_CONFIRMED,
    STATUS_CASH_COMPLETED
  ];

  await validateUtsav(utsavid); // still useful to validate utsav ID

  const result = await database.query(
    `SELECT 
  t2.issuedto AS name,
  t2.center AS centre,
  t4.name AS package_name,
  TIMESTAMPDIFF(YEAR, t2.dob, CURDATE()) AS age,
  IFNULL(t1.volunteer, 'not selected') AS volunteer,
  t2.mobno,
  t2.gender,
  t2.res_status
FROM utsav_booking AS t1
LEFT JOIN card_db AS t2 ON t1.cardno = t2.cardno
LEFT JOIN utsav_packages_db AS t4 ON t1.packageid = t4.id AND t1.utsavid = t4.utsavid
WHERE t1.utsavid = :utsavid AND t1.status IN (:status)
ORDER BY 
  (IFNULL(t1.volunteer, 'not selected') = 'not selected') ASC,
  (t1.volunteer = 'Unable to Volunteer') ASC,
  t1.volunteer ASC

    `,
    {
      replacements: { utsavid, status: statusToBeIncluded },
      raw: true,
      type: QueryTypes.SELECT
    }
  );

  req.log.info('fetch_utsav_bookings_volunteer_success', { utsavid, count: result.length });
  return res.status(200).send({
    message: 'Volunteer Access List Fetched',
    data: result
  });
};

export const fetchAllUtsav = async (req, res) => {
  req.log.info('fetch_all_utsav_start');

  const utsavs = await database.query(
    `SELECT
      utsav_db.id,
      utsav_db.name,
      utsav_db.start_date,
      utsav_db.end_date,
      utsav_db.status,
      utsav_db.total_seats,
      utsav_db.location,
      utsav_db.available_seats,
      utsav_db.registration_deadline,
      COUNT(CASE WHEN utsav_booking.status IN ('confirmed', 'cash completed', 'checkedin') THEN 1 END) AS confirmed_count,
      COUNT(CASE WHEN utsav_booking.status = '${ROOM_STATUS_CHECKEDIN}' THEN 1 END) AS checkedin_count,
      COUNT(CASE WHEN utsav_booking.status = '${STATUS_WAITING}' THEN 1 END) AS waitlist_count,
      COUNT(CASE WHEN utsav_booking.status = '${STATUS_PAYMENT_PENDING}' THEN 1 END) AS pending_count,
      COUNT(CASE WHEN utsav_booking.status = '${STATUS_CANCELLED}' THEN 1 END) AS selfcancel_count,  
      COUNT(CASE WHEN utsav_booking.status = '${STATUS_ADMIN_CANCELLED}' THEN 1 END) AS admincancel_count,
      COUNT(CASE 
  WHEN utsav_booking.status IN ('confirmed', 'cash completed', 'checkedin')
       AND utsav_booking.volunteer NOT IN ('Unable to Volunteer', 'not selected') 
       AND utsav_booking.volunteer IS NOT NULL
  THEN 1 
END) AS volunteer_opted_count

    FROM 
      utsav_db
    LEFT JOIN 
      utsav_booking ON utsav_db.id = utsav_booking.utsavid
    GROUP BY
      utsav_db.id,
      utsav_db.name,
      utsav_db.start_date,
      utsav_db.end_date,
      utsav_db.status,
      utsav_db.total_seats,
      utsav_db.location,
      utsav_db.available_seats,
      utsav_db.registration_deadline
     ORDER BY 
      utsav_db.start_date ASC;`,
    {
      type: QueryTypes.SELECT
    }
  );

  req.log.info('fetch_all_utsav_success', { count: utsavs.length });
  return res
    .status(200)
    .send({ message: 'Fetched Utsav Records', data: utsavs });
};

export const fetchUtsavByLocation = async (req, res) => {
  try {
    const { location } = req.query;
    req.log.info('fetch_utsav_by_location_start', { location });

    if (!location) {
      req.log.warn('fetch_utsav_by_location_missing_param');
      return res.status(400).send({ message: 'Location is required' });
    }

    const utsavs = await database.query(
      `SELECT
        utsav_db.id,
        utsav_db.name,
        utsav_db.start_date,
        utsav_db.end_date,
        utsav_db.status,
        utsav_db.total_seats,
        utsav_db.location,
        utsav_db.available_seats,
        utsav_db.registration_deadline,
        COUNT(CASE WHEN utsav_booking.status IN ('confirmed', 'cash completed', 'checkedin') THEN 1 END) AS confirmed_count,
        COUNT(CASE WHEN utsav_booking.status = '${ROOM_STATUS_CHECKEDIN}' THEN 1 END) AS checkedin_count,
        COUNT(CASE WHEN utsav_booking.status = '${STATUS_WAITING}' THEN 1 END) AS waitlist_count,
        COUNT(CASE WHEN utsav_booking.status = '${STATUS_PAYMENT_PENDING}' THEN 1 END) AS pending_count,
        COUNT(CASE WHEN utsav_booking.status = '${STATUS_CANCELLED}' THEN 1 END) AS selfcancel_count,
        COUNT(CASE WHEN utsav_booking.status = '${STATUS_ADMIN_CANCELLED}' THEN 1 END) AS admincancel_count,
        COUNT(CASE 
          WHEN utsav_booking.status IN ('confirmed', 'cash completed', 'checkedin')
               AND utsav_booking.volunteer NOT IN ('Unable to Volunteer', 'not selected') 
               AND utsav_booking.volunteer IS NOT NULL
          THEN 1 
        END) AS volunteer_opted_count
      FROM 
        utsav_db
      LEFT JOIN 
        utsav_booking ON utsav_db.id = utsav_booking.utsavid
      WHERE 
        utsav_db.location = :location
      GROUP BY
        utsav_db.id,
        utsav_db.name,
        utsav_db.start_date,
        utsav_db.end_date,
        utsav_db.status,
        utsav_db.total_seats,
        utsav_db.location,
        utsav_db.available_seats,
        utsav_db.registration_deadline
      ORDER BY 
        utsav_db.start_date ASC;`,
      {
        type: QueryTypes.SELECT,
        replacements: { location }
      }
    );

    req.log.info('fetch_utsav_by_location_success', { location, count: utsavs.length });
    return res.status(200).send({
      message: 'Fetched Utsav Records by Location',
      data: utsavs
    });
  } catch (error) {
    req.log.error('fetch_utsav_by_location_error', { error: error.message });
    return res.status(500).send({ message: 'Error fetching utsav data' });
  }
};

export const activateUtsav = async (req, res) => {
  req.log.info('activate_utsav_start', { id: req.params.id, activate: req.params.activate });

  const itemUpdated = await UtsavDb.update(
    {
      status: req.params.activate,
      updatedBy: req.user.username
    },
    {
      where: {
        id: req.params.id
      }
    }
  );

  if (itemUpdated[0] !== 1) {
    req.log.warn('activate_utsav_not_found', { id: req.params.id });
    throw new ApiError(500, 'Error occurred while updating Utsav status');
  }

  req.log.info('activate_utsav_success', { id: req.params.id, status: req.params.activate });
  res.status(200).send({ message: 'Utsav status updated' });
};

export const utsavStatusUpdate = async (req, res) => {
  const { utsav_id, bookingid, status, description, issueCredits } = req.body;

  let newBookingStatus = status;
  req.log.info('utsav_status_update_start', { utsav_id, bookingid, status, issueCredits });

  const t = await database.transaction();
  req.transaction = t;

  const utsav = await validateUtsav(utsav_id);
  const booking = await validateUtsavBooking(bookingid, utsav_id);
  const previousStatus = booking.status;

  if (status === booking.status) {
    req.log.warn('utsav_status_update_same_status', { bookingid, status });
    throw new ApiError(400, 'Status is same as before');
  }

  // Cannot change any status if already admin cancelled
  if (booking.status === STATUS_ADMIN_CANCELLED) {
    req.log.warn('utsav_status_update_already_cancelled', { bookingid });
    throw new ApiError(400, ERR_BOOKING_ALREADY_CANCELLED);
  }

  let transaction = await Transactions.findOne({ where: { bookingid } });

  switch (status) {
    case STATUS_CONFIRMED:
      // Confirmed allowed from payment pending or cancelled
      if (
        booking.status !== STATUS_PAYMENT_PENDING &&
        booking.status !== STATUS_CANCELLED
      ) {
        throw new ApiError(
          400,
          'Confirmed status can only be set from payment pending or cancelled'
        );
      }

      if (booking.status === STATUS_WAITING) {
        await reserveUtsavSeat(utsav, t);
      }

      if (!transaction) {
        const cardno = booking.bookedBy || booking.cardno;
        const card = await validateCard(cardno);

        transaction = await createPendingTransaction(
          card,
          booking,
          TYPE_UTSAV,
          utsav.amount,
          req.user.username,
          t,
          true
        );
        let utsav_packages_db = await UtsavPackagesDb.findOne({ where: { id: booking.packageid, utsavid: utsav.id } });
        await bookFoodForUtsav(utsav_packages_db, utsav, card, t, req.user.username);
      } else {
        if (transaction.status === STATUS_CANCELLED) {
          await transaction.update(
            {
              status: STATUS_PAYMENT_PENDING,
              updatedBy: req.user.username,
              description: description || 'Reopened after cancellation'
            },
            { transaction: t }
          );
        } else if (transaction.status === STATUS_CONFIRMED) {
          req.log.info('utsav_status_update_tx_already_confirmed', { bookingid });
        } else if (transaction.status === STATUS_PAYMENT_PENDING) {
          await transaction.update(
            {
              status: STATUS_PAYMENT_COMPLETED,
              description: description,
              updatedBy: req.user.username
            },
            { transaction: t }
          );
        }
      }
      break;

    case STATUS_PAYMENT_PENDING:
      if (booking.status !== STATUS_WAITING) {
        throw new ApiError(400, 'Payment Pending can only be set from waiting');
      }

      // Fetch package amount
      const pkg = await UtsavPackagesDb.findByPk(booking.packageid, {
        transaction: t
      });
      if (!pkg) throw new Error('Utsav Package not found');

      // ⭐ NEW: If amount = 0 → auto-confirm, skip transaction
      if (Number(pkg.amount) === 0) {
        req.log.info('utsav_status_update_zero_amount_auto_confirm', { bookingid, packageid: booking.packageid });

        // Reserve seat
        await reserveUtsavSeat(utsav, t);

        newBookingStatus = STATUS_CONFIRMED;

        await booking.update(
          {
            status: newBookingStatus,
            updatedBy: req.user.username,
            description:
              'Since package amount is 0, updating the status to confirmed.'
          },
          { transaction: t }
        );
        await bookFoodForUtsav(pkg, utsav, booking, t, req.user.username);
        await t.commit();

        await sendUtsavBookingUpdateEmail(booking, utsav);

        return res.status(200).send({
          message:
            'Since package amount is 0, updating the status to confirmed.'
        });
      }

      // ⭐ Original flow for paid packages
      await reserveUtsavSeat(utsav, t);

      transaction = await Transactions.findOne({
        where: { bookingid: booking.bookingid },
        transaction: t
      });

      if (
        !transaction ||
        ['credited', 'cancelled'].includes(transaction.status)
      ) {
        const cardnoToUse = booking.bookedBy || booking.cardno;

        const [existingTransaction, created] = await Transactions.findOrCreate({
          where: { bookingid: booking.bookingid },
          defaults: {
            cardno: cardnoToUse,
            category: TYPE_UTSAV,
            amount: pkg.amount,
            discount: 0,
            razorpay_order_id: null,
            description: description || 'Payment pending for Utsav',
            status: STATUS_PAYMENT_PENDING,
            updatedBy: req.user.username || 'admin'
          },
          transaction: t
        });
        await bookFoodForUtsav(pkg, utsav, booking, t, req.user.username);
        transaction = existingTransaction;
      }

      newBookingStatus = STATUS_PAYMENT_PENDING;
      break;

    case STATUS_ADMIN_CANCELLED:
      req.log.info('utsav_status_update_admin_cancelling', { bookingid, issueCredits });

      if (
        booking.status !== STATUS_WAITING &&
        booking.status !== STATUS_PAYMENT_PENDING &&
        booking.status !== STATUS_CONFIRMED &&
        booking.status !== STATUS_CANCELLED
      ) {
        throw new ApiError(
          400,
          'Admin Cancelled can only be set from waiting, payment pending, confirmed or cancelled'
        );
      }
      await cancelUtsavFoodBookings(booking,req.user.username,t);
      // 🪑 Free seat if applicable
      if (
        booking.status === STATUS_CONFIRMED ||
        booking.status === STATUS_PAYMENT_PENDING
      ) {
        const utsavRecord = await UtsavDb.findByPk(booking.utsavid, {
          transaction: t
        });
        if (!utsavRecord) throw new ApiError(404, 'Utsav not found');
        await openUtsavSeat(utsavRecord, booking.cardno, req.user.username, t);
      }

      if (transaction) {
        if (transaction.status === STATUS_CANCELLED) {
          // user had cancelled earlier, now admin upgrades it
          if (issueCredits === true || issueCredits === 'yes') {
            req.log.info('utsav_status_update_issuing_credits_prev_cancelled', { bookingid });
            await cancelTransaction(req.user, null, transaction, t, true);
          } else {
            req.log.info('utsav_status_update_marking_admin_cancelled_no_credits', { bookingid });
            await transaction.update(
              { status: STATUS_ADMIN_CANCELLED, updatedBy: req.user.username },
              { transaction: t }
            );
          }
        } else if (
          ![STATUS_CREDITED, STATUS_ADMIN_CANCELLED].includes(
            transaction.status
          )
        ) {
          // Normal admin cancel
          if (issueCredits === true || issueCredits === 'yes') {
            req.log.info('utsav_status_update_issuing_credits', { bookingid, amount: transaction.amount });
            await cancelTransaction(req.user, null, transaction, t, true);
          } else {
            const isCompletedStatus = [
              STATUS_PAYMENT_COMPLETED,
              STATUS_CASH_COMPLETED,
              'payment completed',
              'completed',
              'cash completed'
            ].includes(transaction.status);

            if (isCompletedStatus) {
              req.log.info('utsav_status_update_tx_already_completed_leaving_as_is', { bookingid, transactionStatus: transaction.status });
            } else {
              req.log.info('utsav_status_update_admin_cancelled_no_credits', { bookingid });
              await transaction.update(
                {
                  status: STATUS_ADMIN_CANCELLED,
                  description: description || 'Admin cancelled without credits',
                  updatedBy: req.user.username
                },
                { transaction: t }
              );
            }
          }
        } else {
          req.log.info('utsav_status_update_tx_already_cancelled_skipping', { bookingid });
        }
      } else {
        req.log.info('utsav_status_update_no_transaction', { bookingid });
      }

      newBookingStatus = STATUS_ADMIN_CANCELLED;
      break;

    case STATUS_WAITING:
      throw new ApiError(400, 'Invalid status transition to waiting');

    default:
      throw new ApiError(400, 'Invalid status provided');
  }

  await booking.update(
    { status: newBookingStatus, updatedBy: req.user.username },
    { transaction: t }
  );

  await t.commit();

  await sendUtsavBookingUpdateEmail(booking, utsav);

  try {
    let waOptions = { updatedBy: req.user.username };
    if (status === STATUS_ADMIN_CANCELLED && (issueCredits === 'yes' || issueCredits === true) && transaction) {
      waOptions.credits = (transaction.amount || 0) + (transaction.discount || 0);
    }
    await sendUtsavStatusChangeWhatsApp(booking, previousStatus, waOptions);
  } catch (waErr) {
    console.error("Error sending utsav status change WhatsApp in utsavStatusUpdate:", waErr);
  }

  req.log.info('utsav_status_update_transition', { bookingid, utsav_id, fromStatus: booking.status, toStatus: newBookingStatus });
  return res.status(200).send({ message: 'Updated booking status' });
};

export const fetchUtsav = async (req, res) => {
  const { id } = req.params;
  req.log.info('fetch_utsav_start', { id });

  const utsav = await UtsavDb.findOne({
    where: { id: id }
  });

  req.log.info('fetch_utsav_success', { id, found: !!utsav });
  return res.status(200).send({ message: 'Fetched Adhyayan', data: utsav });
};

export const updateUtsavPackage = async (req, res) => {
  const { name, start_date, end_date, amount } = req.body;
  const { id: packageId } = req.params;

  req.log.info('update_utsav_package_start', { packageId, name, amount });

  const utsavPackage = await UtsavPackagesDb.findByPk(packageId);

  if (!utsavPackage) {
    req.log.warn('update_utsav_package_not_found', { packageId });
    return res.status(404).send({ message: 'Package not found' });
  }

  await utsavPackage.update({
    name,
    start_date,
    end_date,
    amount,
    updatedBy: req.user.username
  });

  req.log.info('update_utsav_package_success', { packageId, name });
  return res.status(200).send({ message: 'Updated Utsav Package' });
};

export const fetchAllPackages = async (req, res) => {
  req.log.info('fetch_all_utsav_packages_start');

  const packages = await database.query(
    `SELECT 
        up.id,
        up.utsavid,
        up.name,
        up.start_date,
        up.end_date,
        up.amount,
        u.name AS utsav_name,
        COUNT(
          CASE WHEN ub.status = '${STATUS_WAITING}' THEN 1 END
        ) AS waitlist_count
     FROM utsav_packages_db up
     LEFT JOIN utsav_db u 
        ON up.utsavid = u.id
     LEFT JOIN utsav_booking ub 
        ON up.id = ub.packageid
     WHERE up.start_date > CURRENT_DATE
     GROUP BY 
        up.id,
        up.utsavid,
        up.name,
        up.start_date,
        up.end_date,
        up.amount,
        u.name
     ORDER BY up.start_date ASC`,
    {
      type: QueryTypes.SELECT
    }
  );

  req.log.info('fetch_all_utsav_packages_success', { count: packages.length });
  return res.status(200).send({
    message: 'Fetched Package Records',
    data: packages
  });
};

export const fetchPackagesByUtsav = async (req, res) => {
  const { utsavid } = req.query;
  req.log.info('fetch_packages_by_utsav_start', { utsavid });

  if (!utsavid) {
    req.log.warn('fetch_packages_by_utsav_missing_param');
    return res.status(400).send({ message: 'utsavid is required' });
  }

  const packages = await UtsavPackagesDb.findAll({
    where: { utsavid },
    order: [['start_date', 'ASC']]
  });

  req.log.info('fetch_packages_by_utsav_success', { utsavid, count: packages.length });
  return res
    .status(200)
    .send({ message: 'Fetched packages for utsav', data: packages });
};

export const fetchPackage = async (req, res) => {
  const { id } = req.params;
  req.log.info('fetch_utsav_package_start', { id });

  const packageData = await UtsavPackagesDb.findOne({
    where: { id: id }
  });

  if (!packageData) {
    req.log.warn('fetch_utsav_package_not_found', { id });
    return res.status(404).send({ message: 'Package not found' });
  }

  req.log.info('fetch_utsav_package_success', { id });
  return res
    .status(200)
    .send({ message: 'Fetched Package', data: packageData });
};

export const fetchAllUtsavList = async (req, res) => {
  try {
    req.log.info('fetch_all_utsav_list_start');

    const adhyayans = await database.query(
      `SELECT id, name FROM utsav_db ORDER BY id ASC`,
      {
        type: QueryTypes.SELECT,
        raw: true
      }
    );

    req.log.info('fetch_all_utsav_list_success', { count: adhyayans.length });
    return res.status(200).json({
      message: 'Fetched adhyayan list',
      data: adhyayans
    });
  } catch (error) {
    req.log.error('fetch_all_utsav_list_error', { error: error.message });
    return res.status(500).json({
      message: 'Failed to fetch adhyayan list',
      error: error.message
    });
  }
};

export const utsavCheckin = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const { cardno, utsavid } = req.body;
  req.log.info('utsav_checkin_start', { cardno, utsavid });

  const booking = await UtsavBooking.findOne({
    where: {
      cardno,
      utsavid,
      status: {
        [Sequelize.Op.notIn]: [
          STATUS_CANCELLED,
          STATUS_WAITING,
          STATUS_ADMIN_CANCELLED
        ]
      }
    },
    transaction: t
  });

  if (!booking) {
    await t.rollback();
    req.log.warn('utsav_checkin_not_found', { cardno, utsavid });
    throw new ApiError(404, 'Booking not found for this user');
  }

  if ([STATUS_PAYMENT_PENDING, STATUS_CASH_PENDING].includes(booking.status)) {
    await t.rollback();
    req.log.warn('utsav_checkin_payment_pending', { cardno, utsavid, bookingStatus: booking.status });
    throw new ApiError(400, "User haven't paid yet, cannot checkin");
  }

  if (booking.status === ROOM_STATUS_CHECKEDIN) {
    await t.rollback();
    req.log.info('utsav_checkin_already_checkedin', { cardno, utsavid });
    return res.status(200).send({
      message: 'Already checked in'
    });
  }

  const previousStatus = booking.status;

  await booking.update({ status: ROOM_STATUS_CHECKEDIN }, { transaction: t });

  await t.commit();

  try {
    await sendUtsavStatusChangeWhatsApp(booking, previousStatus, { updatedBy: req.user.username });
  } catch (waErr) {
    console.error("Error sending utsav status change WhatsApp in utsavCheckin:", waErr);
  }

  req.log.info('utsav_checkin_success', { cardno, utsavid, bookingid: booking.bookingid });
  return res.status(200).send({
    message: 'Utsav booking status updated to checkedin.'
  });
};

export const utsavCheckinReport = async (req, res) => {
  const utsavid = req.query.utsavid;
  let status = req.query.status;
  req.log.info('utsav_checkin_report_start', { utsavid, status });

  if (status != null || status != undefined) {
    status = status.replace(/^"|"$/g, '').trim();
  }

  let statusToBeIncluded = [];

  if (status === 'confirmed') {
    statusToBeIncluded = [STATUS_CONFIRMED, STATUS_CASH_COMPLETED];
  } else if (status === 'checkedin') {
    statusToBeIncluded = [
      ROOM_STATUS_CHECKEDIN,
      STATUS_CASH_COMPLETED,
      STATUS_CONFIRMED
    ];
  } else {
    // Default to both if no specific valid filter passed
    statusToBeIncluded = [STATUS_CONFIRMED, ROOM_STATUS_CHECKEDIN];
  }

  const page = parseInt(req.query.page) || req.body.page || 1;
  const pageSize = parseInt(req.query.page_size) || req.body.page_size || 10;
  const offset = (page - 1) * pageSize;

  await validateUtsav(utsavid);

  const utsavData = await database.query(
    `SELECT 
      t1.cardno,
      t1.bookingid,
      t1.bookedby,
      t1.updatedAt,
      t2.issuedto AS name,
      t2.center,
      t2.mobno,
      TIMESTAMPDIFF(YEAR, t2.dob, CURDATE()) AS age,
      t3.name AS package_name,   -- Correct package name
      CASE 
        WHEN t1.status = '${ROOM_STATUS_CHECKEDIN}' THEN 'yes'
        WHEN t1.status = '${STATUS_CONFIRMED}' THEN 'no'
        WHEN t1.status = '${STATUS_CASH_COMPLETED}' THEN 'no'
        ELSE 'unknown'
      END AS checkin_status
    FROM utsav_booking AS t1
    LEFT JOIN card_db AS t2 
      ON t1.cardno = t2.cardno
    LEFT JOIN utsav_packages_db AS t3 
      ON t1.packageid = t3.id   -- 👈 join on packageid instead of utsavid
    WHERE t1.utsavid = :utsavid 
      AND t1.status IN (:status)
  `,
    {
      replacements: {
        utsavid,
        status: statusToBeIncluded
      },
      raw: true,
      type: QueryTypes.SELECT
    }
  );

  req.log.info('utsav_checkin_report_success', { utsavid, count: utsavData.length });
  return res.status(200).send({
    message: 'Filtered Utsav Bookings',
    data: utsavData
  });
};

export const fetchVolunteerOptions = async (_req, res) => {
  // Keep keys aligned with app VOLUNTEER list values
  const options = [
    { key: 'admin', value: 'Admin' },
    { key: 'logistics', value: 'Logistics' },
    { key: 'kitchen', value: 'Kitchen' },
    { key: 'vv', value: 'Vitraag Vigyaan Bhavan' },
    { key: 'samadhi', value: 'Samadhi Sthal' },
    { key: 'none', value: 'Unable to Volunteer' }
  ];
  return res
    .status(200)
    .send({ message: 'Fetched volunteer options', data: options });
};

export const uploadRoomNoExcel = async (req, res) => {
  req.log.info('upload_room_no_excel_start');

  if (!req.file) {
    req.log.warn('upload_room_no_excel_no_file');
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
  const sheet = XLSX.utils.sheet_to_json(
    workbook.Sheets[workbook.SheetNames[0]],
    { defval: '' }
  );

  if (sheet.length === 0) {
    return res.status(400).json({ error: 'Excel file is empty.' });
  }

  try {
    // Ensure all rows have same utsavid
    const utsavidSet = new Set(
      sheet.map((r) => String(r.utsavid || '').trim())
    );
    if (utsavidSet.size !== 1) {
      return res
        .status(400)
        .json({ error: 'All rows must have the same UtsavID.' });
    }
    const utsavid = [...utsavidSet][0];

    // Fetch existing bookings for this utsavid (no transaction yet)
    // Fetch existing bookings for this utsavid but ONLY confirmed ones
    const existingBookings = await database.query(
      `SELECT bookingid, cardno, packageid, utsavid, status
   FROM utsav_booking
   WHERE utsavid = :utsavid
   AND status IN ('confirmed', 'checkedin')`,
      {
        replacements: { utsavid },
        type: database.QueryTypes.SELECT
      }
    );

    const bookingMap = new Map();
    existingBookings.forEach((b) => {
      bookingMap.set(`${b.cardno}||${b.utsavid}||${b.packageid}`, b.bookingid);
    });

    const validRows = [];
    const skippedRows = [];

    for (const row of sheet) {
      const bookingid = String(row.bookingid || '').trim();
      const roomno = String(row.roomno || '').trim();
      const cardno = String(row.cardno || '').trim();
      const packageid = String(row.packageid || '').trim();

      if (!bookingid || !roomno || !cardno || !utsavid || !packageid) {
        skippedRows.push({ row, reason: 'Missing required fields' });
        continue;
      }

      const key = `${cardno}||${utsavid}||${packageid}`;
      const expectedBookingId = bookingMap.get(key);

      if (!expectedBookingId) {
        skippedRows.push({
          row,
          reason:
            'CardNo / UtsavID / PackageID combination does not match existing booking'
        });
        continue;
      }

      if (bookingid !== expectedBookingId) {
        skippedRows.push({
          row,
          reason: `BookingID mismatch (expected: ${expectedBookingId})`
        });
        continue;
      }

      validRows.push({ bookingid, roomno });
    }

    if (validRows.length === 0) {
      return res
        .status(400)
        .json({ error: 'No valid rows to update.', skippedRows });
    }

    // Start transaction only for update
    const transaction = await database.transaction();
    try {
      const caseStatements = validRows.map(
        (r) => `WHEN '${r.bookingid}' THEN '${r.roomno}'`
      );
      const bookingIds = validRows.map((r) => `'${r.bookingid}'`);
      // define updatedBy and updatedAt
      const updatedBy = req.user?.username || 'system'; // adjust based on your auth

      const query = `
        UPDATE utsav_booking
        SET roomno = CASE bookingid
          ${caseStatements.join('\n')}
        END,
        updatedBy = '${updatedBy}'
        WHERE bookingid IN (${bookingIds.join(', ')});
      `;

      await database.query(query, { transaction });
      await transaction.commit();

      req.log.info('upload_room_no_excel_success', { updated: validRows.length, skipped: skippedRows.length });
      res.status(200).json({
        message: `${validRows.length} record(s) updated successfully.`,
        skippedRows
      });
    } catch (err) {
      await transaction.rollback();
      req.log.error('upload_room_no_excel_update_error', { error: err.message });
      res.status(500).json({ error: 'Error updating room numbers.' });
    }
  } catch (err) {
    req.log.error('upload_room_no_excel_processing_error', { error: err.message });
    res.status(500).json({ error: 'Error processing file.' });
  }
};

// Update room number for a booking
export const updateRoomNo = async (req, res) => {
  try {
    const { bookingid, roomno } = req.body;
    req.log.info('update_utsav_room_no_start', { bookingid, roomno });

    // assuming you're attaching logged-in user info in req.user
    const updatedBy = req.user?.username || req.user?.id || 'system';

    if (!bookingid || !roomno) {
      req.log.warn('update_utsav_room_no_missing_params', { bookingid, roomno });
      return res
        .status(400)
        .json({ error: 'bookingid and roomno are required' });
    }

    // Check if booking exists
    const booking = await UtsavBooking.findOne({ where: { bookingid } });

    if (!booking) {
      req.log.warn('update_utsav_room_no_not_found', { bookingid });
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Update fields
    booking.roomno = roomno;
    booking.updatedBy = updatedBy;
    await booking.save();

    req.log.info('update_utsav_room_no_success', { bookingid, roomno });
    return res.status(200).json({
      message: 'Room number updated successfully',
      booking
    });
  } catch (error) {
    req.log.error('update_utsav_room_no_error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
};

export const ReservationReport = async (req, res) => {
  try {
    const { utsavid, type, statuses } = req.query;
    req.log.info('utsav_reservation_report_start', { utsavid, type, statuses });

    if (!utsavid) {
      req.log.warn('utsav_reservation_report_missing_utsavid');
      return res.status(400).send({ message: 'utsav_id is required' });
    }

    if (
      !['pre_event_room_occupancy', 'post_event_room_occupancy'].includes(type)
    ) {
      req.log.warn('utsav_reservation_report_invalid_type', { type });
      return res.status(400).send({ message: 'Invalid report type' });
    }

    // -------------------------------------------------------------
    // 1. Fetch Utsav Start/End Date
    // -------------------------------------------------------------
    const utsav = await UtsavDb.findOne({
      where: { id: utsavid },
      attributes: ['start_date', 'end_date']
    });

    if (!utsav) {
      return res.status(404).send({ message: 'Event not found' });
    }

    const eventStart = new Date(utsav.start_date);
    const eventEnd = new Date(utsav.end_date);

    // -------------------------------------------------------------
    // 2. Compute pre/post date windows (CHECK-IN ONLY)
    // -------------------------------------------------------------
    let startDate, endDate;

    if (type === 'pre_event_room_occupancy') {
      startDate = new Date(eventStart);
      startDate.setDate(startDate.getDate() - 5);

      endDate = new Date(eventStart);
    }

    if (type === 'post_event_room_occupancy') {
      startDate = new Date(eventEnd);

      endDate = new Date(eventEnd);
      endDate.setDate(endDate.getDate() + 5);
    }

    // -------------------------------------------------------------
    // 3. Fetch Utsav Registrations (cardno only)
    // -------------------------------------------------------------
    const utsavRegistrations = await UtsavBooking.findAll({
      where: { utsavid },
      attributes: ['cardno'],
      raw: true
    });

    if (utsavRegistrations.length === 0) {
      return res.status(200).send({
        message: 'No registrations found for this event',
        data: []
      });
    }

    const registeredCardNos = utsavRegistrations.map((r) => r.cardno);

    // -------------------------------------------------------------
    // 4. Fetch Room Bookings for registered participants
    //    IMPORTANT: Check-in must be between the window only
    // -------------------------------------------------------------
    const reservations = await RoomBooking.findAll({
      include: [
        {
          model: CardDb,
          attributes: ['cardno', 'issuedto', 'mobno', 'center', 'credits'],
          required: true
        }
      ],
      attributes: [
        'bookingid',
        'roomno',
        'roomtype',
        'checkin',
        'checkout',
        'bookedBy',
        'status',
        'nights'
      ],
      where: {
        status: statuses,
        cardno: registeredCardNos,

        // ⭐ ONLY checkin matters (your requested logic)
        checkin: {
          [Sequelize.Op.between]: [startDate, endDate]
        }
      },
      order: [['checkin', 'ASC']]
    });

    req.log.info('utsav_reservation_report_success', { utsavid, type, count: reservations.length });
    return res.status(200).send({
      message: 'Fetched reservation report',
      data: reservations
    });
  } catch (err) {
    req.log.error('utsav_reservation_report_error', { error: err.message });
    return res.status(500).send({
      message: 'Server error',
      error: err.message
    });
  }
};

export const issuePlate = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  req.log.info('utsav_issue_plate_start', { cardno: req.params.cardno, meal: req.body.meal });

  const { message, issuedto } = await issueFoodPlate(
    req.params.cardno,
    req.body.meal,
    t
  );

  await t.commit();
  req.log.info('utsav_issue_plate_success', { cardno: req.params.cardno, meal: req.body.meal, issuedto });
  return res.status(200).send({ message, issuedto });
};

export const fetchUtsavFeedbacks = async (req, res) => {
  const {
    utsav_id,
    search = ''
  } = req.query;

  let whereClause = '';
  const replacements = {};

  if (utsav_id) {
    whereClause += ' AND uf.utsav_id = :utsav_id ';
    replacements.utsav_id = utsav_id;
  }

  if (search) {
    whereClause += `
      AND (
        c.cardno LIKE :search
        OR c.issuedto LIKE :search
      )
    `;

    replacements.search = `%${search}%`;
  }

  const feedbacks = await database.query(
    `
    SELECT
      uf.id,
      uf.cardno,
      c.issuedto,
      c.mobno,
      c.gender,
      c.center,
      c.res_status,
      uf.utsav_id,
      u.name AS utsav_name,
      uf.createdAt
    FROM utsav_feedback uf
    LEFT JOIN card_db c
      ON c.cardno = uf.cardno
    LEFT JOIN utsav_db u
      ON u.id = uf.utsav_id
    WHERE 1=1
    ${whereClause}
    ORDER BY uf.createdAt DESC
    `,
    {
      replacements,
      type: database.QueryTypes.SELECT
    }
  );

  const feedbackIds = feedbacks.map((f) => f.id);

  let answers = [];

  if (feedbackIds.length > 0) {
    answers = await database.query(
      `
      SELECT
        feedback_id,
        question_id,
        question_text,
        question_type,
        answer
      FROM utsav_feedback_answers
      WHERE feedback_id IN (:feedbackIds)
      ORDER BY id ASC
      `,
      {
        replacements: {
          feedbackIds
        },
        type: database.QueryTypes.SELECT
      }
    );
  }

  const groupedAnswers = {};

  answers.forEach((answer) => {
    if (!groupedAnswers[answer.feedback_id]) {
      groupedAnswers[answer.feedback_id] = [];
    }

    groupedAnswers[answer.feedback_id].push(answer);
  });

  const finalData = feedbacks.map((feedback) => {

    const answersObj = {};

    (groupedAnswers[feedback.id] || []).forEach((a) => {
      answersObj[a.question_id] = a.answer;
    });

    return {
      ...feedback,

      food_rating:
        answersObj.food_rating || '-',

      stay_rating:
        answersObj.stay_rating || '-',

      overall_rating:
        answersObj.overall_rating || '-',

      loved_most:
        answersObj.loved_most || '-',

      improvement_suggestions:
        answersObj.improvement_suggestions || '-',

      answers:
        groupedAnswers[feedback.id] || []
    };

  });
  return res.status(200).send({
    data: finalData
  });
};