import {
  STATUS_PAYMENT_PENDING,
  STATUS_CONFIRMED,
  TYPE_UTSAV,
  STATUS_CLOSED,
  STATUS_WAITING,
  STATUS_OPEN,
  ERR_UTSAV_ALREADY_BOOKED,
  STATUS_AVAILABLE,
  STATUS_CANCELLED,
  STATUS_ADMIN_CANCELLED,
  RESEARCH_CENTRE,
  ERR_UTSAV_NOT_FOUND,
  FEEDBACK_ELIGIBILITY_HOUR,
  ERR_UTSAV_FEEDBACK_NOT_ALLOWED,
  STATUS_CASH_PENDING,
  STATUS_CASH_COMPLETED,
  ERR_UTSAV_FEEDBACK_ALREADY_SUBMITTED,
  ROOM_STATUS_CHECKEDIN
} from '../config/constants.js';
import logger from '../config/logger.js';
import {
  UtsavDb,
  UtsavPackagesDb,
  UtsavBooking,
  CardDb,
  UtsavFeedback
} from '../models/associations.js';
import {
  createPendingTransaction,
  usableCredits
} from './transactions.helper.js';
import { v4 as uuidv4 } from 'uuid';
import moment from 'moment';
import Sequelize from 'sequelize';
import ApiError from '../utils/ApiError.js';
import {
  getBlockedDates,
  isDateRangeOverlapping,
  validateBlockedDates
} from '../controllers/helper.js';
import database from '../config/database.js';
import sendMail from '../utils/sendMail.js';
import { bookFoodForAllMeals, cancelAllMeals } from './foodBooking.helper.js';
const SAMVATSARI_PACKAGE_ID = 21;
const SAMVATSARI_OVERLAPPING_PACKAGE_IDS = [18, 20];

// Utsav booking statuses that represent an existing (non-cancelled) booking.
// A member holding a booking in any of these is "already booked" for that Utsav
// and may not book it (or an overlapping package) again. Only 'cancelled' /
// 'admin cancelled' bookings are ignored. Previously this list omitted
// checkedin / cash pending / cash completed, which let a member whose first
// booking had advanced past confirmed book a second package for the same Utsav.
const ACTIVE_UTSAV_BOOKING_STATUSES = [
  STATUS_PAYMENT_PENDING,
  STATUS_CONFIRMED,
  STATUS_WAITING,
  STATUS_CASH_PENDING,
  STATUS_CASH_COMPLETED,
  ROOM_STATUS_CHECKEDIN
];

export async function bookUtsavForMumukshus(utsavid, mumukshus, t, user) {
  const utsav = await UtsavDb.findOne({ where: { id: utsavid } });
  if (!utsav) throw new ApiError(400, 'Utsav not found');

  const packages = await UtsavPackagesDb.findAll({ where: { utsavid } });
  await checkUtsavAlreadyBooked(utsavid, mumukshus);

  let total_amount = 0;
  let available_seats = utsav.available_seats;
  let userBookingIds = {},
    waitingBookingCount = 0;

  for (const mumukshu of mumukshus) {
    let bookings = [];
    const bookingid = uuidv4();

    const package_info = packages.find(
      (p) => p.id === Number(mumukshu.packageid)
    );
    if (!package_info)
      throw new ApiError(400, `Package ${mumukshu.packageid} not found`);

    // 🟢 NEW LOGIC
    let status;
    if (available_seats <= 0) {
      status = STATUS_WAITING;
      waitingBookingCount++;
    } else if (package_info.amount > 0) {
      status = STATUS_PAYMENT_PENDING;
      available_seats--;
    } else {
      status = STATUS_CONFIRMED; // auto-confirm free packages
      available_seats--;
    }

    const booking = await UtsavBooking.create(
      {
        bookingid,
        utsavid,
        cardno: mumukshu.cardno,
        bookedBy: mumukshu.cardno !== user.cardno ? user.cardno : null,
        packageid: mumukshu.packageid,
        arrival: mumukshu.arrival,
        carno: mumukshu.carno,
        other: mumukshu.other,
        volunteer: mumukshu.volunteer,
        status: utsav.status === STATUS_CLOSED ? STATUS_WAITING : status,
        updatedBy: user.cardno
      },
      { transaction: t }
    );
    
    // 🟢 UPDATED CONDITIONAL
    if (
      utsav.status === STATUS_OPEN &&
      status === STATUS_PAYMENT_PENDING &&
      package_info.amount > 0
    ) {
      await createPendingTransaction(
        user,
        booking,
        TYPE_UTSAV,
        package_info.amount,
        user.cardno,
        t
      );
      
      total_amount += package_info.amount;
      
      
    }
    // Only provision food for non-waitlisted bookings
    if (booking.status !== STATUS_WAITING) {
      await bookFoodForUtsav(package_info, utsav, mumukshu, t, user.cardno);
    }
    bookings.push(bookingid);
    userBookingIds[mumukshu.cardno] = bookings;
  }

  await UtsavDb.update(
    { available_seats },
    { where: { id: utsavid }, transaction: t }
  );

  return { amount: total_amount, userBookingIds, waitingBookingCount };
}

export async function bookFoodForUtsav(package_info , utsav, mumukshu, t, updatedBy) {
  
  if(utsav.location !== RESEARCH_CENTRE) 
    return;

  const effectiveStartingMeal = moment(package_info.start_date).isSame(utsav.start_date, 'day')
    ? utsav.starting_meal
    : null;

  const effectiveEndingMeal = moment(package_info.end_date).isSame(utsav.end_date, 'day')
    ? utsav.ending_meal
    : null;

  await bookFoodForAllMeals(
    package_info.start_date,
    package_info.end_date,
    effectiveStartingMeal,
    effectiveEndingMeal,
    mumukshu.cardno,
    t,
    updatedBy
  );

}

export async function bookUtsavForMumukshusAdmin(
  utsavid,
  mumukshus,
  t,
  adminUser
) {
  const utsav = await UtsavDb.findOne({ where: { id: utsavid } });
  if (!utsav) throw new ApiError(400, 'Utsav not found');

  const packages = await UtsavPackagesDb.findAll({ where: { utsavid } });

  await checkUtsavAlreadyBooked(utsavid, mumukshus);

  let total_amount = 0;
  let userBookingIds = {},
    waitingBookingCount = 0;

  for (const mumukshu of mumukshus) {
    let bookings = [];
    const bookingid = uuidv4();

    const package_info = packages.find(
      (p) => p.id === Number(mumukshu.packageid)
    );
    if (!package_info)
      throw new ApiError(400, `Package ${mumukshu.packageid} not found`);

    // ⭐ Create booking in WAITING status
    const booking = await UtsavBooking.create(
      {
        bookingid,
        utsavid,
        cardno: mumukshu.cardno,
        bookedBy: null,
        packageid: mumukshu.packageid,
        arrival: mumukshu.arrival,
        carno: mumukshu.carno,
        other: mumukshu.other,
        volunteer: mumukshu.volunteer,
        status: STATUS_WAITING, // ⭐ Changed
        updatedBy: adminUser.username || 'admin'
      },
      { transaction: t }
    );

    // ⭐ NO TRANSACTION CREATION AT ALL
    // (Admin WAITING → later converted to PENDING, then transaction will be created)

    // accumulate only for info — optional
    total_amount += Number(package_info.amount) || 0;

    bookings.push(bookingid);
    userBookingIds[mumukshu.cardno] = bookings;

    waitingBookingCount++;
  }

  return { amount: total_amount, userBookingIds, waitingBookingCount };
}

export async function checkUtsavAlreadyBooked(utsavid, mumukshus) {
  const mumukshu_cardnos = mumukshus.map((mumukshu) => mumukshu.cardno);
  const alreadyBooked = await UtsavBooking.findAll({
    where: {
      cardno: mumukshu_cardnos,
      utsavid: utsavid,
      status: {
        [Sequelize.Op.in]: ACTIVE_UTSAV_BOOKING_STATUSES
      }
    }
  });

  if (alreadyBooked.length > 0)
    throw new ApiError(400, ERR_UTSAV_ALREADY_BOOKED);

  await checkOverlapWithSamvatsari(mumukshus);
}

export async function checkOverlapWithSamvatsari(mumukshus) {
  const mumukshu_cardnos = mumukshus.map((mumukshu) => mumukshu.cardno);
  const mumukshu_packages = mumukshus.map((mumukshu) => mumukshu.packageid);

  if (mumukshu_packages.length === 0) return;

  const alreadyBooked = await database.query(
    `
      SELECT *
      FROM utsav_booking t1
      WHERE t1.cardno IN (:cardnos)
      AND t1.status IN (:status)
      AND (
        (
          t1.packageid = :samvatsari_package_id
          AND true = :packages_overlap_with_samvatsari
        ) OR (
          t1.packageid IN (:samvatsari_overlapping_packages)
          AND true = :packages_include_samvatsari
        )
      )
      `,
    {
      replacements: {
        cardnos: mumukshu_cardnos,
        status: ACTIVE_UTSAV_BOOKING_STATUSES,
        samvatsari_package_id: SAMVATSARI_PACKAGE_ID,
        samvatsari_overlapping_packages: SAMVATSARI_OVERLAPPING_PACKAGE_IDS,
        packages_overlap_with_samvatsari: mumukshu_packages.some((packageid) =>
          SAMVATSARI_OVERLAPPING_PACKAGE_IDS.includes(packageid)
        ),
        packages_include_samvatsari: mumukshu_packages.includes(
          SAMVATSARI_PACKAGE_ID
        )
      },
      type: Sequelize.QueryTypes.SELECT
    }
  );

  if (alreadyBooked.length > 0)
    throw new ApiError(400, ERR_UTSAV_ALREADY_BOOKED);
}

export async function validateUtsavs(user, utsavid, mumukshus) {
  var utsavDetails = [];

  const utsav = await UtsavDb.findOne({
    where: {
      id: utsavid
    }
  });
  if (!utsav) throw new ApiError(400, 'Utsav not found');

  const packages = await UtsavPackagesDb.findAll({
    where: { utsavid }
  });

  // Create a temp user with cloned credits to track usage during this validation loop without mutating the original user object.
  const tempUser = { ...user, credits: { ...user.credits } };

  for (const mumukshu of mumukshus) {
    const package_info = packages.find((p) => p.id === mumukshu.packageid);
    if (!package_info) {
      throw new ApiError(400, `Package ${mumukshu.packageid} not found`);
    }

    var status = STATUS_WAITING;
    var charge = 0;
    var availableCredits = 0;

    if (utsav.status === STATUS_OPEN) {
      status = STATUS_AVAILABLE;
      charge = package_info.amount;
      availableCredits = usableCredits(tempUser, TYPE_UTSAV, charge);
    }

    utsavDetails.push({
      utsavId: utsavid,
      status,
      charge,
      availableCredits
    });
  }

  return utsavDetails;
}

export async function validateUtsavBooking(bookingId, utsavId) {
  const booking = await UtsavBooking.findOne({
    where: {
      utsavid: utsavId,
      bookingid: bookingId
    }
  });

  if (!booking) {
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  return booking;
}

export async function reserveUtsavSeat(utsav, t) {
  if (utsav.available_seats <= 0) {
    throw new ApiError(400, ERR_UTSAV_NO_SEATS_AVAILABLE);
  }

  await utsav.update(
    {
      available_seats: utsav.dataValues.available_seats - 1
    },
    { transaction: t }
  );
}

export async function openUtsavSeat(utsav, cardno, updatedBy, t) {
  logger.info('open_utsav_seat_start', { utsavid: utsav?.id, cardno, updatedBy, utsavStatus: utsav?.status });

  // Only increase available seats if utsav is in "open" status
  if (utsav.status !== STATUS_OPEN) return;

  await utsav.update(
    {
      available_seats: utsav.dataValues.available_seats + 1,
      updatedBy: updatedBy // Optional: audit trail
    },
    { transaction: t }
  );
}

export async function validateUtsavPackage(packageId, utsavId) {
  const packageData = await UtsavPackagesDb.findOne({
    where: {
      id: packageId,
      utsavid: utsavId
    }
  });

  if (!packageData) {
    throw new ApiError(
      400,
      `Package with ID ${packageId} not found for Utsav ${utsavId}`
    );
  }

  return packageData;
}

export function isUtsavOverlapping(utsav, startDate, endDate) {
  if (!utsav) return false;

  return isDateRangeOverlapping(
    utsav.start_date,
    utsav.end_date,
    startDate,
    endDate,
    false
  );
}

export async function getUtsavBookingsByCardno(cardnos, startDate, endDate) {
  const bookings = await getUtsavBookings(cardnos, startDate, endDate);

  const grouped = bookings.reduce((acc, booking) => {
    acc[booking.cardno] = booking;
    return acc;
  }, {});

  return grouped;
}

export async function getUtsavBookings(cardnos, startDate, endDate) {
  const utsavBookings = await UtsavBooking.findAll({
    where: {
      cardno: cardnos,
      status: {
        [Sequelize.Op.notIn]: [STATUS_CANCELLED, STATUS_ADMIN_CANCELLED]
      }
    },
    include: [
      {
        model: UtsavDb,
        where: {
          [Sequelize.Op.or]: [
            {
              // utsav starts between start and end date
              [Sequelize.Op.and]: [
                { start_date: { [Sequelize.Op.gte]: startDate } },
                { start_date: { [Sequelize.Op.lte]: endDate } }
              ]
            },
            {
              // utsav ends between start and end date
              [Sequelize.Op.and]: [
                { end_date: { [Sequelize.Op.gte]: startDate } },
                { end_date: { [Sequelize.Op.lte]: endDate } }
              ]
            },
            {
              // utsav starts before start and ends after end date
              [Sequelize.Op.and]: [
                { start_date: { [Sequelize.Op.lte]: startDate } },
                { end_date: { [Sequelize.Op.gte]: endDate } }
              ]
            }
          ]
        }
      }
    ]
  });

  return utsavBookings;
}

export function splitDateRanges(
  utsavStart,
  utsavEnd,
  bookingStart,
  bookingEnd
) {
  const ranges = [];

  if (new Date(bookingStart) < new Date(utsavStart)) {
    ranges.push({
      start: bookingStart,
      end: utsavStart,
      overlappingWithUtsav: true
    });
  }

  if (new Date(bookingEnd) > new Date(utsavEnd)) {
    ranges.push({
      start: utsavEnd,
      end: bookingEnd,
      overlappingWithUtsav: true
    });
  }

  return ranges;
}

export async function getDateRangesDuringUtsav(
  mumukshus,
  startDate,
  endDate,
  utsav
) {
  const inProgressUtsavOverlapping = isUtsavOverlapping(
    utsav,
    startDate,
    endDate
  );

  const existingUtsavBookings = inProgressUtsavOverlapping
    ? {}
    : await getUtsavBookingsByCardno(mumukshus, startDate, endDate);

  const blockedDates = await getBlockedDates(startDate, endDate);

  const dateRangesByMumukshu = {};
  for (const mumukshu of mumukshus) {
    const isDayVisit = startDate === endDate;

if (isDayVisit) {
  dateRangesByMumukshu[mumukshu] = [
    {
      start: startDate,
      end: endDate,
      overlappingWithUtsav: false
    }
  ];
  continue;
}

    const utsavBooking = inProgressUtsavOverlapping
      ? utsav
      : existingUtsavBookings[mumukshu]?.UtsavDb;

    const dateRanges = [];
    if (utsavBooking) {
      dateRanges.push(
        ...splitDateRanges(
          utsavBooking.start_date,
          utsavBooking.end_date,
          startDate,
          endDate
        )
      );
    } else {
      // In case, utsav booking is not found for this mumukshu, check if there is any
      // utsav starts on checkout or ends on checkin date
      const utsavOnBoundary = await findUtsavOnBoundaryDates(
        startDate,
        endDate
      );
      dateRanges.push({
        start: startDate,
        end: endDate,
        overlappingWithUtsav: utsavOnBoundary ? true : false
      });
    }

    // validate blockedDates
    validateBlockedDates(blockedDates, dateRanges);

    dateRangesByMumukshu[mumukshu] = dateRanges;
  }

  return dateRangesByMumukshu;
}

export async function sendUtsavBookingUpdateEmail(booking, utsav) {
  // Parallel database queries for better performance
  const [card, bookedByCard, utsavData] = await Promise.all([
    CardDb.findOne({ where: { cardno: booking.cardno } }),
    booking.bookedBy
      ? CardDb.findOne({ where: { cardno: booking.bookedBy } })
      : null,
    utsav || UtsavDb.findOne({ where: { id: booking.utsavid } })
  ]);

  // Early return if no card or email
  if (!card?.email) return;

  // Send email with optimized context
  sendMail({
    email: card.email,
    cc: bookedByCard?.email,
    subject: 'Utsav Booking Updated',
    template: 'utsavStatusUpdate',
    context: {
      name: card.issuedto,
      bookingid: booking.bookingid,
      status: booking.status,
      utsavName: utsavData.name,
      utsavStartDate: utsavData.start_date,
      utsavEndDate: utsavData.end_date
    }
  });
}

export async function findUtsavOnBoundaryDates(checkin, checkout) {
  const utsav = await UtsavDb.findOne({
    where: {
      [Sequelize.Op.or]: [{ end_date: checkin }, { start_date: checkout }]
    }
  });

  return utsav;
}

export async function cancelUtsavFoodBookings(booking, updatedBy, t) {

  // Mirror bookFoodForUtsav: food is only auto-created for Research Centre utsavs,
  // so only cancel it for those (otherwise we'd wipe unrelated food on these dates).
  const utsav = await UtsavDb.findOne({ where: { id: booking.utsavid } });
  if (!utsav || utsav.location !== RESEARCH_CENTRE) return;

  const utsavPackage = await UtsavPackagesDb.findOne({ where: { id: booking.packageid } });

  if (utsavPackage) {
    await cancelAllMeals(utsavPackage.start_date, utsavPackage.end_date, booking.cardno, updatedBy, t);
  }

}

export async function validateFeedbackEligibility(
  cardno,
  utsav_id
) {

  const utsav = await UtsavDb.findOne({
    where: { id: utsav_id }
  });

  if (!utsav) {
    throw new ApiError(
      404,
      ERR_UTSAV_NOT_FOUND
    );
  }

  const now = moment().tz('Asia/Kolkata');

  // Feedback starts from utsav start date
  const feedbackStartDate = moment(utsav.start_date)
    .tz('Asia/Kolkata')
    .hour(FEEDBACK_ELIGIBILITY_HOUR)
    .minute(0)
    .second(0);

  // Calculate utsav duration
  const utsavDuration =
    moment(utsav.end_date)
      .diff(
        moment(utsav.start_date),
        'days'
      ) + 1;

  // If utsav is 8+ days long,
  // keep feedback open for 15 days
  // otherwise 8 days
  const feedbackWindowDays =
    utsavDuration >= 8
      ? 15
      : 8;

  const feedbackEndDate = moment(
    feedbackStartDate
  ).add(
    feedbackWindowDays,
    'days'
  );

  // Feedback not started yet
  if (now.isBefore(feedbackStartDate)) {

    throw new ApiError(
      400,
      ERR_UTSAV_FEEDBACK_NOT_ALLOWED
    );

  }

  // Feedback expired
  if (now.isAfter(feedbackEndDate)) {

    throw new ApiError(
      400,
      `Feedback submission is only allowed within ${feedbackWindowDays} days after the utsav starts`
    );

  }

  // Check if user has valid booking
  const booking = await UtsavBooking.findOne({
    where: {
      cardno,
      utsavid: utsav_id,
      status: [
        STATUS_CONFIRMED,
        STATUS_CASH_COMPLETED,
        ROOM_STATUS_CHECKEDIN
      ]
    }
  });

  if (!booking) {

    throw new ApiError(
      403,
      ERR_UTSAV_FEEDBACK_NOT_ALLOWED
    );

  }

  // Prevent duplicate feedback
  const existingFeedback =
    await UtsavFeedback.findOne({
      where: {
        cardno,
        utsav_id
      }
    });

  if (existingFeedback) {

    throw new ApiError(
      400,
      ERR_UTSAV_FEEDBACK_ALREADY_SUBMITTED
    );

  }

  return {
    utsav,
    booking
  };

}
