
import {
  UtsavDb,
  UtsavPackagesDb,
  UtsavBooking,
  CardDb,
  RoomBooking,
  RoomDb,
  FlatDb,
  CustomForm,
  CustomFormResponse,
  UtsavRoomConfig
} from '../../models/associations.js';
import ShortLink from '../../models/short_link.model.js';
import WaGroupJob from '../../models/waGroupJob.model.js';
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
  ROOM_STATUS_CHECKEDOUT,
  ROOM_STATUS_PENDING_CHECKIN,
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
import {
  initializeEventRooms,
  preprocessGuests,
  runSmartAllocation
} from '../../helpers/roomAllocationEngine.js';
import { sendUtsavStatusChangeWhatsApp, sendUnifiedWhatsApp } from '../../helpers/whatsapp.helper.js';
import { issueFoodPlate } from '../../helpers/foodBooking.helper.js';

function normalizeRoomLabel(roomStr) {
  if (!roomStr) return '';
  const str = String(roomStr).trim();
  const numMatch = str.match(/\d+/);
  const num = numMatch ? parseInt(numMatch[0], 10) : 0;

  if (num >= 1 && num <= 60) {
    // Inside RC Room (OAG / NAG)
    if (str.includes('_')) {
      const suffix = str.substring(str.indexOf('_'));
      return `Room ${num}${suffix}`;
    }
    return `Room ${num}`;
  } else if (num >= 200 || str.toLowerCase().startsWith('flat')) {
    // Resident Flat
    return str.toLowerCase().startsWith('flat') ? str : `Flat ${num}`;
  }
  return str;
}

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
    ending_meal,
    whatsapp_link
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
      whatsapp_link,
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

  if (whatsapp_link) {
    const slug = `u${utsavDetails.id}`;
    await ShortLink.upsert(
      {
        slug,
        target_url: whatsapp_link,
        type: 'utsav',
        active: true,
        createdBy: req.user.username
      },
      { transaction: t }
    );

    const inviteMatch = whatsapp_link.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/);
    if (inviteMatch && inviteMatch[1]) {
      await WaGroupJob.create(
        {
          action: 'resolve_invite_link',
          status: 'pending',
          priority: 'high',
          payload: {
            inviteCode: inviteMatch[1],
            type: 'utsav',
            eventId: utsavDetails.id
          }
        },
        { transaction: t }
      );
    }
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
    ending_meal,
    whatsapp_link
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

  const previousWhatsappLink = utsav.whatsapp_link;
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
    whatsapp_link,
    updatedBy: req.user.username
  });

  if (whatsapp_link) {
    const slug = `u${utsavId}`;
    await ShortLink.upsert({
      slug,
      target_url: whatsapp_link,
      type: 'utsav',
      active: true,
      createdBy: req.user.username
    });

    const inviteMatch = whatsapp_link.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/);
    if (inviteMatch && inviteMatch[1] && whatsapp_link !== previousWhatsappLink) {
      await WaGroupJob.create({
        action: 'resolve_invite_link',
        status: 'pending',
        priority: 'high',
        payload: {
          inviteCode: inviteMatch[1],
          type: 'utsav',
          eventId: utsavId
        }
      });
    }
  }

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
      t1.bookingid,
      t2.cardno,
      t2.issuedto,
      TIMESTAMPDIFF(YEAR, t2.dob, CURDATE()) AS age,
      t4.name AS package_name,
      t1.roomno,
      t1.createdAt,
      t1.arrival,
      t1.carno,
      t1.volunteer,
      t1.other,
      t5.description as comments,
      t2.mobno,
      t2.gender,
      t2.center,
      t2.res_status,
      t1.status,
      t5.status AS transaction_status,
      t1.bookedby,
      t1.utsavid,
      t1.packageid,
      t2.dob,
      t3.location,
      t3.name AS utsav_name
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
      utsav_db.whatsapp_link,
      utsav_db.whatsapp_group_jid,
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
      utsav_db.registration_deadline,
      utsav_db.whatsapp_link,
      utsav_db.whatsapp_group_jid
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

  const { cardno, utsavid, scannedAt } = req.body;
  req.log.info('utsav_checkin_start', { cardno, utsavid, scannedAt });

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

  const updateFields = { status: ROOM_STATUS_CHECKEDIN };
  if (scannedAt) {
    if (!moment(scannedAt).isValid()) {
      throw new ApiError(400, 'Invalid scannedAt timestamp');
    }
    updateFields.updatedAt = new Date(scannedAt);
  }

  await booking.update(updateFields, { transaction: t });

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
    t,
    req.body.date,
    req.body.scannedAt
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

/**
 * GET /api/v1/admin/utsav/system-room-allocation
 * Computes intelligent room suggestions for confirmed utsav participants based on:
 * 1. Flat ownership in flatdb (auto-suggest 'Flat <flatno>')
 * 2. Flat host form submissions & verified guest allocations
 * 3. International (non-Indian) participants with pre/post room bookings in room_booking
 */
export const getSystemRoomAllocations = async (req, res) => {
  const utsavid = req.query.utsavid;
  req.log.info('system_room_allocation_fetch_start', { utsavid });

  if (!utsavid) {
    throw new ApiError(400, 'utsavid is required');
  }

  const utsav = await UtsavDb.findByPk(utsavid);
  if (!utsav) {
    throw new ApiError(404, 'Utsav event not found');
  }

  const statusToBeIncluded = [
    STATUS_CONFIRMED,
    STATUS_CASH_COMPLETED,
    ROOM_STATUS_CHECKEDIN
  ];

  // Fetch confirmed participants
  const participants = await database.query(
    `SELECT 
      t1.bookingid, t1.utsavid, t1.bookedby, t1.status, t1.packageid, t1.roomno, t1.arrival, t1.carno, t1.other, t1.volunteer, t1.createdAt,
      t2.cardno, t2.issuedto AS name, t2.mobno, t2.gender, t2.center, t2.country, t2.res_status, t2.dob,
      TIMESTAMPDIFF(YEAR, t2.dob, CURDATE()) AS age,
      t3.location, t3.name AS utsav_name,
      t4.name AS package_name,
      t5.status AS transaction_status,
      t5.description AS mumukshu_comments
    FROM utsav_booking AS t1
    LEFT JOIN card_db AS t2 ON t1.cardno = t2.cardno
    LEFT JOIN utsav_db AS t3 ON t1.utsavid = t3.id
    LEFT JOIN utsav_packages_db AS t4 ON t1.packageid = t4.id AND t1.utsavid = t4.utsavid
    LEFT JOIN transactions AS t5 ON t1.bookingid = t5.bookingid
    WHERE t1.utsavid = :utsavid AND t1.status IN (:status)
    ORDER BY t1.createdAt ASC`,
    {
      replacements: { utsavid, status: statusToBeIncluded },
      type: QueryTypes.SELECT
    }
  );

  // 1. Fetch Flat Owners from flatdb
  const flats = await FlatDb.findAll({ raw: true });
  const flatOwnerMap = new Map(); // cardno -> flatno
  flats.forEach(f => {
    if (f.owner && f.flatno) {
      flatOwnerMap.set(String(f.owner).trim(), String(f.flatno).trim());
    }
  });

  // 2. Fetch Flat Host Forms & Submissions for this event
  const flatHostForms = await CustomForm.findAll({
    where: { event_id: utsavid, status: 'active' },
    raw: true
  });
  const flatHostFormIds = flatHostForms.map(f => f.id);

  const flatFormResponses = flatHostFormIds.length > 0 ? await CustomFormResponse.findAll({
    where: { form_id: { [Sequelize.Op.in]: flatHostFormIds } },
    raw: true
  }) : [];

  const formGuestMap = new Map(); // cardno / mobno -> flatno
  flatFormResponses.forEach(r => {
    const resp = r.responses || {};
    const flatno = resp.flatno;
    if (flatno) {
      if (r.cardno) formGuestMap.set(String(r.cardno).trim(), String(flatno).trim());
      if (Array.isArray(resp.guests_list)) {
        resp.guests_list.forEach(g => {
          if (g.cardno) formGuestMap.set(String(g.cardno).trim(), String(flatno).trim());
          if (g.mobno) formGuestMap.set(String(g.mobno).trim(), String(flatno).trim());
        });
      }
    }
  });

  // 3. Pre/Post event room bookings for international guests
  const internationalParticipants = participants.filter(p => {
    const c = String(p.country || '').trim().toLowerCase();
    return c && c !== 'india' && c !== 'ind' && c !== 'null';
  });

  const internationalCardnos = internationalParticipants.map(p => p.cardno).filter(Boolean);

  let prePostRoomMap = new Map(); // cardno -> { roomno, details }
  if (internationalCardnos.length > 0 && utsav.start_date && utsav.end_date) {
    const startDate = moment(utsav.start_date).format('YYYY-MM-DD');
    const endDate = moment(utsav.end_date).format('YYYY-MM-DD');
    const searchFromDate = moment(utsav.start_date).subtract(30, 'days').format('YYYY-MM-DD');
    const searchToDate = moment(utsav.end_date).add(30, 'days').format('YYYY-MM-DD');

    const generalRoomBookings = await RoomBooking.findAll({
      where: {
        cardno: { [Sequelize.Op.in]: internationalCardnos },
        status: { [Sequelize.Op.notIn]: ['cancelled', 'admin cancelled', 'waiting'] },
        roomno: { [Sequelize.Op.and]: [{ [Sequelize.Op.ne]: null }, { [Sequelize.Op.ne]: '' }, { [Sequelize.Op.ne]: 'NA' }, { [Sequelize.Op.ne]: '-' }] },
        checkin: { [Sequelize.Op.lte]: searchToDate },
        checkout: { [Sequelize.Op.gte]: searchFromDate }
      },
      raw: true,
      order: [['checkin', 'ASC']]
    });

    generalRoomBookings.forEach(rb => {
      const rawRoom = String(rb.roomno || '').trim();
      if (!rawRoom || rawRoom === 'NA' || rawRoom === '-' || rawRoom === 'null') return;

      const cin = moment(rb.checkin).format('YYYY-MM-DD');
      const cout = moment(rb.checkout).format('YYYY-MM-DD');
      const isPreEvent = cout >= startDate && cin <= startDate;
      const isPostEvent = cin <= endDate && cout >= endDate;
      const isOverlapping = (cin <= endDate && cout >= startDate);

      if (isPreEvent || isPostEvent || isOverlapping) {
        prePostRoomMap.set(String(rb.cardno).trim(), {
          roomno: rawRoom,
          checkin: cin,
          checkout: cout,
          type: isPreEvent && isPostEvent ? 'Pre & Post Event' : (isPreEvent ? 'Pre-Event' : (isPostEvent ? 'Post-Event' : 'Adjacent Stay'))
        });
      }
    });
  }

  // 4. Compute suggestions for all participants
  const enrichedParticipants = participants.map((p, index) => {
    const cardnoClean = String(p.cardno || '').trim();
    const mobClean = String(p.mobno || '').trim();
    const isInternational = String(p.country || '').trim().toLowerCase() !== 'india' && String(p.country || '').trim().length > 0 && String(p.country || '').trim().toLowerCase() !== 'ind';
    
    let suggestedRoom = '';
    let allocationType = 'unassigned';
    let allocationReason = 'No rule matched';
    let ruleMatched = false;

    // Rule 1 & 3: Flat / Room Owner in flatdb
    if (flatOwnerMap.has(cardnoClean)) {
      const fno = flatOwnerMap.get(cardnoClean);
      const fNum = parseInt(fno, 10);
      const isRcRoom = !isNaN(fNum) && fNum >= 1 && fNum <= 60;
      const prefix = isRcRoom ? 'Room ' : 'Flat ';
      suggestedRoom = prefix + fno;
      allocationType = isRcRoom ? 'room_owner' : 'flat_owner';
      allocationReason = `${isRcRoom ? 'Room' : 'Flat'} Owner (${prefix}${fno})`;
      ruleMatched = true;
    }
    // Rule 1: Host form allocation (co-owner or verified guest)
    else if (formGuestMap.has(cardnoClean) || formGuestMap.has(mobClean)) {
      const fno = formGuestMap.get(cardnoClean) || formGuestMap.get(mobClean);
      const fNum = parseInt(fno, 10);
      const isRcRoom = !isNaN(fNum) && fNum >= 1 && fNum <= 60;
      const prefix = isRcRoom ? 'Room ' : 'Flat ';
      suggestedRoom = prefix + fno;
      allocationType = isRcRoom ? 'room_host_guest' : 'flat_host_guest';
      allocationReason = `Host Accommodation (${prefix}${fno})`;
      ruleMatched = true;
    }
    // Rule 2: International participant with pre/post general room booking
    else if (isInternational && prePostRoomMap.has(cardnoClean)) {
      const prePost = prePostRoomMap.get(cardnoClean);
      suggestedRoom = prePost.roomno;
      allocationType = 'international_pre_post';
      allocationReason = `International Guest (${prePost.type}: Room ${prePost.roomno})`;
      ruleMatched = true;
    }
    // Fallback: If room is already allotted in utsav_booking
    else if (p.roomno && String(p.roomno).trim() !== '' && String(p.roomno).trim() !== '-') {
      suggestedRoom = p.roomno;
      allocationType = 'already_allotted';
      allocationReason = 'Current Allotment';
    }

    return {
      index: index + 1,
      bookingid: p.bookingid,
      cardno: p.cardno,
      name: p.name || 'Member',
      age: p.age !== null ? p.age : '-',
      gender: p.gender || '-',
      mobno: p.mobno || '-',
      center: p.center || '-',
      country: p.country || 'India',
      isInternational,
      package_name: p.package_name || 'Standard Package',
      mumukshu_comments: p.mumukshu_comments || p.other || '',
      current_roomno: p.roomno && p.roomno !== '-' ? p.roomno : '',
      suggested_roomno: suggestedRoom,
      allocation_type: allocationType,
      allocation_reason: allocationReason,
      rule_matched: ruleMatched
    };
  });

  return res.status(200).json({
    success: true,
    data: {
      utsav: {
        id: utsav.id,
        name: utsav.name,
        start_date: utsav.start_date,
        end_date: utsav.end_date,
        location: utsav.location
      },
      summary: {
        total: enrichedParticipants.length,
        auto_allotted: enrichedParticipants.filter(p => p.rule_matched).length,
        already_assigned: enrichedParticipants.filter(p => p.current_roomno && !p.rule_matched).length,
        unassigned: enrichedParticipants.filter(p => !p.current_roomno && !p.rule_matched).length
      },
      participants: enrichedParticipants
    }
  });
};

/**
 * POST /api/v1/admin/utsav/apply-room-allocations
 * Batch updates room numbers for selected utsav bookings.
 */
export const applyRoomAllocations = async (req, res) => {
  const { utsavid, allocations } = req.body;
  req.log.info('apply_room_allocations_start', { utsavid, count: allocations?.length });

  if (!utsavid) {
    throw new ApiError(400, 'utsavid is required');
  }
  if (!Array.isArray(allocations) || allocations.length === 0) {
    throw new ApiError(400, 'allocations array is required');
  }

  let updatedCount = 0;
  const defaultAdmin = req.user?.cardno ? String(req.user.cardno) : 'SYSTEM-ROOM-ALLOCATION';

  for (const item of allocations) {
    if ((item.bookingid || item.cardno) && item.roomno !== undefined) {
      const cleanRoom = typeof normalizeRoomLabel === 'function' ? normalizeRoomLabel(item.roomno) : String(item.roomno || '').trim();
      const whereClause = { utsavid: parseInt(utsavid, 10) };
      if (item.bookingid) whereClause.bookingid = item.bookingid;
      else if (item.cardno) whereClause.cardno = String(item.cardno).trim();

      const recordUpdatedBy = item.updatedBy || (item.source === 'manual' ? defaultAdmin : 'SYSTEM-ROOM-ALLOCATION');

      const [count] = await UtsavBooking.update(
        { roomno: cleanRoom || null, updatedBy: recordUpdatedBy },
        { where: whereClause }
      );
      if (count > 0) updatedCount += count;
    }
  }

  req.log.info('apply_room_allocations_success', { utsavid, updatedCount });
  return res.status(200).json({
    success: true,
    message: `Successfully updated room allocations for ${updatedCount} booking(s)`,
    data: { updatedCount }
  });
};


// ═══════════════════════════════════════════════════════════════════════════
// SMART ROOM ALLOCATION ENGINE — Controllers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/admin/utsav/room-inventory?utsavid=<id>
 * Fetches all configured rooms for an event (including blocked rooms) for the Room Inventory dashboard.
 */
export const getRoomInventory = async (req, res) => {
  const { utsavid } = req.query;
  if (!utsavid) {
    throw new ApiError(400, 'utsavid query parameter is required');
  }

  const rooms = await UtsavRoomConfig.findAll({
    where: { utsavid: parseInt(utsavid, 10) },
    order: [
      ['is_inside_rc', 'DESC'],
      ['floor', 'ASC'],
      [Sequelize.literal('CAST(room_group AS UNSIGNED)'), 'ASC'],
      ['room_group', 'ASC']
    ],
    raw: true
  });

  // Enrich with default gender and roomtype from roomdb
  const allBeds = await RoomDb.findAll({ raw: true });
  const roomMetaMap = new Map();
  allBeds.forEach(b => {
    const m = String(b.roomno).match(/^(\d+)/);
    if (m && !roomMetaMap.has(m[1])) {
      roomMetaMap.set(m[1], { default_gender: b.gender, roomtype: b.roomtype });
    }
  });

  const enrichedRooms = rooms.map(r => {
    const meta = roomMetaMap.get(r.room_group) || {};
    return {
      ...r,
      default_gender: meta.default_gender || 'Any',
      roomtype: meta.roomtype || ''
    };
  });

  return res.status(200).json({
    success: true,
    data: enrichedRooms
  });
};

/**
 * POST /api/v1/admin/utsav/init-room-inventory
 * Initializes utsav_room_config for an event from roomdb.
 * Auto-proportions gender_override on RC rooms based on confirmed registration ratio.
 */
export const initRoomInventory = async (req, res) => {
  const { utsavid } = req.body;
  if (!utsavid) {
    throw new ApiError(400, 'utsavid is required in request body');
  }

  const result = await initializeEventRooms(parseInt(utsavid, 10));

  // Auto-proportion gender_override for RC rooms based on confirmed registrations
  try {
    // 1. Get confirmed/checkedin registration counts by gender using raw query
    const genderCounts = await database.query(
      `SELECT c.gender, COUNT(*) AS count
       FROM utsav_booking AS ub
       INNER JOIN card_db AS c ON ub.cardno = c.cardno
       WHERE ub.utsavid = :utsavid AND ub.status IN (:statuses)
       GROUP BY c.gender`,
      {
        replacements: {
          utsavid: parseInt(utsavid, 10),
          statuses: ['confirmed', 'cash_completed', 'checkedin']
        },
        type: QueryTypes.SELECT
      }
    );

    const maleCount = parseInt(genderCounts.find(g => g.gender === 'M')?.count || 0, 10);
    const femaleCount = parseInt(genderCounts.find(g => g.gender === 'F')?.count || 0, 10);
    const totalReg = maleCount + femaleCount;

    // 2. Fetch all active RC rooms for this utsav
    const rcRooms = await UtsavRoomConfig.findAll({
      where: { utsavid, is_inside_rc: 1, is_blocked: 0, avail_capacity: { [Sequelize.Op.gt]: 0 } },
      order: [['floor', 'ASC'], ['alloc_rank', 'ASC'], ['room_group', 'ASC']],
      raw: true
    });

    if (totalReg > 0 && rcRooms.length > 0) {
      // 3. Check pre-occupancy from pre-event room bookings and already-occupied rooms (gender_staying)
      const utsav = await UtsavDb.findOne({ where: { id: utsavid }, raw: true });
      const preOccupancyGenderMap = new Map();

      // Seed with already occupied rooms in this event
      rcRooms.forEach(r => {
        if (r.gender_staying) {
          preOccupancyGenderMap.set(r.room_group, r.gender_staying);
        }
      });

      if (utsav && utsav.start_date) {
        const preEventBookings = await RoomBooking.findAll({
          attributes: ['roomno', 'gender'],
          where: {
            checkin: { [Sequelize.Op.lt]: utsav.start_date },
            checkout: { [Sequelize.Op.gt]: utsav.start_date },
            status: { [Sequelize.Op.in]: ['checkedin', 'confirmed'] }
          },
          raw: true
        });

        preEventBookings.forEach(b => {
          if (b.roomno && b.gender) {
            const num = parseInt(b.roomno, 10);
            if (num >= 1 && num <= 60) {
              preOccupancyGenderMap.set(String(num), b.gender);
            }
          }
        });
      }

      // 4. Calculate target room counts
      const totalRooms = rcRooms.length;
      const targetMaleRooms = Math.round((maleCount / totalReg) * totalRooms);
      const targetFemaleRooms = totalRooms - targetMaleRooms;

      // 5. Assign gender_override — respect pre-occupancy first, then fill freely
      const lockedMale = rcRooms.filter(r => preOccupancyGenderMap.get(r.room_group) === 'M');
      const lockedFemale = rcRooms.filter(r => preOccupancyGenderMap.get(r.room_group) === 'F');
      const freeRooms = rcRooms.filter(r => !preOccupancyGenderMap.has(r.room_group));

      const maleRooms = [...lockedMale];
      const femaleRooms = [...lockedFemale];

      for (const room of freeRooms) {
        if (maleRooms.length < targetMaleRooms) {
          maleRooms.push(room);
        } else {
          femaleRooms.push(room);
        }
      }

      // 6. Write gender_override to utsav_room_config in parallel
      const updates = [
        ...maleRooms.map(r => ({ room_group: r.room_group, gender: 'M' })),
        ...femaleRooms.map(r => ({ room_group: r.room_group, gender: 'F' }))
      ];

      const updatePromises = [];
      for (const u of updates) {
        const existing = rcRooms.find(r => r.room_group === u.room_group);
        if (existing && existing.gender_override !== u.gender) {
          updatePromises.push(
            UtsavRoomConfig.update(
              { gender_override: u.gender },
              { where: { utsavid, room_group: u.room_group, is_inside_rc: 1 } }
            )
          );
        }
      }
      await Promise.all(updatePromises);
      const autoReassigned = updatePromises.length;

      req.log.info('init_room_inventory_gender_proportioned', {
        utsavid, maleCount, femaleCount, targetMaleRooms, targetFemaleRooms,
        lockedMale: lockedMale.length, lockedFemale: lockedFemale.length, autoReassigned
      });

      return res.status(200).json({
        success: true,
        message: `Initialized ${result.created} RC rooms (${result.total} total in RoomDB). ${result.skipped} already configured. Auto-proportioned gender: ${targetMaleRooms}M / ${targetFemaleRooms}F rooms (${autoReassigned} reassigned).`,
        data: {
          ...result,
          genderProportioning: {
            registrations: { male: maleCount, female: femaleCount },
            rooms: { targetMale: targetMaleRooms, targetFemale: targetFemaleRooms },
            maleRooms: maleRooms.map(r => r.room_group),
            femaleRooms: femaleRooms.map(r => r.room_group),
            autoReassigned
          }
        }
      });
    }
  } catch (propErr) {
    req.log.warn('gender_proportioning_failed', { error: propErr.message });
  }

  return res.status(200).json({
    success: true,
    message: `Initialized ${result.created} RC rooms (${result.total} total in RoomDB). ${result.skipped} already configured.`,
    data: result
  });
};

/**
 * POST /api/v1/admin/utsav/update-room-config
 * Inline admin edits: floor mats, blocked status, gender override, notes.
 * Updates are per-event only — roomdb is never touched.
 */
export const updateRoomConfig = async (req, res) => {
  const { utsavid, room_group, property, updates } = req.body;
  if (!utsavid || !room_group || !property) {
    throw new ApiError(400, 'utsavid, room_group, and property are required');
  }

  const allowed = ['addl_capacity', 'is_blocked', 'gender_override', 'notes', 'alloc_rank'];
  const safeUpdates = {};
  allowed.forEach(field => {
    if (updates[field] !== undefined) safeUpdates[field] = updates[field];
  });

  const room = await UtsavRoomConfig.findOne({ where: { utsavid, room_group, property } });
  if (room) {
    const isNowBlocked = safeUpdates.is_blocked !== undefined ? safeUpdates.is_blocked : room.is_blocked;
    const addl = safeUpdates.addl_capacity !== undefined ? safeUpdates.addl_capacity : room.addl_capacity;

    if (isNowBlocked) {
      safeUpdates.avail_capacity = 0;
    } else {
      const currentOccupied = Math.max(0, room.base_capacity - room.avail_capacity);
      safeUpdates.avail_capacity = Math.max(0, room.base_capacity + addl - currentOccupied);
    }
  }

  await UtsavRoomConfig.update(safeUpdates, { where: { utsavid, room_group, property } });

  return res.status(200).json({
    success: true,
    message: 'Room config updated for this event only'
  });
};

/**
 * POST /api/v1/admin/utsav/update-room-inventory-bulk
 * Bulk save all room configurations for an event (floor beds, gender overrides, blocked status, notes).
 */
export const updateRoomInventoryBulk = async (req, res) => {
  const { utsavid, rooms } = req.body;
  if (!utsavid || !Array.isArray(rooms)) {
    throw new ApiError(400, 'utsavid and rooms array are required');
  }

  const allowed = ['addl_capacity', 'is_blocked', 'gender_override', 'notes', 'alloc_rank'];

  for (const item of rooms) {
    const { room_group, property, updates } = item;
    if (!room_group || !property || !updates) continue;

    const safeUpdates = {};
    allowed.forEach(field => {
      if (updates[field] !== undefined) safeUpdates[field] = updates[field];
    });

    const room = await UtsavRoomConfig.findOne({ where: { utsavid, room_group, property } });
    if (room) {
      const isNowBlocked = safeUpdates.is_blocked !== undefined ? safeUpdates.is_blocked : room.is_blocked;
      const addl = safeUpdates.addl_capacity !== undefined ? safeUpdates.addl_capacity : room.addl_capacity;

      if (isNowBlocked) {
        safeUpdates.avail_capacity = 0;
      } else {
        const currentOccupied = Math.max(0, room.base_capacity - room.avail_capacity);
        safeUpdates.avail_capacity = Math.max(0, room.base_capacity + addl - currentOccupied);
      }
      await room.update(safeUpdates);
    }
  }

  return res.status(200).json({
    success: true,
    message: `Saved all ${rooms.length} room configurations`
  });
};

/**
 * POST /api/v1/admin/utsav/upload-external-rooms
 * Bulk upload external hotel rooms for an event via Excel/JSON payload.
 * Accepts JSON array from frontend (parsed from uploaded Excel).
 *
 * Each row: { room_group, property, floor, base_capacity, addl_capacity, gender_override, notes }
 */
export const uploadExternalRooms = async (req, res) => {
  const { utsavid, rooms } = req.body;
  if (!utsavid) throw new ApiError(400, 'utsavid is required');
  if (!Array.isArray(rooms) || !rooms.length) throw new ApiError(400, 'rooms array is required');

  req.log.info('upload_external_rooms_start', { utsavid, count: rooms.length });

  let created = 0;
  let updated = 0;

  for (const room of rooms) {
    if (!room.room_group || !room.property) continue;
    const base = parseInt(room.base_capacity, 10) || 1;
    const addl = parseInt(room.addl_capacity, 10) || 0;

    const [record, wasCreated] = await UtsavRoomConfig.findOrCreate({
      where: { utsavid, room_group: String(room.room_group), property: String(room.property) },
      defaults: {
        utsavid,
        room_group: String(room.room_group),
        property: String(room.property),
        is_inside_rc: 0,  // external
        floor: parseInt(room.floor, 10) || 0,
        base_capacity: base,
        addl_capacity: addl,
        avail_capacity: base + addl,
        is_blocked: 0,
        gender_override: room.gender_override || '',
        notes: room.notes || null
      }
    });

    if (wasCreated) {
      created++;
    } else {
      // Update existing row
      await record.update({
        floor: parseInt(room.floor, 10) || record.floor,
        base_capacity: base,
        addl_capacity: addl,
        avail_capacity: base + addl,
        gender_override: room.gender_override || record.gender_override,
        notes: room.notes !== undefined ? room.notes : record.notes
      });
      updated++;
    }
  }

  req.log.info('upload_external_rooms_done', { utsavid, created, updated });
  return res.status(200).json({
    success: true,
    message: `External rooms processed: ${created} added, ${updated} updated.`,
    data: { created, updated }
  });
};

/**
 * POST /api/v1/admin/utsav/run-smart-allocation
 * Dry-run the full allocation engine. Returns suggestions without persisting.
 * Frontend shows results for review before applying.
 */
export const runSmartAllocationController = async (req, res) => {
  const {
    utsavid,
    seniorAge = 65,
    splitDate = null
  } = req.body;

  if (!utsavid) throw new ApiError(400, 'utsavid is required');

  req.log.info('run_smart_allocation_start', { utsavid, seniorAge, splitDate });

  const utsav = await UtsavDb.findByPk(utsavid);
  if (!utsav) throw new ApiError(404, 'Utsav event not found');

  const statusToInclude = [STATUS_CONFIRMED, STATUS_CASH_COMPLETED, ROOM_STATUS_CHECKEDIN];

  // Fetch all confirmed participants
  const participants = await database.query(
    `SELECT 
      t1.bookingid, t1.cardno, t1.utsavid, t1.packageid, t1.roomno, t1.status,
      t1.other, t1.updatedBy,
      t2.issuedto AS name, t2.mobno, t2.gender, t2.center, t2.country,
      t2.res_status, t2.dob,
      TIMESTAMPDIFF(YEAR, t2.dob, CURDATE()) AS age,
      t4.name AS package_name,
      t4.start_date AS checkin, t4.end_date AS checkout
    FROM utsav_booking AS t1
    LEFT JOIN card_db AS t2 ON t1.cardno = t2.cardno
    LEFT JOIN utsav_packages_db AS t4 ON t1.packageid = t4.id AND t1.utsavid = t4.utsavid
    WHERE t1.utsavid = :utsavid AND t1.status IN (:status)
    ORDER BY t1.createdAt ASC`,
    {
      replacements: { utsavid, status: statusToInclude },
      type: QueryTypes.SELECT
    }
  );

  // 1. Fetch Flat Owners from flatdb
  const flats = await FlatDb.findAll({ raw: true });
  const flatOwnerMap = new Map(); // cardno -> flatno
  flats.forEach(f => {
    if (f.owner && f.flatno) {
      flatOwnerMap.set(String(f.owner).trim(), String(f.flatno).trim());
    }
  });

  // 2. Fetch Flat Host Forms & Submissions for this event
  const flatHostForms = await CustomForm.findAll({
    where: { event_id: utsavid, status: 'active' },
    raw: true
  });
  const flatHostFormIds = flatHostForms.map(f => f.id);

  const flatFormResponses = flatHostFormIds.length > 0 ? await CustomFormResponse.findAll({
    where: { form_id: { [Sequelize.Op.in]: flatHostFormIds } },
    raw: true
  }) : [];

  const formGuestMap = new Map(); // cardno / mobno -> flatno
  flatFormResponses.forEach(r => {
    const resp = r.responses || {};
    const flatno = resp.flatno;
    if (flatno) {
      if (r.cardno) formGuestMap.set(String(r.cardno).trim(), String(flatno).trim());
      if (Array.isArray(resp.guests_list)) {
        resp.guests_list.forEach(g => {
          if (g.cardno) formGuestMap.set(String(g.cardno).trim(), String(flatno).trim());
          if (g.mobno) formGuestMap.set(String(g.mobno).trim(), String(flatno).trim());
        });
      }
    }
  });

  // Build allCardnos early — needed for pre-event room lookup and later queries
  const allCardnos = participants.map(p => String(p.cardno).trim()).filter(Boolean);

  // 3. Pre/Post event room bookings for ALL participants (not just international)
  let prePostRoomMap = new Map(); // cardno -> { roomno, details }
  if (allCardnos.length > 0 && utsav.start_date && utsav.end_date) {
    const startDate = moment(utsav.start_date).format('YYYY-MM-DD');
    const endDate = moment(utsav.end_date).format('YYYY-MM-DD');
    const searchFromDate = moment(utsav.start_date).subtract(30, 'days').format('YYYY-MM-DD');
    const searchToDate = moment(utsav.end_date).add(30, 'days').format('YYYY-MM-DD');

    const generalRoomBookings = await RoomBooking.findAll({
      where: {
        cardno: { [Sequelize.Op.in]: allCardnos },
        status: { [Sequelize.Op.notIn]: ['cancelled', 'admin cancelled', 'waiting'] },
        roomno: { [Sequelize.Op.and]: [{ [Sequelize.Op.ne]: null }, { [Sequelize.Op.ne]: '' }, { [Sequelize.Op.ne]: 'NA' }, { [Sequelize.Op.ne]: '-' }] },
        checkin: { [Sequelize.Op.lte]: searchToDate },
        checkout: { [Sequelize.Op.gte]: searchFromDate }
      },
      raw: true,
      order: [['checkin', 'ASC']]
    });

    generalRoomBookings.forEach(rb => {
      const rawRoom = String(rb.roomno || '').trim();
      if (!rawRoom || rawRoom === 'NA' || rawRoom === '-' || rawRoom === 'null') return;

      const cin = moment(rb.checkin).format('YYYY-MM-DD');
      const cout = moment(rb.checkout).format('YYYY-MM-DD');
      const isPreEvent = cout >= startDate && cin <= startDate;
      const isPostEvent = cin <= endDate && cout >= endDate;
      const isOverlapping = (cin <= endDate && cout >= startDate);

      if (isPreEvent || isPostEvent || isOverlapping) {
        prePostRoomMap.set(String(rb.cardno).trim(), {
          roomno: rawRoom,
          checkin: cin,
          checkout: cout,
          type: isPreEvent && isPostEvent ? 'Pre & Post Event' : (isPreEvent ? 'Pre-Event' : (isPostEvent ? 'Post-Event' : 'Adjacent Stay'))
        });
      }
    });
  }

  // Fetch 2-year past Utsav stay history for all participants
  // (allCardnos is already defined above)
  const pastBookings = allCardnos.length ? await database.query(
    `SELECT 
      t1.cardno, t1.utsavid, t1.roomno, t1.status,
      t2.id AS event_id, t2.name AS event_name, t2.start_date, t2.end_date
    FROM utsav_booking AS t1
    INNER JOIN utsav_db AS t2 ON t1.utsavid = t2.id
    WHERE t1.cardno IN (:allCardnos) 
      AND t1.utsavid != :utsavid 
      AND t1.status IN ('confirmed', 'completed', 'cash_completed', 'checkedin')
    ORDER BY t2.start_date DESC`,
    {
      replacements: { allCardnos, utsavid },
      type: QueryTypes.SELECT
    }
  ) : [];

  const pastHistoryMap = new Map();
  pastBookings.forEach(pb => {
    const cno = String(pb.cardno).trim();
    if (!pastHistoryMap.has(cno)) pastHistoryMap.set(cno, []);

    const rawRoom = String(pb.roomno || '').trim();
    let type = 'UNALLOCATED';
    let label = '—';
    if (rawRoom && rawRoom !== 'null' && rawRoom !== '-') {
      const numMatch = rawRoom.match(/\d+/);
      const num = numMatch ? parseInt(numMatch[0], 10) : 0;
      const lower = rawRoom.toLowerCase();

      if (lower.includes('hotel') || lower.includes('leaf') || lower.includes('residency') || lower.includes('palace') || lower.includes('inn') || lower.includes('regal')) {
        type = 'EXTERNAL';
        label = rawRoom;
      } else if (num >= 1 && num <= 60) {
        type = 'RC';
        label = lower.startsWith('room') ? rawRoom : (rawRoom.includes('_') ? `Room ${rawRoom}` : `Room ${num}`);
      } else if (num >= 200 || lower.startsWith('flat')) {
        type = 'FLAT';
        label = lower.startsWith('flat') ? rawRoom : `Flat ${num}`;
      } else {
        // Room 61-199 or other external rooms
        type = 'EXTERNAL';
        label = lower.startsWith('room') ? rawRoom : `Room ${num}`;
      }
    }

    pastHistoryMap.get(cno).push({
      event_id: pb.event_id,
      event_name: pb.event_name,
      start_date: pb.start_date,
      roomno: label,
      location_type: type,
      status: pb.status
    });
  });

  // 5. Engagement Score — 4 queries reused from utsavParticipantHistoryReport
  const oneYearAgo = moment(utsav.start_date).subtract(1, 'year').format('YYYY-MM-DD');
  const utsavStartStr = moment(utsav.start_date).format('YYYY-MM-DD');
  const confirmedStatuses = ['confirmed', 'cash_completed', 'checkedin'];

  const [engStayDays, engSingleDay, engPgs, engNonPgs] = allCardnos.length ? await Promise.all([
    // A. RC stay nights in last 1 year
    database.query(
      `SELECT cardno, SUM(nights) AS stay_days FROM room_booking
       WHERE cardno IN (:allCardnos) AND status IN ('checkedin','checkedout')
         AND checkin >= :oneYearAgo AND checkin < :utsavStartStr
       GROUP BY cardno`,
      { replacements: { allCardnos, oneYearAgo, utsavStartStr }, type: QueryTypes.SELECT }
    ),
    // B. Single-day visits in last 1 year
    database.query(
      `SELECT cardno, COUNT(*) AS single_day_visits FROM room_booking
       WHERE cardno IN (:allCardnos) AND status IN ('pending checkin','checkedin','checkedout')
         AND (nights = 0 OR nights IS NULL)
         AND checkin >= :oneYearAgo AND checkin < :utsavStartStr
       GROUP BY cardno`,
      { replacements: { allCardnos, oneYearAgo, utsavStartStr }, type: QueryTypes.SELECT }
    ),
    // C. PGS attendance in last 1 year
    database.query(
      `SELECT sb.cardno, COUNT(DISTINCT s.id) AS pgs_count
       FROM shibir_booking_db AS sb
       INNER JOIN shibir_db AS s ON sb.shibir_id = s.id
       WHERE sb.cardno IN (:allCardnos) AND sb.status IN (:confirmedStatuses)
         AND s.name LIKE 'Param Gyaan Sabha%'
         AND s.start_date >= :oneYearAgo AND s.start_date < :utsavStartStr
       GROUP BY sb.cardno`,
      { replacements: { allCardnos, confirmedStatuses, oneYearAgo, utsavStartStr }, type: QueryTypes.SELECT }
    ),
    // D. Non-PGS adhyayan attendance in last 1 year
    database.query(
      `SELECT sb.cardno, COUNT(DISTINCT s.id) AS non_pgs_count
       FROM shibir_booking_db AS sb
       INNER JOIN shibir_db AS s ON sb.shibir_id = s.id
       LEFT JOIN shibir_attendance_records AS sar ON sb.bookingid = sar.bookingid AND sar.attended = 1
       LEFT JOIN shibir_attendance_db AS sa ON sb.bookingid = sa.bookingid
       WHERE sb.cardno IN (:allCardnos)
         AND s.name NOT LIKE 'Param Gyaan Sabha%'
         AND s.start_date >= :oneYearAgo AND s.start_date < :utsavStartStr
         AND (sar.id IS NOT NULL OR sa.session_1_attendance = 1 OR sa.session_2_attendance = 1
           OR sa.session_3_attendance = 1 OR sa.session_4_attendance = 1 OR sa.session_5_attendance = 1
           OR sa.session_6_attendance = 1 OR sa.session_7_attendance = 1 OR sa.session_8_attendance = 1
           OR sa.session_9_attendance = 1)
       GROUP BY sb.cardno`,
      { replacements: { allCardnos, oneYearAgo, utsavStartStr }, type: QueryTypes.SELECT }
    )
  ]) : [[], [], [], []];

  // Build engagementMap: cardno -> boolean (any threshold met)
  const engagementMap = new Map();
  const stayDaysMap = Object.fromEntries(engStayDays.map(r => [r.cardno, parseInt(r.stay_days, 10) || 0]));
  const singleDayMap = Object.fromEntries(engSingleDay.map(r => [r.cardno, parseInt(r.single_day_visits, 10) || 0]));
  const pgsMap = Object.fromEntries(engPgs.map(r => [r.cardno, parseInt(r.pgs_count, 10) || 0]));
  const nonPgsMap = Object.fromEntries(engNonPgs.map(r => [r.cardno, parseInt(r.non_pgs_count, 10) || 0]));
  allCardnos.forEach(cno => {
    const engaged = (stayDaysMap[cno] || 0) >= 18
      || (singleDayMap[cno] || 0) >= 10
      || (pgsMap[cno] || 0) >= 9
      || (nonPgsMap[cno] || 0) >= 6;
    if (engaged) engagementMap.set(cno, true);
  });

  const result = await runSmartAllocation({
    utsavid,
    participants,
    seniorAge,
    utsavStartDate: utsav.start_date,
    utsavEndDate: utsav.end_date,
    splitDate,
    fastTrackData: {
      flatOwnerMap,
      formGuestMap,
      prePostRoomMap
    },
    pastHistoryMap,
    engagementMap
  });

  req.log.info('run_smart_allocation_done', result.summary);

  // Compute gender room split from result.rooms (based on gender_override set during proportioning or gender_staying)
  const rcRoomsInResult = result.rooms.filter(r => r.is_inside_rc);
  const maleRCRooms = rcRoomsInResult.filter(r => (r.gender_override === 'M' || (!r.gender_override && r.gender_staying === 'M')));
  const femaleRCRooms = rcRoomsInResult.filter(r => (r.gender_override === 'F' || (!r.gender_override && r.gender_staying === 'F')));
  const maleReg = participants.filter(p => p.gender === 'M').length;
  const femaleReg = participants.filter(p => p.gender === 'F').length;

  return res.status(200).json({
    success: true,
    data: {
      utsav: {
        id: utsav.id,
        name: utsav.name,
        start_date: utsav.start_date,
        end_date: utsav.end_date
      },
      summary: result.summary,
      genderRoomSplit: {
        note: `Based on ${maleReg} male and ${femaleReg} female registrations (${Math.round(maleReg * 100 / (maleReg + femaleReg) || 0)}% M / ${Math.round(femaleReg * 100 / (maleReg + femaleReg) || 0)}% F), RC rooms were proportioned as follows:`,
        registrations: { male: maleReg, female: femaleReg, total: maleReg + femaleReg },
        rcRooms: {
          total: rcRoomsInResult.length,
          male: maleRCRooms.length,
          female: femaleRCRooms.length,
          maleRoomNumbers: maleRCRooms.map(r => r.room_group).sort((a, b) => parseInt(a) - parseInt(b)),
          femaleRoomNumbers: femaleRCRooms.map(r => r.room_group).sort((a, b) => parseInt(a) - parseInt(b))
        }
      },
      guests: result.guests.map(g => ({
        bookingid: g.bookingid,
        cardno: g.cardno,
        name: g.name,
        age: g.age,
        gender: g.gender,
        mobno: g.mobno,
        center: g.center,
        country: g.country,
        package_name: g.package_name,
        mumukshu_comments: g.other || '',
        current_roomno: g.roomno || '',
        suggested_roomno: g.bedLabel || g.allottedRoom || '',
        allotted_property: g.allottedProperty || '',
        isNRI: g.isNRI,
        isSenior: g.isSenior,
        needsGF: g.needsGF,
        isInsideRC: g.isInsideRC,
        isFullPkg: g.isFullPkg,
        isFastTracked: g.isFastTracked || false,
        fastTrackTag: g.fastTrackTag || '',
        allocated: g.allocated,
        reviewFlag: g.reviewFlag,
        unallocated_reason: g.unallocated_reason || '',
        past_history: pastHistoryMap.get(String(g.cardno).trim()) || []
      })),
      rooms: result.rooms
    }
  });
};

/**
 * GET /api/v1/admin/utsav/housekeeping-extra-beds-report?utsavid=...
 * Housekeeping Extra Beds & Mattresses Report:
 * 1. RC Rooms (Inside RC only: RC_OAG & RC_NAG) where addl_capacity > 0
 * 2. Resident Flats from Flat Host Form Responses where extra_beddings_count > 0
 */
export const getHousekeepingExtraBedsReport = async (req, res) => {
  const { utsavid } = req.query;
  if (!utsavid) {
    throw new ApiError(400, 'utsavid is required');
  }

  // 1. Fetch RC Rooms with extra floor beds (inside RC only)
  const rcRoomsRaw = await UtsavRoomConfig.findAll({
    where: {
      utsavid,
      is_inside_rc: 1,
      addl_capacity: { [Sequelize.Op.gt]: 0 }
    },
    order: [['property', 'ASC'], ['floor', 'ASC'], ['room_group', 'ASC']]
  });

  const rcRooms = rcRoomsRaw.map(r => ({
    id: r.id,
    room_group: r.room_group,
    property: r.property === 'RC_OAG' ? 'OAG' : (r.property === 'RC_NAG' ? 'NAG' : r.property),
    floor: r.floor === 0 ? 'GF' : 'FF',
    floor_num: r.floor,
    base_capacity: r.base_capacity,
    extra_beds: r.addl_capacity,
    total_capacity: r.base_capacity + r.addl_capacity,
    default_gender: r.default_gender,
    gender_override: r.gender_override,
    is_blocked: r.is_blocked,
    notes: r.notes || ''
  }));

  // 2. Fetch Flats requiring extra beddings from Flat Host forms
  const flatHostForms = await CustomForm.findAll({
    where: {
      event_id: utsavid,
      status: 'active'
    },
    attributes: ['id']
  });

  const formIds = flatHostForms.map(f => f.id);
  const flats = [];

  if (formIds.length > 0) {
    const flatResponses = await CustomFormResponse.findAll({
      where: {
        form_id: { [Sequelize.Op.in]: formIds }
      },
      order: [['submittedAt', 'DESC']]
    });

    const seenFlats = new Set();
    for (const resp of flatResponses) {
      const answers = resp.responses || {};
      const flatno = String(answers.flatno || '').trim();
      if (!flatno || seenFlats.has(flatno.toLowerCase())) continue;

      const extraBeddings = parseInt(answers.extra_beddings_count, 10) || 0;
      if (extraBeddings <= 0) continue;

      seenFlats.add(flatno.toLowerCase());

      let ownerName = 'Resident / Flat Owner';
      let mobno = '';
      if (resp.cardno) {
        const card = await CardDb.findOne({
          where: { cardno: resp.cardno },
          attributes: ['issuedto', 'mobno']
        });
        if (card) {
          ownerName = card.issuedto || ownerName;
          mobno = card.mobno ? String(card.mobno) : '';
        }
      }

      flats.push({
        id: resp.id,
        flatno,
        owner_name: ownerName,
        mobno,
        extra_beddings: extraBeddings,
        remarks: answers.remarks || '',
        submittedAt: resp.submittedAt
      });
    }
  }

  // Sort flats numerically / alphabetically
  flats.sort((a, b) => a.flatno.localeCompare(b.flatno, undefined, { numeric: true, sensitivity: 'base' }));

  const rcExtraBedsTotal = rcRooms.reduce((sum, r) => sum + r.extra_beds, 0);
  const flatsExtraBedsTotal = flats.reduce((sum, f) => sum + f.extra_beddings, 0);

  return res.status(200).json({
    success: true,
    data: {
      rc_rooms: rcRooms,
      flats,
      summary: {
        rc_rooms_count: rcRooms.length,
        rc_extra_beds: rcExtraBedsTotal,
        flats_count: flats.length,
        flats_extra_beds: flatsExtraBedsTotal,
        grand_total_extra_beds: rcExtraBedsTotal + flatsExtraBedsTotal
      }
    }
  });
};

/**
 * GET /api/v1/admin/utsav/uncheckedin-beds-report?utsavid=...
 * Returns all confirmed participants with allocated beds who have NOT checked in yet.
 * Also returns unallocated / waiting participants for easy re-allotment.
 */
/**
 * GET /api/v1/admin/utsav/uncheckedin-beds-report?utsavid=...
 * Returns all confirmed participants with allocated beds who have NOT checked in yet.
 * Also returns unallocated / waiting participants for easy re-allotment.
 */
/**
 * GET /api/v1/admin/utsav/uncheckedin-beds-report?utsavid=...
 * Returns all confirmed participants with allocated beds who have NOT checked in yet.
 * Also returns all other confirmed / checked-in participants of this Utsav for easy re-allotment.
 */
export const getUncheckedInBedsReport = async (req, res) => {
  const { utsavid } = req.query;
  if (!utsavid) {
    throw new ApiError(400, 'utsavid is required');
  }

  // 1. Fetch all bookings for this event with confirmed or checked-in status
  const allBookings = await UtsavBooking.findAll({
    where: {
      utsavid,
      status: {
        [Sequelize.Op.in]: ['confirmed', 'completed', 'cash_completed', 'checkedin']
      }
    },
    raw: true
  });

  const cardnos = [...new Set(allBookings.map(b => b.cardno).filter(Boolean))];
  const cards = await CardDb.findAll({
    where: { cardno: { [Sequelize.Op.in]: cardnos } },
    attributes: ['cardno', 'issuedto', 'mobno', 'gender', 'dob', 'center'],
    raw: true
  });
  const cardMap = new Map(cards.map(c => [c.cardno, c]));

  const packageIds = [...new Set(allBookings.map(b => b.packageid).filter(Boolean))];
  const packages = await UtsavPackagesDb.findAll({
    where: { id: { [Sequelize.Op.in]: packageIds } },
    attributes: ['id', 'name'],
    raw: true
  });
  const packageMap = new Map(packages.map(p => [p.id, p.name]));

  // 2. Separate into:
  // a) Unchecked-in with allocated beds (candidates for vacating / re-allotment)
  // b) All confirmed / checked-in participants for this Utsav (candidates for receiving the bed)
  const uncheckedInBeds = [];
  const candidates = [];

  for (const b of allBookings) {
    const card = cardMap.get(b.cardno) || {};
    const pkgName = packageMap.get(b.packageid) || 'Regular';
    const age = card.dob ? Math.floor((new Date() - new Date(card.dob)) / (365.25 * 24 * 3600 * 1000)) : null;
    const hasBed = Boolean(b.roomno && String(b.roomno).trim() !== '' && String(b.roomno).trim() !== 'null');
    const isUncheckedIn = b.status !== 'checkedin';

    if (hasBed && isUncheckedIn) {
      const roomStr = String(b.roomno).trim();
      let property = 'RC_OAG';
      let floor = 'GF';
      const numMatch = roomStr.match(/\d+/);
      const roomNum = numMatch ? parseInt(numMatch[0], 10) : 0;
      if (roomNum >= 1 && roomNum <= 18) {
        property = 'OAG';
        floor = 'GF';
      } else if (roomNum >= 19 && roomNum <= 36) {
        property = 'OAG';
        floor = 'FF';
      } else if (roomNum >= 37 && roomNum <= 48) {
        property = 'NAG';
        floor = 'GF';
      } else if (roomNum >= 49 && roomNum <= 60) {
        property = 'NAG';
        floor = 'FF';
      } else if (roomNum >= 200 || roomStr.toLowerCase().startsWith('flat')) {
        property = 'Flat';
        floor = '—';
      } else {
        property = 'External';
        floor = '—';
      }

      uncheckedInBeds.push({
        booking_id: b.bookingid,
        cardno: b.cardno,
        issuedto: card.issuedto || 'Member',
        mobno: card.mobno ? String(card.mobno) : '',
        gender: card.gender || 'M',
        age,
        center: card.center || '',
        roomno: normalizeRoomLabel(roomStr),
        property: property === 'RC_OAG' ? 'OAG' : (property === 'RC_NAG' ? 'NAG' : property),
        floor,
        package_name: pkgName,
        status: b.status,
        checkin_status: 'Not Checked-In',
        booked_at: b.createdAt
      });
    }

    candidates.push({
      booking_id: b.bookingid,
      cardno: b.cardno,
      issuedto: card.issuedto || 'Member',
      mobno: card.mobno ? String(card.mobno) : '',
      gender: card.gender || 'M',
      age,
      center: card.center || '',
      package_name: pkgName,
      status: b.status,
      current_room: b.roomno || null
    });
  }

  uncheckedInBeds.sort((a, b) => a.roomno.localeCompare(b.roomno, undefined, { numeric: true, sensitivity: 'base' }));
  candidates.sort((a, b) => (a.issuedto || '').localeCompare(b.issuedto || ''));

  const maleBeds = uncheckedInBeds.filter(b => b.gender === 'M').length;
  const femaleBeds = uncheckedInBeds.filter(b => b.gender === 'F').length;
  const oagBeds = uncheckedInBeds.filter(b => b.property === 'OAG').length;
  const nagBeds = uncheckedInBeds.filter(b => b.property === 'NAG').length;

  return res.status(200).json({
    success: true,
    data: {
      uncheckedin_beds: uncheckedInBeds,
      candidates,
      unallocated_guests: candidates.filter(c => !c.current_room),
      summary: {
        total_uncheckedin_beds: uncheckedInBeds.length,
        male_beds: maleBeds,
        female_beds: femaleBeds,
        oag_beds: oagBeds,
        nag_beds: nagBeds,
        total_confirmed_participants: candidates.length
      }
    }
  });
};

export const reallotBed = async (req, res) => {
  const { utsavid, from_booking_id, to_cardno, roomno, checkin_immediately } = req.body;
  if (!utsavid || !from_booking_id || !to_cardno || !roomno) {
    throw new ApiError(400, 'utsavid, from_booking_id, to_cardno, and roomno are required');
  }

  const cleanTargetCard = String(to_cardno).trim();
  const cleanRoom = String(roomno).trim();
  const nowStr = new Date().toLocaleString();
  const updatedBy = req.user?.username || 'admin';

  const t = await database.transaction();

  try {
    // 1. Fetch current occupant booking
    const fromBooking = await UtsavBooking.findOne({
      where: { bookingid: from_booking_id, utsavid },
      transaction: t
    });
    if (!fromBooking) {
      await t.rollback();
      throw new ApiError(404, 'Original booking not found');
    }

    // 2. Fetch new recipient booking for this event
    const toBooking = await UtsavBooking.findOne({
      where: {
        utsavid,
        cardno: cleanTargetCard,
        status: { [Sequelize.Op.in]: ['confirmed', 'completed', 'cash_completed', 'checkedin'] }
      },
      transaction: t
    });
    if (!toBooking) {
      await t.rollback();
      throw new ApiError(400, `Participant (${cleanTargetCard}) does not have a confirmed booking for this event`);
    }

    // 3. Check if recipient already has a room assigned
    if (toBooking.roomno && String(toBooking.roomno).trim() !== '' && String(toBooking.roomno).trim() !== 'null') {
      await t.rollback();
      throw new ApiError(400, `Recipient already has room ${toBooking.roomno} assigned. Please use bed swap instead, or clear their current room first.`);
    }

    // 4. Check no other booking already occupies this bed
    const existingOccupant = await UtsavBooking.findOne({
      where: {
        utsavid,
        roomno: cleanRoom,
        bookingid: { [Sequelize.Op.ne]: from_booking_id },
        status: { [Sequelize.Op.in]: ['confirmed', 'completed', 'cash_completed', 'checkedin'] }
      },
      transaction: t
    });
    if (existingOccupant) {
      await t.rollback();
      throw new ApiError(400, `Bed ${cleanRoom} is already occupied by another participant (${existingOccupant.cardno})`);
    }

    const fromCard = await CardDb.findOne({ where: { cardno: fromBooking.cardno }, attributes: ['issuedto'] });
    const toCard = await CardDb.findOne({ where: { cardno: cleanTargetCard }, attributes: ['issuedto'] });

    const fromName = fromCard?.issuedto || fromBooking.cardno;
    const toName = toCard?.issuedto || cleanTargetCard;

    // 5. Release bed from previous occupant
    await fromBooking.update({
      roomno: null,
      updatedBy,
      other: fromBooking.other
        ? `${fromBooking.other} | Bed ${cleanRoom} re-allotted to ${toName} on ${nowStr}`
        : `Bed ${cleanRoom} re-allotted to ${toName} on ${nowStr}`
    }, { transaction: t });

    // 6. Assign bed to new recipient (with audit trail)
    const targetUpdates = {
      roomno: cleanRoom,
      updatedBy,
      other: toBooking.other
        ? `${toBooking.other} | Received bed ${cleanRoom} (re-allotted from ${fromName}) on ${nowStr}`
        : `Received bed ${cleanRoom} (re-allotted from ${fromName}) on ${nowStr}`
    };
    if (checkin_immediately) {
      targetUpdates.status = 'checkedin';
    }

    await toBooking.update(targetUpdates, { transaction: t });

    await t.commit();

    return res.status(200).json({
      success: true,
      message: `Bed ${cleanRoom} successfully re-allotted from ${fromName} to ${toName}${checkin_immediately ? ' (Checked-In)' : ''}`
    });
  } catch (err) {
    if (!t.finished) await t.rollback();
    throw err;
  }
};
/**
 * GET /api/v1/admin/utsav/allotted-beds-report?utsavid=...
 * Returns all participants who have an allotted bed/room for this event (checked-in + not checked-in)
 * and a list of currently vacant beds for move/swap operations.
 */
export const getAllottedBedsReport = async (req, res) => {
  const { utsavid } = req.query;
  if (!utsavid) {
    throw new ApiError(400, 'utsavid is required');
  }

  // 1. Fetch all bookings with rooms
  const bookings = await UtsavBooking.findAll({
    where: {
      utsavid,
      status: {
        [Sequelize.Op.in]: ['confirmed', 'completed', 'cash_completed', 'checkedin']
      },
      roomno: {
        [Sequelize.Op.and]: [{ [Sequelize.Op.ne]: null }, { [Sequelize.Op.ne]: '' }]
      }
    },
    raw: true
  });

  const cardnos = [...new Set(bookings.map(b => b.cardno).filter(Boolean))];
  const cards = await CardDb.findAll({
    where: { cardno: { [Sequelize.Op.in]: cardnos } },
    attributes: ['cardno', 'issuedto', 'mobno', 'gender', 'dob', 'center'],
    raw: true
  });
  const cardMap = new Map(cards.map(c => [c.cardno, c]));

  const packageIds = [...new Set(bookings.map(b => b.packageid).filter(Boolean))];
  const packages = await UtsavPackagesDb.findAll({
    where: { id: { [Sequelize.Op.in]: packageIds } },
    attributes: ['id', 'name'],
    raw: true
  });
  const packageMap = new Map(packages.map(p => [p.id, p.name]));

  const allottedBeds = [];

  for (const b of bookings) {
    const card = cardMap.get(b.cardno) || {};
    const pkgName = packageMap.get(b.packageid) || 'Regular';
    const age = card.dob ? Math.floor((new Date() - new Date(card.dob)) / (365.25 * 24 * 3600 * 1000)) : null;

    const roomStr = String(b.roomno).trim();
    let property = 'RC_OAG';
    let floor = 'GF';
    const numMatch = roomStr.match(/\d+/);
    const roomNum = numMatch ? parseInt(numMatch[0], 10) : 0;
    if (roomNum >= 19 && roomNum <= 36) {
      property = 'RC_OAG';
      floor = 'FF';
    } else if (roomNum >= 37 && roomNum <= 48) {
      property = 'RC_NAG';
      floor = 'GF';
    } else if (roomNum >= 49 && roomNum <= 60) {
      property = 'RC_NAG';
      floor = 'FF';
    } else if (roomNum >= 1 && roomNum <= 18) {
      property = 'RC_OAG';
      floor = 'GF';
    } else if (roomStr.toLowerCase().includes('nag')) {
      property = 'RC_NAG';
    } else if (roomStr.toLowerCase().includes('flat')) {
      property = 'Flat';
    } else {
      property = 'External';
    }

    allottedBeds.push({
      booking_id: b.bookingid,
      cardno: b.cardno,
      issuedto: card.issuedto || 'Member',
      mobno: card.mobno ? String(card.mobno) : '',
      gender: card.gender || 'M',
      age,
      center: card.center || '',
      roomno: normalizeRoomLabel(roomStr),
      property: (roomNum >= 1 && roomNum <= 60) ? (roomNum >= 37 && roomNum <= 60 ? "RC_NAG" : "RC_OAG") : ((roomNum >= 200 || roomStr.toLowerCase().startsWith('flat')) ? "Flat" : "External"),
      floor,
      package_name: pkgName,
      status: b.status,
      is_checkedin: b.status === 'checkedin',
      booked_at: b.createdAt
    });
  }

  allottedBeds.sort((a, b) => a.roomno.localeCompare(b.roomno, undefined, { numeric: true, sensitivity: 'base' }));

  // 2. Fetch RC Rooms to find vacant bed slots
  const rcRoomConfigs = await UtsavRoomConfig.findAll({
    where: { utsavid, is_inside_rc: 1, is_blocked: 0 },
    raw: true
  });

  const occupiedBedSet = new Set(allottedBeds.map(b => b.roomno.toLowerCase().trim()));
  const vacantBeds = [];

  for (const rc of rcRoomConfigs) {
    const totalBeds = rc.base_capacity + (rc.addl_capacity || 0);
    const baseBedLetters = ['A', 'B', 'C', 'D', 'E', 'F'].slice(0, rc.base_capacity);
    const bedLabels = baseBedLetters.map(l => `Room ${rc.room_group}_${l}`);
    for (let f = 1; f <= (rc.addl_capacity || 0); f++) {
      bedLabels.push(f === 1 ? `Room ${rc.room_group}_FLOOR` : `Room ${rc.room_group}_FLOOR_${f}`);
    }

    const roomGender = rc.gender_override || rc.default_gender || 'M';

    for (const label of bedLabels) {
      if (!occupiedBedSet.has(label.toLowerCase().trim())) {
        vacantBeds.push({
          roomno: label,
          room_group: rc.room_group,
          property: rc.property === 'RC_OAG' ? 'OAG' : 'NAG',
          floor: rc.floor === 0 ? 'GF' : 'FF',
          gender: roomGender.startsWith('F') ? 'F' : 'M'
        });
      }
    }
  }

  const checkedinCount = allottedBeds.filter(b => b.is_checkedin).length;
  const uncheckedinCount = allottedBeds.filter(b => !b.is_checkedin).length;
  const maleBeds = allottedBeds.filter(b => b.gender === 'M').length;
  const femaleBeds = allottedBeds.filter(b => b.gender === 'F').length;

  return res.status(200).json({
    success: true,
    data: {
      allotted_beds: allottedBeds,
      vacant_beds: vacantBeds,
      summary: {
        total_allotted: allottedBeds.length,
        checkedin_count: checkedinCount,
        uncheckedin_count: uncheckedinCount,
        male_beds: maleBeds,
        female_beds: femaleBeds,
        vacant_beds_count: vacantBeds.length
      }
    }
  });
};

/**
 * POST /api/v1/admin/utsav/swap-beds
 * Handles both:
 * 1. Action 'swap': 2-way mutual swap between Person A and Person B.
 * 2. Action 'move': Moving Person A to an unoccupied / vacant bed.
 */
export const swapBeds = async (req, res) => {
  const { utsavid, action_type, person_a_booking_id, person_b_booking_id, target_roomno } = req.body;
  if (!utsavid || !person_a_booking_id) {
    throw new ApiError(400, 'utsavid and person_a_booking_id are required');
  }

  if (!action_type || !['swap', 'move'].includes(String(action_type).trim())) {
    throw new ApiError(400, 'Invalid action_type. Must be "swap" or "move"');
  }

  const updatedBy = req.user?.username || 'admin';
  const t = await database.transaction();

  try {
    const bookingA = await UtsavBooking.findOne({
      where: { bookingid: person_a_booking_id, utsavid },
      transaction: t
    });
    if (!bookingA) {
      await t.rollback();
      throw new ApiError(404, 'Booking for Person A not found');
    }

    const cardA = await CardDb.findOne({ where: { cardno: bookingA.cardno }, attributes: ['issuedto', 'gender'] });
    const nameA = cardA?.issuedto || bookingA.cardno;
    const genderA = cardA?.gender || 'M';
    const roomA = bookingA.roomno;

    if (action_type === 'swap') {
      if (!person_b_booking_id) {
        await t.rollback();
        throw new ApiError(400, 'person_b_booking_id is required for a mutual 2-way swap');
      }

      const bookingB = await UtsavBooking.findOne({
        where: { bookingid: person_b_booking_id, utsavid },
        transaction: t
      });
      if (!bookingB) {
        await t.rollback();
        throw new ApiError(404, 'Booking for Person B not found');
      }

      const cardB = await CardDb.findOne({ where: { cardno: bookingB.cardno }, attributes: ['issuedto', 'gender'] });
      const nameB = cardB?.issuedto || bookingB.cardno;
      const genderB = cardB?.gender || 'M';
      const roomB = bookingB.roomno;

      if (!roomA || !roomB) {
        await t.rollback();
        throw new ApiError(400, 'Both participants must currently have an allotted room to perform a mutual swap');
      }

      // Server-side gender validation
      if (genderA !== genderB) {
        await t.rollback();
        throw new ApiError(400, `Cannot swap beds between different genders (${nameA}: ${genderA}, ${nameB}: ${genderB})`);
      }

      const nowStr = new Date().toLocaleString();

      // Perform the mutual swap atomically
      await bookingA.update({
        roomno: roomB,
        updatedBy,
        other: bookingA.other
          ? `${bookingA.other} | Swapped bed from ${roomA} to ${roomB} with ${nameB} on ${nowStr}`
          : `Swapped bed with ${nameB} (${roomB}) on ${nowStr}`
      }, { transaction: t });

      await bookingB.update({
        roomno: roomA,
        updatedBy,
        other: bookingB.other
          ? `${bookingB.other} | Swapped bed from ${roomB} to ${roomA} with ${nameA} on ${nowStr}`
          : `Swapped bed with ${nameA} (${roomA}) on ${nowStr}`
      }, { transaction: t });

      await t.commit();

      return res.status(200).json({
        success: true,
        message: `Successfully swapped beds: ${nameA} is now in ${roomB}, and ${nameB} is now in ${roomA}`
      });

    } else if (action_type === 'move') {
      if (!target_roomno || !String(target_roomno).trim()) {
        await t.rollback();
        throw new ApiError(400, 'target_roomno is required to move participant');
      }

      const cleanTargetRoom = String(target_roomno).trim();
      const nowStr = new Date().toLocaleString();

      // Vacancy check: ensure no other confirmed booking already occupies this bed
      const existingOccupant = await UtsavBooking.findOne({
        where: {
          utsavid,
          roomno: cleanTargetRoom,
          bookingid: { [Sequelize.Op.ne]: person_a_booking_id },
          status: { [Sequelize.Op.in]: ['confirmed', 'completed', 'cash_completed', 'checkedin'] }
        },
        transaction: t
      });
      if (existingOccupant) {
        await t.rollback();
        throw new ApiError(400, `Bed ${cleanTargetRoom} is already occupied by another participant (${existingOccupant.cardno})`);
      }

      await bookingA.update({
        roomno: cleanTargetRoom,
        updatedBy,
        other: bookingA.other
          ? `${bookingA.other} | Moved bed from ${roomA || 'None'} to ${cleanTargetRoom} on ${nowStr}`
          : `Moved bed to ${cleanTargetRoom} on ${nowStr}`
      }, { transaction: t });

      await t.commit();

      return res.status(200).json({
        success: true,
        message: `Successfully moved ${nameA} to ${cleanTargetRoom}`
      });
    }
  } catch (err) {
    if (!t.finished) await t.rollback();
    throw err;
  }
};

/**
 * GET /api/v1/admin/utsav/participant-stay-history?cardno=...&utsavid=...
 * Returns full 2-year past Utsav room allocation and stay history for a participant.
 */
export const getParticipantStayHistory = async (req, res) => {
  const { cardno, utsavid } = req.query;
  if (!cardno) {
    throw new ApiError(400, 'cardno is required');
  }

  const cleanCard = String(cardno).trim();

  // 1. Fetch participant profile
  const card = await CardDb.findOne({
    where: { cardno: cleanCard },
    attributes: ['cardno', 'issuedto', 'gender', 'dob', 'center', 'mobno', 'res_status'],
    raw: true
  });

  if (!card) {
    throw new ApiError(404, 'Participant card not found');
  }

  const age = card.dob ? Math.floor((new Date() - new Date(card.dob)) / (365.25 * 24 * 3600 * 1000)) : null;

  // 2. Fetch all past utsav bookings
  const currentId = utsavid ? parseInt(utsavid, 10) : 0;

  const pastBookings = await database.query(
    `SELECT 
      t1.bookingid, t1.utsavid, t1.roomno, t1.status, t1.createdAt AS bookingDate,
      t2.id AS event_id, t2.name AS event_name, t2.start_date, t2.end_date, t2.location
    FROM utsav_booking AS t1
    INNER JOIN utsav_db AS t2 ON t1.utsavid = t2.id
    WHERE t1.cardno = :cleanCard 
      AND t1.utsavid != :currentId 
      AND t1.status IN ('confirmed', 'completed', 'cash_completed', 'checkedin')
    ORDER BY t2.start_date DESC, t1.createdAt DESC`,
    {
      replacements: { cleanCard, currentId },
      type: QueryTypes.SELECT
    }
  );

  let rcStaysCount = 0;
  let flatStaysCount = 0;
  let externalStaysCount = 0;
  let unallocatedCount = 0;
  let lastRcStay = null;

  const history = pastBookings.map(b => {
    const rawRoom = String(b.roomno || '').trim();
    let locationType = 'UNALLOCATED';
    let formattedRoom = '— (No Room)';

    if (rawRoom && rawRoom !== 'null' && rawRoom !== '-') {
      const numMatch = rawRoom.match(/\d+/);
      const num = numMatch ? parseInt(numMatch[0], 10) : 0;
      const lower = rawRoom.toLowerCase();

      if (lower.includes('hotel') || lower.includes('leaf') || lower.includes('residency') || lower.includes('palace') || lower.includes('inn') || lower.includes('regal')) {
        locationType = 'EXTERNAL';
        formattedRoom = rawRoom;
      } else if (num >= 1 && num <= 60) {
        locationType = 'RC';
        formattedRoom = lower.startsWith('room') ? rawRoom : (rawRoom.includes('_') ? `Room ${rawRoom}` : `Room ${num}`);
      } else if (num >= 200 || lower.startsWith('flat')) {
        locationType = 'FLAT';
        formattedRoom = lower.startsWith('flat') ? rawRoom : `Flat ${num}`;
      } else {
        // Room 101-199 or external room
        locationType = 'EXTERNAL';
        formattedRoom = lower.startsWith('room') ? rawRoom : `Room ${num}`;
      }
    }

    if (locationType === 'RC') {
      rcStaysCount++;
      if (!lastRcStay) {
        lastRcStay = {
          event_name: b.event_name,
          date: b.start_date,
          roomno: formattedRoom
        };
      }
    } else if (locationType === 'FLAT') {
      flatStaysCount++;
    } else if (locationType === 'EXTERNAL') {
      externalStaysCount++;
    } else {
      unallocatedCount++;
    }

    return {
      event_id: b.event_id,
      event_name: b.event_name,
      start_date: b.start_date,
      end_date: b.end_date,
      roomno: formattedRoom,
      location_type: locationType,
      status: b.status,
      booking_date: b.bookingDate
    };
  });

  return res.status(200).json({
    success: true,
    data: {
      participant: {
        cardno: card.cardno,
        name: card.issuedto,
        gender: card.gender,
        age,
        center: card.center || '',
        mobno: card.mobno ? String(card.mobno) : '',
        res_status: card.res_status || ''
      },
      summary: {
        total_past_events: history.length,
        rc_stays_count: rcStaysCount,
        flat_stays_count: flatStaysCount,
        external_stays_count: externalStaysCount,
        unallocated_count: unallocatedCount,
        last_rc_stay: lastRcStay
      },
      history
    }
  });
};

/**
 * Audit Utsav confirmed participants against WhatsApp Group shortlink clicks
 */
export const utsavGroupAudit = async (req, res) => {
  const { utsav_id } = req.query;
  if (!utsav_id) {
    return res.status(400).send({ message: 'utsav_id is required' });
  }

  const utsav = await UtsavDb.findByPk(utsav_id);
  if (!utsav) {
    return res.status(404).send({ message: 'Utsav not found' });
  }

  const slug = `u${utsav_id}`;
  const shortlink = await ShortLink.findOne({ where: { slug } });

  const bookings = await UtsavBooking.findAll({
    where: {
      utsavid: utsav_id,
      status: [STATUS_CONFIRMED, STATUS_CASH_COMPLETED, ROOM_STATUS_CHECKEDIN]
    },
    include: [{
      model: CardDb,
      attributes: ['issuedto', 'mobno', 'country', 'cardno', 'center', 'res_status']
    }]
  });

  const participants = bookings.map(b => {
    const card = b.CardDb || {};
    return {
      bookingid: b.bookingid,
      cardno: card.cardno,
      issuedto: card.issuedto || 'Unknown',
      mobno: card.mobno,
      center: card.center,
      res_status: card.res_status
    };
  });

  return res.status(200).send({
    message: 'Group audit fetched successfully',
    data: {
      utsav_name: utsav.name,
      slug,
      whatsapp_link: utsav.whatsapp_link,
      shortlink_active: !!shortlink,
      total_confirmed: participants.length,
      participants
    }
  });
};

/**
 * Send manual / automated group join reminder WhatsApp message
 */
export const sendUtsavGroupReminder = async (req, res) => {
  const { utsav_id, phone, cardno } = req.body;
  if (!utsav_id) {
    return res.status(400).send({ message: 'utsav_id is required' });
  }

  const utsav = await UtsavDb.findByPk(utsav_id);
  if (!utsav) {
    return res.status(404).send({ message: 'Utsav not found' });
  }

  const slug = `u${utsav_id}`;
  const { sendGroupJoinReminderWhatsApp } = await import('../../helpers/whatsapp.helper.js');

  if (phone) {
    const card = await CardDb.findOne({ where: { mobno: phone } }).catch(() => null);
    const name = card?.issuedto || 'Mumukshu';
    const result = await sendGroupJoinReminderWhatsApp(phone, name, utsav.name, slug);
    return res.status(200).send({ message: 'Reminder sent', result });
  }

  // Send to all confirmed participants
  const bookings = await UtsavBooking.findAll({
    where: {
      utsavid: utsav_id,
      status: [STATUS_CONFIRMED, STATUS_CASH_COMPLETED, ROOM_STATUS_CHECKEDIN]
    },
    include: [{ model: CardDb }]
  });

  // Reconcile members to find only missing participants
  let missingBookings = bookings;
  if (utsav.whatsapp_group_jid) {
    try {
      const { fetchGroupReconciliationInternal } = await import('./waManagement.controller.js');
      const reconData = await fetchGroupReconciliationInternal(utsav.whatsapp_group_jid, 'utsav', utsav.id);
      if (reconData && reconData.missing) {
        const missingCardNos = new Set(reconData.missing.map(m => String(m.cardno)));
        missingBookings = bookings.filter(b => b.CardDb && missingCardNos.has(String(b.CardDb.cardno)));
      }
    } catch (auditErr) {
      console.error('[Batch Reminder] Group reconciliation failed, sending to all bookings:', auditErr.message);
    }
  }

  let sentCount = 0;
  for (const b of missingBookings) {
    if (b.CardDb && b.CardDb.mobno) {
      await sendGroupJoinReminderWhatsApp(b.CardDb.mobno, b.CardDb.issuedto, utsav.name, slug);
      sentCount++;
    }
  }

  return res.status(200).send({
    message: `Reminder batch dispatched to ${sentCount} un-joined participants`
  });
};

export const utsavParticipantHistoryReport = async (req, res) => {
  try {
    const { utsavid, tag, search, format, page, page_size, sort_by, sort_order, devotee_type, package_name } = req.query;
    req.log.info('utsav_participant_history_report_start', { utsavid, tag, search, format, devotee_type, package_name });

    if (!utsavid) {
      req.log.warn('utsav_participant_history_report_missing_utsavid');
      return res.status(400).send({ message: 'utsavid is required' });
    }

    // 1. Fetch Utsav Start Date
    const utsav = await UtsavDb.findOne({
      where: { id: utsavid },
      attributes: ['id', 'name', 'start_date', 'end_date']
    });

    if (!utsav) {
      return res.status(404).send({ message: 'Utsav not found' });
    }

    const utsavStart = moment(utsav.start_date).format('YYYY-MM-DD');
    const oneYearAgo = moment(utsav.start_date).subtract(1, 'year').format('YYYY-MM-DD');

    // 2. Fetch Confirmed Participants for this Utsav with Package details
    const confirmedStatuses = [STATUS_CONFIRMED, STATUS_CASH_COMPLETED, ROOM_STATUS_CHECKEDIN];

    const participants = await database.query(
      `SELECT 
        ub.bookingid, ub.utsavid, ub.status AS booking_status, ub.roomno, ub.packageid,
        pkg.name AS package_name,
        c.cardno, c.issuedto, c.mobno, c.gender, c.center, c.dob, c.res_status, c.country,
        TIMESTAMPDIFF(YEAR, c.dob, CURDATE()) AS age,
        (CASE WHEN f.owner IS NOT NULL THEN 1 ELSE 0 END) AS is_flat_owner
       FROM utsav_booking AS ub
       INNER JOIN card_db AS c ON ub.cardno = c.cardno
       LEFT JOIN utsav_packages_db AS pkg ON ub.packageid = pkg.id AND ub.utsavid = pkg.utsavid
       LEFT JOIN flatdb AS f ON c.cardno = f.owner
       WHERE ub.utsavid = :utsavid AND ub.status IN (:statuses)`,
      {
        replacements: {
          utsavid,
          statuses: confirmedStatuses
        },
        type: QueryTypes.SELECT
      }
    );

    if (!participants || participants.length === 0) {
      if (format === 'excel') {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet([]);
        XLSX.utils.book_append_sheet(wb, ws, 'Participant History');
        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Utsav_Participant_History_${utsavid}.xlsx`);
        return res.send(buf);
      }

      return res.status(200).send({
        message: 'No confirmed participants found for this Utsav',
        data: [],
        meta: { utsav_name: utsav.name, start_date: utsav.start_date, total_count: 0, package_breakdown: {} }
      });
    }

    const cardNos = participants.map((p) => p.cardno);

    // Compute Package-wise count breakdown
    const packageBreakdown = {};
    participants.forEach((p) => {
      const pkgName = p.package_name || 'Unassigned / Default';
      packageBreakdown[pkgName] = (packageBreakdown[pkgName] || 0) + 1;
    });

    // 3. Perform 1-Year History Aggregations for registered participants

    // (A) Sharan RC Stay Days (room_booking checkin in [oneYearAgo, utsavStart), status IN ('checkedin', 'checkedout'))
    const stayStatuses = [ROOM_STATUS_CHECKEDIN, ROOM_STATUS_CHECKEDOUT];
    const stayDaysResults = await database.query(
      `SELECT cardno, SUM(nights) AS stay_days
       FROM room_booking
       WHERE cardno IN (:cardNos)
         AND status IN (:stayStatuses)
         AND checkin >= :oneYearAgo
         AND checkin < :utsavStart
       GROUP BY cardno`,
      {
        replacements: { cardNos, stayStatuses, oneYearAgo, utsavStart },
        type: QueryTypes.SELECT
      }
    );
    const stayDaysMap = {};
    stayDaysResults.forEach((row) => {
      stayDaysMap[row.cardno] = parseInt(row.stay_days, 10) || 0;
    });

    // (A2) Single Day Visits (nights = 0, status IN ('pending checkin', 'checkedin', 'checkedout'))
    const singleDayStatuses = [
      ROOM_STATUS_PENDING_CHECKIN,
      ROOM_STATUS_CHECKEDIN,
      ROOM_STATUS_CHECKEDOUT
    ];
    const singleDayResults = await database.query(
      `SELECT cardno, COUNT(*) AS single_day_visits
       FROM room_booking
       WHERE cardno IN (:cardNos)
         AND status IN (:singleDayStatuses)
         AND (nights = 0 OR nights IS NULL)
         AND checkin >= :oneYearAgo
         AND checkin < :utsavStart
       GROUP BY cardno`,
      {
        replacements: { cardNos, singleDayStatuses, oneYearAgo, utsavStart },
        type: QueryTypes.SELECT
      }
    );
    const singleDayMap = {};
    singleDayResults.forEach((row) => {
      singleDayMap[row.cardno] = parseInt(row.single_day_visits, 10) || 0;
    });

    // (B) Param Gyaan Sabha (PGS) Adhyayans (shibir_booking_db status IN ('confirmed', 'cash completed', 'checkedin'), shibir_db name LIKE 'Param Gyaan Sabha%')
    const pgsStatuses = [
      STATUS_CONFIRMED,
      STATUS_CASH_COMPLETED,
      ROOM_STATUS_CHECKEDIN
    ];
    const pgsResults = await database.query(
      `SELECT sb.cardno, COUNT(DISTINCT s.id) AS pgs_count
       FROM shibir_booking_db AS sb
       INNER JOIN shibir_db AS s ON sb.shibir_id = s.id
       WHERE sb.cardno IN (:cardNos)
         AND sb.status IN (:pgsStatuses)
         AND s.name LIKE 'Param Gyaan Sabha%'
         AND s.start_date >= :oneYearAgo
         AND s.start_date < :utsavStart
       GROUP BY sb.cardno`,
      {
        replacements: { cardNos, pgsStatuses, oneYearAgo, utsavStart },
        type: QueryTypes.SELECT
      }
    );
    const pgsMap = {};
    pgsResults.forEach((row) => {
      pgsMap[row.cardno] = parseInt(row.pgs_count, 10) || 0;
    });

    // (C) Non-Param Gyaan Sabha Adhyayans (Attendance record exists in shibir_attendance_records OR shibir_attendance_db)
    const nonPgsResults = await database.query(
      `SELECT sb.cardno, COUNT(DISTINCT s.id) AS non_pgs_count
       FROM shibir_booking_db AS sb
       INNER JOIN shibir_db AS s ON sb.shibir_id = s.id
       LEFT JOIN shibir_attendance_records AS sar 
         ON sb.bookingid = sar.bookingid AND sar.attended = 1
       LEFT JOIN shibir_attendance_db AS sa 
         ON sb.bookingid = sa.bookingid
       WHERE sb.cardno IN (:cardNos)
         AND s.name NOT LIKE 'Param Gyaan Sabha%'
         AND s.start_date >= :oneYearAgo
         AND s.start_date < :utsavStart
         AND (
           sar.id IS NOT NULL 
           OR sa.session_1_attendance = 1 OR sa.session_2_attendance = 1 OR sa.session_3_attendance = 1 
           OR sa.session_4_attendance = 1 OR sa.session_5_attendance = 1 OR sa.session_6_attendance = 1 
           OR sa.session_7_attendance = 1 OR sa.session_8_attendance = 1 OR sa.session_9_attendance = 1
         )
       GROUP BY sb.cardno`,
      {
        replacements: { cardNos, oneYearAgo, utsavStart },
        type: QueryTypes.SELECT
      }
    );
    const nonPgsMap = {};
    nonPgsResults.forEach((row) => {
      nonPgsMap[row.cardno] = parseInt(row.non_pgs_count, 10) || 0;
    });

    // (D) Past Utsavs Attended (status IN ('confirmed', 'cash completed', 'checkedin'), utsavid != current, utsav_db start_date < utsavStart)
    const pastUtsavStatuses = [
      STATUS_CONFIRMED,
      STATUS_CASH_COMPLETED,
      ROOM_STATUS_CHECKEDIN
    ];
    const utsavAttendedResults = await database.query(
      `SELECT ub.cardno, COUNT(DISTINCT u.id) AS utsav_count
       FROM utsav_booking AS ub
       INNER JOIN utsav_db AS u ON ub.utsavid = u.id
       WHERE ub.cardno IN (:cardNos)
         AND ub.status IN (:pastUtsavStatuses)
         AND ub.utsavid != :currentUtsavid
         AND u.start_date < :utsavStart
       GROUP BY ub.cardno`,
      {
        replacements: { cardNos, pastUtsavStatuses, currentUtsavid: utsavid, utsavStart },
        type: QueryTypes.SELECT
      }
    );
    const utsavAttendedMap = {};
    utsavAttendedResults.forEach((row) => {
      utsavAttendedMap[row.cardno] = parseInt(row.utsav_count, 10) || 0;
    });

    // (E) Total Events Held Counts
    const [[totalPgsResult], [totalNonPgsResult], [totalPastUtsavsResult]] = await Promise.all([
      database.query(
        `SELECT COUNT(*) AS count FROM shibir_db
         WHERE name LIKE 'Param Gyaan Sabha%'
           AND start_date >= :oneYearAgo AND start_date < :utsavStart`,
        { replacements: { oneYearAgo, utsavStart }, type: QueryTypes.SELECT }
      ),
      database.query(
        `SELECT COUNT(*) AS count FROM shibir_db
         WHERE name NOT LIKE 'Param Gyaan Sabha%'
           AND start_date >= :oneYearAgo AND start_date < :utsavStart`,
        { replacements: { oneYearAgo, utsavStart }, type: QueryTypes.SELECT }
      ),
      database.query(
        `SELECT COUNT(*) AS count FROM utsav_db
         WHERE id != :currentUtsavid AND start_date < :utsavStart`,
        { replacements: { currentUtsavid: utsavid, utsavStart }, type: QueryTypes.SELECT }
      )
    ]);

    const totalPgsInYear = parseInt(totalPgsResult?.count, 10) || 0;
    const totalNonPgsInYear = parseInt(totalNonPgsResult?.count, 10) || 0;
    const totalPastUtsavsAllTime = parseInt(totalPastUtsavsResult?.count, 10) || 0;

    // 4. Combine Participant Profile + 1-Yr History + Engagement Tags
    let reportData = participants.map((p) => {
      const stay_days = stayDaysMap[p.cardno] || 0;
      const single_day_visits = singleDayMap[p.cardno] || 0;
      const pgs_adhyayan_count = pgsMap[p.cardno] || 0;
      const non_pgs_adhyayan_count = nonPgsMap[p.cardno] || 0;
      const total_adhyayan_count = pgs_adhyayan_count + non_pgs_adhyayan_count;
      const utsav_count = utsavAttendedMap[p.cardno] || 0;

      const tags = [];
      if (utsav_count === 0) tags.push('first_timer');
      if (stay_days >= 30) tags.push('regular_stay');
      if (pgs_adhyayan_count >= 5) tags.push('pgs_regular');
      if (total_adhyayan_count >= 5) tags.push('active_adhyayan');
      if (stay_days >= 15 || total_adhyayan_count >= 5 || utsav_count >= 2) tags.push('frequent_visitor');

      return {
        bookingid: p.bookingid,
        utsavid: p.utsavid,
        cardno: p.cardno,
        issuedto: p.issuedto,
        mobno: p.mobno,
        gender: p.gender,
        center: p.center,
        dob: p.dob,
        age: p.age ? parseInt(p.age, 10) : null,
        res_status: p.res_status,
        country: p.country || 'India',
        is_nri: Boolean(p.country && p.country.trim() !== '' && p.country.trim().toLowerCase() !== 'india'),
        is_flat_owner: Boolean(p.is_flat_owner),
        booking_status: p.booking_status,
        roomno: p.roomno,
        packageid: p.packageid,
        package_name: p.package_name || 'Unassigned / Default',
        history_1yr: {
          stay_days,
          single_day_visits,
          pgs_adhyayan_count,
          non_pgs_adhyayan_count,
          total_adhyayan_count,
          utsav_count
        },
        tags
      };
    });

    // Default Sort: Highest RC Stay Days first
    reportData.sort((a, b) => b.history_1yr.stay_days - a.history_1yr.stay_days);

    // 5. Apply Tag Filter
    if (tag) {
      const targetTag = tag.trim().toLowerCase();
      reportData = reportData.filter((item) => item.tags.includes(targetTag));
    }

    // 6. Apply Devotee Type Filter (PR, Flat Owner, NRI exclusions)
    if (devotee_type) {
      const dType = devotee_type.trim().toLowerCase();
      if (dType === 'exclude_pr') {
        reportData = reportData.filter((item) => item.res_status !== 'PR');
      } else if (dType === 'exclude_flat_owner') {
        reportData = reportData.filter((item) => !item.is_flat_owner);
      } else if (dType === 'exclude_nri') {
        reportData = reportData.filter((item) => !item.is_nri);
      } else if (dType === 'exclude_both') {
        reportData = reportData.filter((item) => item.res_status !== 'PR' && !item.is_flat_owner);
      } else if (dType === 'exclude_all') {
        reportData = reportData.filter((item) => item.res_status !== 'PR' && !item.is_flat_owner && !item.is_nri);
      }
    }

    // 7. Apply Package Filter
    if (package_name) {
      const pName = package_name.trim();
      reportData = reportData.filter((item) => item.package_name === pName);
    }

    // 8. Apply Search Filter
    if (search) {
      const term = search.trim().toLowerCase();
      reportData = reportData.filter((item) => {
        return (
          (item.issuedto && item.issuedto.toLowerCase().includes(term)) ||
          (item.cardno && String(item.cardno).toLowerCase().includes(term)) ||
          (item.mobno && String(item.mobno).toLowerCase().includes(term)) ||
          (item.center && String(item.center).toLowerCase().includes(term)) ||
          (item.country && String(item.country).toLowerCase().includes(term)) ||
          (item.package_name && String(item.package_name).toLowerCase().includes(term))
        );
      });
    }

    // 9. Apply Sorting (if explicitly specified)
    if (sort_by) {
      const field = sort_by.trim();
      const order = (sort_order || 'asc').toLowerCase() === 'desc' ? -1 : 1;

      reportData.sort((a, b) => {
        let valA, valB;
        if (field === 'stay_days') {
          valA = a.history_1yr.stay_days;
          valB = b.history_1yr.stay_days;
        } else if (field === 'single_day_visits') {
          valA = a.history_1yr.single_day_visits;
          valB = b.history_1yr.single_day_visits;
        } else if (field === 'pgs_adhyayan_count') {
          valA = a.history_1yr.pgs_adhyayan_count;
          valB = b.history_1yr.pgs_adhyayan_count;
        } else if (field === 'non_pgs_adhyayan_count') {
          valA = a.history_1yr.non_pgs_adhyayan_count;
          valB = b.history_1yr.non_pgs_adhyayan_count;
        } else if (field === 'utsav_count') {
          valA = a.history_1yr.utsav_count;
          valB = b.history_1yr.utsav_count;
        } else if (field === 'issuedto') {
          valA = a.issuedto || '';
          valB = b.issuedto || '';
        } else {
          valA = a[field] || '';
          valB = b[field] || '';
        }

        if (valA < valB) return -1 * order;
        if (valA > valB) return 1 * order;
        return 0;
      });
    }

    // 10. Excel Export Handler
    if (format === 'excel') {
      const excelRows = reportData.map((item) => ({
        'Card No': item.cardno,
        'Name': item.issuedto,
        'Package Name': item.package_name,
        'Mobile No': item.mobno,
        'Gender': item.gender,
        'Age': item.age || '',
        'Center': item.center,
        'Country': item.country || 'India',
        'Booking Status': item.booking_status,
        'Room No': item.roomno || '',
        'RC Stay Days (1Yr)': item.history_1yr.stay_days,
        '1-Day Visits (1Yr)': item.history_1yr.single_day_visits,
        [`PGS (Attended / ${totalPgsInYear} in 1Yr)`]: item.history_1yr.pgs_adhyayan_count,
        [`Adhyayans (Attended / ${totalNonPgsInYear} in 1Yr)`]: item.history_1yr.non_pgs_adhyayan_count,
        [`Past Utsavs (Attended / ${totalPastUtsavsAllTime} All-Time)`]: item.history_1yr.utsav_count,
        'Engagement Tags': item.tags.join(', ')
      }));

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(excelRows);

      ws['!cols'] = [
        { wch: 15 },
        { wch: 25 },
        { wch: 25 }, // Package Name
        { wch: 15 },
        { wch: 10 },
        { wch: 8 },
        { wch: 20 },
        { wch: 15 }, // Country
        { wch: 18 },
        { wch: 12 },
        { wch: 20 },
        { wch: 22 },
        { wch: 28 },
        { wch: 30 },
        { wch: 30 },
        { wch: 30 }
      ];

      XLSX.utils.book_append_sheet(wb, ws, 'Participant History');

      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=Utsav_Participant_History_${utsavid}.xlsx`
      );
      return res.send(buf);
    }

    // 11. Handle Pagination
    const totalCount = reportData.length;
    let paginatedData = reportData;

    if (page && page_size) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limit = Math.max(1, parseInt(page_size, 10) || 10);
      const offset = (pageNum - 1) * limit;
      paginatedData = reportData.slice(offset, offset + limit);
    }

    req.log.info('utsav_participant_history_report_success', { utsavid, count: totalCount });

    return res.status(200).send({
      message: 'Fetched Utsav participant history report successfully',
      data: paginatedData,
      meta: {
        utsav_id: utsav.id,
        utsav_name: utsav.name,
        utsav_start_date: utsav.start_date,
        one_year_ago_date: oneYearAgo,
        total_participants: totalCount,
        package_breakdown: packageBreakdown,
        event_totals: {
          total_pgs_in_year: totalPgsInYear,
          total_non_pgs_in_year: totalNonPgsInYear,
          total_past_utsavs_all_time: totalPastUtsavsAllTime
        },
        page: page ? Math.max(1, parseInt(page, 10) || 1) : 1,
        page_size: page_size ? Math.max(1, parseInt(page_size, 10) || 10) : totalCount
      }
    });
  } catch (err) {
    req.log.error('utsav_participant_history_report_error', { error: err.message });
    return res.status(500).send({
      message: 'Server error generating participant history report',
      error: err.message
    });
  }
};
