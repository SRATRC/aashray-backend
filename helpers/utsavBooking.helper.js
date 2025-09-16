import {
  STATUS_PAYMENT_PENDING,
  STATUS_CONFIRMED,
  TYPE_UTSAV,
  STATUS_CLOSED,
  STATUS_WAITING,
  STATUS_OPEN,
  ERR_UTSAV_ALREADY_BOOKED,
  STATUS_AVAILABLE
} from '../config/constants.js';
import {
  UtsavDb,
  UtsavPackagesDb,
  UtsavBooking,
  CardDb
} from '../models/associations.js';
import {
  createPendingTransaction,
  usableCredits
} from './transactions.helper.js';
import { v4 as uuidv4 } from 'uuid';
import Sequelize from 'sequelize';
import ApiError from '../utils/ApiError.js';
import database from '../config/database.js';
import sendMail from '../utils/sendMail.js';
const SAMVATSARI_PACKAGE_ID = 21;
const SAMVATSARI_OVERLAPPING_PACKAGE_IDS = [18, 20];

export async function bookUtsavForMumukshus(utsavid, mumukshus, t, user) {
  const utsav = await UtsavDb.findOne({
    where: {
      id: utsavid
    }
  });
  if (!utsav) throw new ApiError(400, 'Utsav not found');

  const packages = await UtsavPackagesDb.findAll({
    where: { utsavid }
  });

  await checkUtsavAlreadyBooked(utsavid, mumukshus);

  let total_amount = 0;
  let available_seats = utsav.available_seats;

  let status = STATUS_PAYMENT_PENDING;
  let userBookingIds = {},
    waitingBookingCount = 0;
  for (const mumukshu of mumukshus) {
    let bookings = [];
    const bookingid = uuidv4();

    const package_info = packages.find(
      (p) => p.id === Number(mumukshu.packageid)
    );

    if (!package_info) {
      throw new ApiError(400, `Package ${mumukshu.packageid} not found`);
    }

    if (available_seats <= 0) {
      status = STATUS_WAITING;
      waitingBookingCount++;
    } else {
      status = STATUS_PAYMENT_PENDING;
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

    if (utsav.status === STATUS_OPEN && status === STATUS_PAYMENT_PENDING) {
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
    bookings.push(bookingid);
    userBookingIds[mumukshu.cardno] = bookings;
  }

  UtsavDb.update(
    {
      available_seats: available_seats
    },
    {
      where: {
        id: utsavid
      }
    },
    { transaction: t }
  );

  return { amount: total_amount, userBookingIds, waitingBookingCount };
}

export async function checkUtsavAlreadyBooked(utsavid, mumukshus) {
  const mumukshu_cardnos = mumukshus.map((mumukshu) => mumukshu.cardno);
  const alreadyBooked = await UtsavBooking.findAll({
    where: {
      cardno: mumukshu_cardnos,
      utsavid: utsavid,
      status: {
        [Sequelize.Op.in]: [
          STATUS_PAYMENT_PENDING,
          STATUS_CONFIRMED,
          STATUS_WAITING
        ]
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
        status: [STATUS_PAYMENT_PENDING, STATUS_CONFIRMED, STATUS_WAITING],
        samvatsari_package_id: SAMVATSARI_PACKAGE_ID,
        samvatsari_overlapping_packages: SAMVATSARI_OVERLAPPING_PACKAGE_IDS,
        packages_overlap_with_samvatsari:
          mumukshu_packages.some((packageid) =>
            SAMVATSARI_OVERLAPPING_PACKAGE_IDS.includes(packageid)
          ),
        packages_include_samvatsari:
          mumukshu_packages.includes(SAMVATSARI_PACKAGE_ID)
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
      availableCredits = usableCredits(user, TYPE_UTSAV, charge);
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
  console.log('Input to openUtsavSeat:', utsav, cardno, updatedBy);

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

export async function sendUtsavBookingUpdateEmail(booking, utsav) {
  
  const bookedByCard = booking.bookedBy ? await validateCard(booking.bookedBy) : null;
  const card = await CardDb.findOne({
    where: { cardno: booking.cardno }
  });

  if (card && card.email) {
    sendMail({
      email: card.email,
      cc: bookedByCard ? bookedByCard.email : null,
      subject: 'Utsav Booking Updated',
      template: 'utsavStatusUpdate',    
      context: {
        name: card.issuedto,
        bookingid: booking.bookingid,
        status: booking.status,
        utsavName: utsav.name,
        utsavStartDate: utsav.start_date,
        utsavEndDate: utsav.end_date
      }
    });
  }
}