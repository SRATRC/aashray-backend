import {
  UtsavDb,
  UtsavPackagesDb,
  UtsavBooking,
  CardDb
} from '../../models/associations.js';
import BlockDates from '../../models/block_dates.model.js';
import {
  validateUtsavBooking,
  reserveUtsavSeat,
  openUtsavSeat,
  validateUtsavPackage,
  bookUtsavForMumukshus,
  bookUtsavForMumukshusAdmin
} from '../../helpers/utsavBooking.helper.js';
import { sendUtsavBookingUpdateEmail } from '../../helpers/utsavBooking.helper.js';
import Sequelize, { QueryTypes } from 'sequelize';
import {
  adminCancelTransaction,
  createPendingTransaction
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
  STATUS_PAYMENT_COMPLETED
} from '../../config/constants.js';
import { validateCard } from '../../helpers/card.helper.js';
import Transactions from '../../models/transactions.model.js';
import database from '../../config/database.js';
import moment from 'moment';
import ApiError from '../../utils/ApiError.js';
import XLSX from 'xlsx';
import { sendWhatsAppMessage } from "../../utils/sendWhatsAppMessage.js";
import { sendUtsavStatusChangeWhatsApp } from '../../helpers/whatsapp.helper.js';

export const createUtsavBookingByAdmin = async (req, res) => {
  const { utsavid, mumukshus } = req.body;

  // Validation
  if (!utsavid || !Array.isArray(mumukshus) || mumukshus.length === 0) {
    return res.status(400).send({ 
      message: "utsavid and mumukshus are required" 
    });
  }

  for (const m of mumukshus) {
    if (!m?.cardno || !m?.packageid) {
      return res.status(400).send({ 
        message: "Each mumukshu must include cardno and packageid" 
      });
    }
  }

  // Start transaction
  const t = await database.transaction();
  req.transaction = t;

  try {
    // Create bookings
    const result = await bookUtsavForMumukshusAdmin(utsavid, mumukshus, t, req.user);
    
    // Commit transaction
    await t.commit();
    
    console.log("✅ Transaction committed successfully");
    console.log("📦 Booking result:", result);

    // Send notifications AFTER successful commit (with separate error handling)
    for (const cardno in result.userBookingIds) {
      const bookingIds = result.userBookingIds[cardno];

      for (const id of bookingIds) {
        console.log(`\n📋 Processing booking: ${id}`);

        // Fetch booking and card details
        const booking = await UtsavBooking.findOne({ 
          where: { bookingid: id } 
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
          const phone = card.mobno;

          if (!phone) {
            console.warn(`⚠️ No phone number for booking: ${id}`);
            continue;
          }

          // Clean and format phone number
          const cleanPhone = String(phone).replace(/\D/g, '');
          const formattedPhone = cleanPhone.startsWith('91') 
            ? cleanPhone 
            : `91${cleanPhone}`;

          console.log(`📞 Sending WhatsApp to: ${formattedPhone}`);

          // Get utsav details for the message
          const utsav = await UtsavDb.findOne({ 
            where: { id: booking.utsavid } 
          });

          await sendWhatsAppMessage(
            formattedPhone,
            "room_allocation_2025",
            [
              card.issuedto || "Mumukshu",
              booking.roomno || "Not Assigned",
              utsav?.start_date || "TBD"
            ]
          );
  
          console.log(`✅ WhatsApp sent successfully for booking: ${id}`);
        } catch (err) {
    console.error(`❌ WhatsApp failed for ${phone}`);
    console.error("Status:", err.response?.status);
    console.error("Data:", JSON.stringify(err.response?.data, null, 2));
    console.error("Message:", err.message);
    throw err;
  }
      }
    }

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

export const createUtsav = async (req, res) => {
  const {
    name,
    start_date,
    end_date,
    total_seats,
    location,
    registration_deadline
  } = req.body;

   if (!moment(registration_deadline, "YYYY-MM-DD").isBefore(moment(start_date, "YYYY-MM-DD"), "day")) {
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

  if (alreadyExists) throw new ApiError(400, 'Utsav Already Exists');

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
      updatedBy: req.user.username
    },
    { transaction: t }
  );

  if((location || RESEARCH_CENTRE) === RESEARCH_CENTRE){
  await BlockDates.create(
    {
      checkin: start_date,
      checkout: moment(end_date).add(1, 'day').format('YYYY-MM-DD'),
      comments: name,
      updatedBy: req.user.username
    },
    { transaction: t }
  );}

  await t.commit();

  return res.status(200).send({ message: 'Created Utsav', data: utsavDetails });
};

export const addUtsavPackage = async (req, res) => {
  const { utsavid, name, start_date, end_date, amount } = req.body;

  // 1. Get the Utsav details first
  const utsav = await UtsavDb.findOne({ where: { id: utsavid } });

  if (!utsav) {
    return res.status(404).send({ message: 'Utsav not found' });
  }

  // Convert dates to moment objects
  const packageStart = moment(start_date);
  const packageEnd = moment(end_date);
  const utsavStart = moment(utsav.start_date);
  const utsavEnd = moment(utsav.end_date);

  // 2. Check if package dates fall within Utsav dates
  if (packageStart.isBefore(utsavStart, 'day') || packageEnd.isAfter(utsavEnd, 'day')) {
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
    throw new ApiError(400, 'Package with this name already exists for the Utsav');
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

  return res.status(200).send({ message: 'Package Created', data: packageData });
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
    comments,
    location,
    registration_deadline
  } = req.body;
  const utsavId = req.params.id;

  const utsav = await validateUtsav(utsavId);
  const month = moment(start_date).format('MMMM');

  await utsav.update({
    name,
    start_date,
    end_date,
    month,
    status,
    total_seats,
    comments,
    location,
    registration_deadline,
    updatedBy: req.user.username
  });

  return res.status(200).send({ message: 'Updated Utsav' });
};

export const fetchUtsavBookings = async (req, res) => {
  const utsavid = req.query.utsavid;
  let status = req.query.status;

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
      t5.status AS transaction_status  -- 👈 fetch status from transactions table
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

  return res
    .status(200)
    .send({ message: 'Found Utsav Bookings', data: utsavData });
};

export const fetchUtsavBookingsVolunteer = async (req, res) => {
  const utsavid = req.query.utsavid;
  if (!utsavid) return res.status(400).send({ message: 'Missing utsavid' });

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

  return res.status(200).send({
    message: 'Volunteer Access List Fetched',
    data: result
  });
};

export const fetchAllUtsav = async (req, res) => {
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

  return res
    .status(200)
    .send({ message: 'Fetched Utsav Records', data: utsavs });
};

export const activateUtsav = async (req, res) => {
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

  if (itemUpdated[0] !== 1)
    throw new ApiError(500, 'Error occurred while updating Utsav status');

  res.status(200).send({ message: 'Utsav status updated' });
};

export const utsavStatusUpdate = async (req, res) => {
  const { utsav_id, bookingid, status, description } = req.body;

  let newBookingStatus = status;
  console.log('Received status:', status);

  const t = await database.transaction();
  req.transaction = t;

  const utsav = await validateUtsav(utsav_id);
  const booking = await validateUtsavBooking(bookingid, utsav_id);
  const previousStatus = booking.status;

  if (status === booking.status) {
    throw new ApiError(400, 'Status is same as before');
  }

  // Cannot change any status if already admin cancelled
  if (booking.status === STATUS_ADMIN_CANCELLED) {
    throw new ApiError(400, ERR_BOOKING_ALREADY_CANCELLED);
  }

  let transaction = await Transactions.findOne({
    where: { bookingid: bookingid }
  });

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
  console.log('Transaction already confirmed. No action needed.');
} else if (transaction.status === STATUS_PAYMENT_PENDING) {
  await transaction.update(
    {
      status: STATUS_PAYMENT_COMPLETED,  // ✅ add this line
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

      // Refresh transaction from DB just in case (to avoid stale object)
      transaction = await Transactions.findOne({
        where: { bookingid: booking.bookingid },
        transaction: t
      });

      if (
        !transaction ||
        ['credited', 'cancelled'].includes(transaction.status)
      ) {
        const packageData = await UtsavPackagesDb.findByPk(booking.packageid, {
          transaction: t
        });
        if (!packageData) throw new Error('Utsav Package not found');

        const cardnoToUse = booking.bookedBy || booking.cardno; // 👈 Use bookedBy if present

        const [existingTransaction, created] = await Transactions.findOrCreate({
          where: { bookingid: booking.bookingid },
          defaults: {
            cardno: cardnoToUse,
            category: TYPE_UTSAV,
            amount: packageData.amount,
            discount: 0,
            razorpay_order_id: null,
            description: req.body.description || 'Payment pending for Utsav',
            status: STATUS_PAYMENT_PENDING,
            updatedBy: req.user.username || 'admin'
          },
          transaction: t
        });

        if (!created) {
          if (['credited', 'cancelled'].includes(existingTransaction.status)) {
            transaction = await Transactions.create(
              {
                bookingid: booking.bookingid,
                cardno: cardnoToUse,
                category: TYPE_UTSAV,
                amount: packageData.amount,
                discount: 0,
                razorpay_order_id: null,
                description:
                  req.body.description || 'Payment pending for Utsav',
                status: STATUS_PAYMENT_PENDING,
                updatedBy: req.user.username || 'admin'
              },
              { transaction: t }
            );
          } else {
            console.warn(
              'Duplicate transaction avoided: already exists and active.'
            );
            transaction = existingTransaction;
          }
        } else {
          transaction = existingTransaction;
        }
      } else {
        console.warn('Valid transaction already exists. Skipping creation.');
      }

      newBookingStatus = STATUS_PAYMENT_PENDING;
      break;

    case STATUS_ADMIN_CANCELLED:
      console.log('>> Admin cancelling booking');

      // Admin Cancelled allowed from waiting, payment pending, or confirmed only
      if (
        booking.status !== STATUS_WAITING &&
        booking.status !== STATUS_PAYMENT_PENDING &&
        booking.status !== STATUS_CONFIRMED
      ) {
        throw new ApiError(
          400,
          'Admin Cancelled can only be set from waiting, payment pending or confirmed'
        );
      }

      if (
        booking.status === STATUS_CONFIRMED ||
        booking.status === STATUS_PAYMENT_PENDING
      ) {
        console.log('Booking.utsav_id:', booking.utsavid);
        const utsav = await UtsavDb.findByPk(booking.utsavid, {
          transaction: t
        });
        if (!utsav) {
          throw new ApiError(404, 'Utsav not found');
        }

        await openUtsavSeat(utsav, booking.cardno, req.user.username, t);
      }

      //       if (transaction && !['admin cancelled'].includes(transaction.status)) {
      //   await adminCancelTransaction(req.user, transaction, t);
      // } else {
      //   console.warn('Skipping transaction cancellation - already cancelled or credited');
      // }
      console.log(
        '>> Transaction object:',
        transaction?.toJSON?.() || transaction
      );
      console.log(
        '>> Transaction status before admin cancel check:',
        transaction?.status
      );

      if (
        transaction &&
        ![STATUS_CREDITED, STATUS_CANCELLED, STATUS_ADMIN_CANCELLED].includes(
          transaction.status
        )
      ) {
        await adminCancelTransaction(req.user, null, transaction, t);
        console.log('>> Cancelling transaction...');
      } else {
        console.warn(
          'Skipping transaction cancellation - already credited or cancelled'
        );
      }

      newBookingStatus = STATUS_ADMIN_CANCELLED;
      break;

    case STATUS_WAITING:
      // No direct transitions back to waiting allowed
      throw new ApiError(400, 'Invalid status transition to waiting');

    default:
      throw new ApiError(400, 'Invalid status provided');
  }

  await booking.update(
    {
      status: newBookingStatus,
      updatedBy: req.user.username
    },
    { transaction: t }
  );

  await t.commit();

  try {
    await sendUtsavStatusChangeWhatsApp(booking, previousStatus, { updatedBy: req.user.username });
  } catch (waErr) {
    console.error("Error sending utsav status change WhatsApp in utsavStatusUpdate:", waErr);
  }

  return res.status(200).send({ message: 'Updated booking status' });
};

export const fetchUtsav = async (req, res) => {
  const { id } = req.params;

  const utsav = await UtsavDb.findOne({
    where: { id: id }
  });

  return res.status(200).send({ message: 'Fetched Adhyayan', data: utsav });
};

export const updateUtsavPackage = async (req, res) => {
  const { name, start_date, end_date, amount } = req.body;
  const { id: packageId, utsavId } = req.params;

  const utsavPackage = await validateUtsavPackage(packageId, utsavId);

  await utsavPackage.update({
    name,
    start_date,
    end_date,
    amount,
    updatedBy: req.user.username
  });

  return res.status(200).send({ message: 'Updated Utsav Package' });
};

export const fetchAllPackages = async (req, res) => {
  const packages = await database.query(
    `SELECT 
      utsav_packages_db.id,
      utsav_packages_db.utsavid,
      utsav_packages_db.name,
      utsav_packages_db.start_date,
      utsav_packages_db.end_date,
      utsav_packages_db.amount,
      utsav_db.name AS utsav_name,
      COUNT(CASE WHEN utsav_booking.status = '${STATUS_WAITING}' THEN 1 END) AS waitlist_count
    FROM 
      utsav_packages_db
    LEFT JOIN 
      utsav_db ON utsav_packages_db.utsavid = utsav_db.id
    LEFT JOIN 
      utsav_booking ON utsav_packages_db.id = utsav_booking.packageid
    WHERE 
      utsav_packages_db.start_date > CURRENT_DATE
    GROUP BY 
      utsav_packages_db.id,
      utsav_packages_db.utsavid,
      utsav_packages_db.name,
      utsav_packages_db.start_date,
      utsav_packages_db.end_date,
      utsav_packages_db.amount,
      utsav_db.name
    ORDER BY 
      utsav_packages_db.start_date ASC;`,
    {
      type: QueryTypes.SELECT
    }
  );

  return res
    .status(200)
    .send({ message: 'Fetched Package Records', data: packages });
};

export const fetchPackagesByUtsav = async (req, res) => {
  const { utsavid } = req.query;

  if (!utsavid) {
    return res.status(400).send({ message: 'utsavid is required' });
  }

  const packages = await UtsavPackagesDb.findAll({
    where: { utsavid },
    order: [['start_date', 'ASC']]
  });

  return res.status(200).send({ message: 'Fetched packages for utsav', data: packages });
};

export const fetchPackage = async (req, res) => {
  const { id } = req.params;

  const packageData = await UtsavPackagesDb.findOne({
    where: { id: id }
  });

  if (!packageData) {
    return res.status(404).send({ message: 'Package not found' });
  }

  return res
    .status(200)
    .send({ message: 'Fetched Package', data: packageData });
};

export const fetchAllUtsavList = async (req, res) => {
  try {
    const adhyayans = await database.query(
      `SELECT id, name FROM utsav_db ORDER BY id ASC`,
      {
        type: QueryTypes.SELECT,
        raw: true
      }
    );

    return res.status(200).json({
      message: 'Fetched adhyayan list',
      data: adhyayans
    });
  } catch (error) {
    console.error('Error fetching adhyayans:', error);
    return res.status(500).json({
      message: 'Failed to fetch adhyayan list',
      error: error.message
    });
  }
};

export const utsavCheckin = async (req, res) => {
  console.log('📥 Received utsavid:', req.body.utsavid);
console.log('📥 Received cardno:', req.body.cardno);

  const t = await database.transaction();
  req.transaction = t;

  const { cardno, utsavid } = req.body;

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
    throw new ApiError(404, 'Booking not found for this user');
  }

  if ([STATUS_PAYMENT_PENDING, STATUS_CASH_PENDING].includes(booking.status)) {
    await t.rollback();
    throw new ApiError(400, "User haven't paid yet, cannot checkin");
  }

  if (booking.status === ROOM_STATUS_CHECKEDIN) {
    await t.rollback();
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

  return res.status(200).send({
    message: 'Utsav booking status updated to checkedin.'
  });
};

export const utsavCheckinReport = async (req, res) => {
  const utsavid = req.query.utsavid;
  let status = req.query.status;

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
  return res.status(200).send({ message: 'Fetched volunteer options', data: options });
};

export const uploadRoomNoExcel = async (req, res) => {
  if (!req.file) {
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
    const utsavidSet = new Set(sheet.map(r => String(r.utsavid || '').trim()));
    if (utsavidSet.size !== 1) {
      return res.status(400).json({ error: 'All rows must have the same UtsavID.' });
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
    existingBookings.forEach(b => {
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
        skippedRows.push({ row, reason: 'CardNo / UtsavID / PackageID combination does not match existing booking' });
        continue;
      }

      if (bookingid !== expectedBookingId) {
        skippedRows.push({ row, reason: `BookingID mismatch (expected: ${expectedBookingId})` });
        continue;
      }

      validRows.push({ bookingid, roomno });
    }

    if (validRows.length === 0) {
      return res.status(400).json({ error: 'No valid rows to update.', skippedRows });
    }

    // Start transaction only for update
    const transaction = await database.transaction();
    try {
      const caseStatements = validRows.map(r => `WHEN '${r.bookingid}' THEN '${r.roomno}'`);
      const bookingIds = validRows.map(r => `'${r.bookingid}'`);
    // define updatedBy and updatedAt
    const updatedBy = req.user?.username || "system"; // adjust based on your auth
    
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

      res.status(200).json({
        message: `${validRows.length} record(s) updated successfully.`,
        skippedRows
      });
    } catch (err) {
      await transaction.rollback();
      console.error(err);
      res.status(500).json({ error: 'Error updating room numbers.' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error processing file.' });
  }
};



// Update room number for a booking
export const updateRoomNo = async (req, res) => {
  try {
    const { bookingid, roomno } = req.body;

    // assuming you’re attaching logged-in user info in req.user
    const updatedBy = req.user?.username || req.user?.id || "system";  

    if (!bookingid || !roomno) {
      return res.status(400).json({ error: "bookingid and roomno are required" });
    }

    // Check if booking exists
    const booking = await UtsavBooking.findOne({ where: { bookingid } });

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    // Update fields
    booking.roomno = roomno;
    booking.updatedBy = updatedBy;
    await booking.save();

    return res.status(200).json({ 
      message: "Room number updated successfully", 
      booking 
    });
  } catch (error) {
    console.error("Error updating room number:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};
