import {
  RoomBooking,
  FlatBooking,
  FoodDb,
  ShibirBookingDb,
  ShibirDb,
  TravelDb,
  CardDb,
  GuestRelationship,
  UtsavPackagesDb,
  UtsavBooking,
  UtsavDb
} from '../models/associations.js';
import logger from '../config/logger.js';
import {
  STATUS_CONFIRMED,
  TYPE_ROOM,
  TYPE_TRAVEL,
  TYPE_ADHYAYAN,
  ERR_INVALID_DATE,
  TYPE_FLAT,
  TYPE_UTSAV,
  STATUS_GUEST,
  STATUS_ACTIVE, 
  RAJ_PRAVAS_EMAIL,
  BOOKING_STATUS_PENDING,
  STATUS_ADMIN_CANCELLED,
  STATUS_CANCELLED,
  ROOM_STATUS_CHECKEDOUT
} from '../config/constants.js';
import Sequelize from 'sequelize';
import getDates from '../utils/getDates.js';
import moment from 'moment';
import ApiError from '../utils/ApiError.js';
import BlockDates from '../models/block_dates.model.js';
import sendMail from '../utils/sendMail.js';
import { sendWhatsAppMessage } from "../utils/sendWhatsAppMessage.js";

export async function getBlockedDates(checkin_date, checkout_date) {
  // const startDate = new Date(checkin_date);
  // const endDate = new Date(checkout_date);

  const blockedDates = await BlockDates.findAll({
    where: {
      status: STATUS_ACTIVE,
      [Sequelize.Op.or]: [
        {
          [Sequelize.Op.and]: [
            { checkin: { [Sequelize.Op.lte]: checkin_date } },
            { checkout: { [Sequelize.Op.gte]: checkin_date } }
          ]
        },
        {
          [Sequelize.Op.and]: [
            { checkin: { [Sequelize.Op.lte]: checkout_date } },
            { checkout: { [Sequelize.Op.gte]: checkout_date } }
          ]
        },
        {
          [Sequelize.Op.and]: [
            { checkin: { [Sequelize.Op.gte]: checkin_date } },
            { checkin: { [Sequelize.Op.lte]: checkout_date } }
          ]
        }
      ]
    }
  });

  return blockedDates;
}

export async function checkFlatAlreadyBooked(checkin, checkout, cardnos) {
  const result = await FlatBooking.findAll({
    where: {
      [Sequelize.Op.or]: [
        {
          [Sequelize.Op.and]: [
            { checkin: { [Sequelize.Op.gte]: checkin } },
            { checkin: { [Sequelize.Op.lt]: checkout } }
          ]
        },
        {
          [Sequelize.Op.and]: [
            { checkout: { [Sequelize.Op.gt]: checkin } },
            { checkout: { [Sequelize.Op.lte]: checkout } }
          ]
        },
        {
          [Sequelize.Op.and]: [
            { checkin: { [Sequelize.Op.lte]: checkin } },
            { checkout: { [Sequelize.Op.gte]: checkout } }
          ]
        }
      ],
      status: {
        [Sequelize.Op.notIn]: [
          STATUS_CANCELLED,
          STATUS_ADMIN_CANCELLED,
          ROOM_STATUS_CHECKEDOUT
        ]
      },
      cardno: cardnos
    }
  });

  return result.length > 0;
}

export async function calculateNights(checkin, checkout) {
  const date1 = new Date(checkin);
  const date2 = new Date(checkout);

  // Calculate the difference in days
  const timeDifference = date2.getTime() - date1.getTime();
  const nights = Math.ceil(timeDifference / (1000 * 3600 * 24));

  return nights;
}

export async function isFoodBooked(start_date, end_date, cardno) {
  const startDate = new Date(start_date);
  const endDate = new Date(end_date);

  const allDates = getDates(startDate, endDate);

  const food_bookings = await FoodDb.findAll({
    where: {
      cardno: cardno,
      date: allDates
    }
  });

  return food_bookings.length > 0;
}

export function validateDate(start_date, end_date) {
  const today = moment().format('YYYY-MM-DD');
  const checkinDate = new Date(start_date);
  const checkoutDate = new Date(end_date);
  if (today > start_date || today > end_date || checkinDate > checkoutDate) {
    throw new ApiError(400, ERR_INVALID_DATE);
  }
}

export async function checkSpecialAllowance(
  start_date,
  end_date,
  primary_booking,
  addons,
  cardno
) {
  let adhyayanRequests = [];
  if (primary_booking && primary_booking.booking_type === TYPE_ADHYAYAN) {
    adhyayanRequests.push(primary_booking);
  }
  if (addons && addons.length > 0) {
    adhyayanRequests.push(
      ...addons.filter((addon) => addon.booking_type === TYPE_ADHYAYAN)
    );
  }

  if (adhyayanRequests.length > 0) {
    const shibirIds = adhyayanRequests.flatMap(
      (req) => req.details?.shibir_ids || []
    );

    if (shibirIds.length > 0) {
      const shibirs = await ShibirDb.findAll({
        where: {
          id: shibirIds,
          food_allowed: 1
        }
      });

      const startDate = new Date(start_date);
      const endDate = new Date(end_date);

      for (const shibir of shibirs) {
        const shibirStart = new Date(shibir.start_date);
        const shibirEnd = new Date(shibir.end_date);
        if (startDate >= shibirStart && endDate <= shibirEnd) {
          return true;
        }
      }
    }
  }

  const adhyayans = await ShibirBookingDb.findAll({
    include: [
      {
        model: ShibirDb,
        where: {
          food_allowed: 1,
          start_date: {
            [Sequelize.Op.lte]: start_date
          },
          end_date: {
            [Sequelize.Op.gte]: end_date
          }
        }
      }
    ],
    where: {
      cardno: cardno,
      status: STATUS_CONFIRMED
    }
  });

  if (adhyayans && adhyayans.length > 0) {
    return true;
  }

  return false;
}

export async function checkRoomBookingProgress(
  start_date,
  end_date,
  primary_booking,
  addons
) {
  var addon = addons && addons.find((addon) => addon.booking_type == TYPE_ROOM);

  if ((primary_booking && primary_booking.booking_type == TYPE_ROOM) || addon) {
    const startDate = new Date(start_date);
    const endDate = new Date(end_date);
    const checkinDate = new Date(
      primary_booking.details.checkin_date || addon.details.checkin_date
    );
    const checkoutDate = new Date(
      primary_booking.details.checkout_date || addon.details.checkout_date
    );

    return startDate >= checkinDate && endDate <= checkoutDate;
  }

  return false;
}

/*
 * Input:
 *    userBookingIds: { cardno: [bookingIds] }
 *    userBookingIdMap: { cardno: { type: [bookingIds] } }
 * Output:
 *    userBookingIdMap: { cardno: { type: [bookingIds] } }
 */
export function setBookingIdMap(userBookingIdMap, type, userBookingIds) {
  for (const cardno in userBookingIds) {
    const bookingIds = userBookingIds[cardno];
    const userBookingIdsByType = userBookingIdMap[cardno] || {};

    userBookingIdsByType[type] = bookingIds;
    userBookingIdMap[cardno] = userBookingIdsByType;
  }
}

/**
 *
 * @param {*} waitingBookingCountMap
 * @param {*} type
 * @param {*} waitingBookingCount
 * @param {*} totalBookingCount
 */
export function setWaitingBookingCountMap(
  waitingBookingCountMap,
  type,
  waitingBookingCount,
  totalBookings
) {
  if (waitingBookingCount > 0) {
    const arrayOfBookingIdArrays = Object.values(totalBookings);
    const allBookingIds = arrayOfBookingIdArrays.flat();
    waitingBookingCountMap[type] = {
      waiting: waitingBookingCount,
      total: allBookingIds.length
    };
  }
}

export function retrieveBookingIds(userBookingIdMap) {
  return Object.values(userBookingIdMap)
    .map((bookingIdsByType) => Object.values(bookingIdsByType).flat())
    .flat();
}

export async function sendUnifiedEmailForBookedBy(
  userBookingIdMap,
  bookedBy,
  bookingStatus
) {
  const flattenedMap = {};
  let isSelfBooking = true;
  // First, collect all booking IDs by type
  for (const [cardNo, bookingTypes] of Object.entries(userBookingIdMap)) {
    if (cardNo !== bookedBy.cardno) {
      isSelfBooking = false;
    }

    for (const [type, bookingIds] of Object.entries(bookingTypes)) {
      // Initialize array if not exists
      if (!flattenedMap[type]) {
        flattenedMap[type] = [];
      }

      // Add all booking IDs for this type
      if (Array.isArray(bookingIds)) {
        flattenedMap[type] = [...flattenedMap[type], ...bookingIds];
      }
    }
  }
  // Only send email if we have bookings
  if (Object.keys(flattenedMap).length > 0) {
    await sendUnifiedEmail(
      isSelfBooking ? bookedBy.cardno : null,
      flattenedMap,
      bookedBy,
      bookingStatus
    );
  }
}

export function getSubject(bookingStatus) {
  if (bookingStatus == BOOKING_STATUS_PENDING) {
    return 'Bookings created';
  }
  if (bookingStatus == STATUS_CANCELLED) {
    return 'Bookings cancelled';
  }
  return 'Bookings confirmed';
}

export function getWelcomeMessage(bookingStatus, country) {
  if (bookingStatus == BOOKING_STATUS_PENDING) {
    const bookingCreate = 'Your bookings were created.';
    return country && country != 'India'
      ? bookingCreate +
          ' NRIs can make payments for any bookings in pending status at the Research Center upon arrival.'
      : bookingCreate +
          ' Payment is due within 24 hours to confirm any bookings in pending status.';
  }

  if (bookingStatus == STATUS_CANCELLED) {
    return 'We are sorry to inform you that your bookings have been cancelled.';
  }
  return 'We are pleased to inform you that your bookings have been confirmed.';
}

export async function sendUnifiedEmail(
  cardno,
  bookingIds,
  bookedBy,
  bookingStatus = STATUS_CONFIRMED,
  template = 'unifiedBookingEmail'
) {
  let wasAdhyanBooked = bookingIds[TYPE_ADHYAYAN] != null;
  let wasRajprvasBooked = bookingIds[TYPE_TRAVEL] != null;
  let wasRoomBooked = bookingIds[TYPE_ROOM] != null;
  let wasFlatBooked =
    Array.isArray(bookingIds[TYPE_FLAT]) && bookingIds[TYPE_FLAT].length > 0;
  let wasUtsavBooked = bookingIds[TYPE_UTSAV] != null;

  let adhyanBookingDetails = [],
    roomBookingDetails = [],
    travelBookingDetails = [],
    flatBookingDetails = [],
    utsavBookingDetails = [],
    includeProfile = false,
    user;

  if (cardno == null) {
    includeProfile = true;
  } else {
    user = await CardDb.findOne({
      where: { cardno }
    });
  }

  if (wasUtsavBooked) {
    const includeOptions = [
      {
        model: UtsavDb,
        attributes: ['name', 'start_date', 'end_date'],
        where: { id: Sequelize.col('UtsavBooking.utsavid') } // Changed from UtsavBookingDb.utsav_id
      },
      {
        model: UtsavPackagesDb,
        attributes: ['name'],
        where: { id: Sequelize.col('UtsavBooking.packageid') } // Changed from UtsavBookingDb.packageid
      }
    ];

    // Add CardDb include only if includeProfile is true
    if (includeProfile) {
      includeOptions.push({
        model: CardDb,
        attributes: ['issuedto'],
        where: { cardno: Sequelize.col('UtsavBooking.cardno') }
      });
    }

    const utsavBookings = await UtsavBooking.findAll({
      include: includeOptions,
      where: { bookingId: { [Sequelize.Op.in]: bookingIds[TYPE_UTSAV] } },
      order: [
        ['cardno', 'ASC'],
        ['createdAt', 'ASC']
      ]
    });

    utsavBookings.forEach((utsavBooking) => {
      utsavBookingDetails.push({
        name: user ? user.issuedto : utsavBooking.dataValues.CardDb.issuedto,
        utsavname: utsavBooking.dataValues.UtsavDb.name,
        startdate: moment(utsavBooking.dataValues.UtsavDb.start_date).format(
          'Do MMMM, YYYY'
        ),
        enddate: moment(utsavBooking.dataValues.UtsavDb.end_date).format(
          'Do MMMM, YYYY'
        ),
        status: utsavBooking.status,
        bookingid: utsavBooking.bookingid,
        package: utsavBooking.dataValues.UtsavPackagesDb.name
      });
    });
  }

  if (wasAdhyanBooked) {
    let includeOptions = [];
    includeOptions.push({
      model: ShibirDb,
      attributes: ['name', 'speaker', 'month', 'start_date', 'end_date'],
      where: { id: Sequelize.col('ShibirBookingDb.shibir_id') }
    });
    if (includeProfile) {
      includeOptions.push({
        model: CardDb,
        attributes: ['issuedto'],
        where: { cardno: Sequelize.col('ShibirBookingDb.cardno') }
      });
    }
    const adhyanBookings = await ShibirBookingDb.findAll({
      include: includeOptions,
      where: {
        bookingid: { [Sequelize.Op.in]: bookingIds[TYPE_ADHYAYAN] }
      },
      order: [
        ['cardno', 'ASC'],
        ['createdAt', 'ASC']
      ]
    });

    adhyanBookings.forEach((adhyanBooking) => {
      adhyanBookingDetails.push({
        bookingid: adhyanBooking.bookingid,
        adhyayanname: adhyanBooking.dataValues.ShibirDb.name,
        name: user ? user.issuedto : adhyanBooking.dataValues.CardDb.issuedto,
        speaker: adhyanBooking.dataValues.ShibirDb.speaker,
        startdate: moment(adhyanBooking.dataValues.ShibirDb.start_date).format(
          'Do MMMM, YYYY'
        ),
        enddate: moment(adhyanBooking.dataValues.ShibirDb.end_date).format(
          'Do MMMM, YYYY'
        ),
        status: adhyanBooking.status
      });
    });
  }
  if (wasRajprvasBooked) {
    let includeOptions = [];
    if (includeProfile) {
      includeOptions.push({
        model: CardDb,
        attributes: ['issuedto'],
        where: { cardno: Sequelize.col('TravelDb.cardno') }
      });
    }
    const travelBookings = await TravelDb.findAll({
      include: includeOptions,
      where: {
        bookingId: { [Sequelize.Op.in]: bookingIds[TYPE_TRAVEL] }
      },
      order: [
        ['cardno', 'ASC'],
        ['date', 'ASC']
      ]
    });

    travelBookings.forEach((travelBooking) => {
      travelBookingDetails.push({
        name: user ? user.issuedto : travelBooking.dataValues.CardDb.issuedto,
        status: travelBooking.status,
        bookingid: travelBooking.bookingid,
        date: moment(travelBooking.date).format('Do MMMM, YYYY'),
        pickuppoint: travelBooking.pickup_point,
        dropoffpoint: travelBooking.drop_point
      });
    });
  }

  if (wasRoomBooked) {
    let includeOptions = [];
    if (includeProfile) {
      includeOptions.push({
        model: CardDb,
        attributes: ['issuedto'],
        where: { cardno: Sequelize.col('RoomBooking.cardno') }
      });
    }
    const roomBookings = await RoomBooking.findAll({
      include: includeOptions,
      where: {
        bookingid: { [Sequelize.Op.in]: bookingIds[TYPE_ROOM] }
      },
      order: [
        ['cardno', 'ASC'],
        ['checkin', 'ASC']
      ]
    });
    roomBookings.forEach((roomBooking) => {
      roomBookingDetails.push({
        name: user ? user.issuedto : roomBooking.dataValues.CardDb.issuedto,
        status: roomBooking.status,
        bookingid: roomBooking.bookingid,
        roomno: roomBooking.roomno,
        checkin: moment(roomBooking.checkin).format('Do MMMM, YYYY'),
        checkout: moment(roomBooking.checkout).format('Do MMMM, YYYY')
      });
    });
  }

  if (wasFlatBooked) {
    let includeOptions = [];
    if (includeProfile) {
      includeOptions.push({
        model: CardDb,
        attributes: ['issuedto'],
        where: { cardno: Sequelize.col('FlatBooking.cardno') }
      });
    }
    const flatBookings = await FlatBooking.findAll({
      include: includeOptions,
      where: {
        bookingid: { [Sequelize.Op.in]: bookingIds[TYPE_FLAT] }
      },
      order: [
        ['cardno', 'ASC'],
        ['checkin', 'ASC']
      ]
    });

    flatBookings.forEach((flatBooking) => {
      flatBookingDetails.push({
        name: user ? user.issuedto : flatBooking.dataValues.CardDb.issuedto,
        status: flatBooking.status,
        bookingid: flatBooking.bookingid,
        flatno: flatBooking.flatno,
        checkin: moment(flatBooking.checkin).format('Do MMMM, YYYY'),
        checkout: moment(flatBooking.checkout).format('Do MMMM, YYYY')
      });
    });
  }

  const country =
    user && user.country ? user.country : bookedBy && bookedBy.country;

  let welcomeMessage = getWelcomeMessage(bookingStatus, country);

  const email = user && user.email ? user.email : bookedBy && bookedBy.email;
  const name =
    user && user.issuedto ? user.issuedto : bookedBy && bookedBy.issuedto;

  if (email) {
    sendMail({
      email: email,
      subject:getSubject(bookingStatus),
      template,
      context: {
        showAdhyanDetail: wasAdhyanBooked,
        showRoomDetail: wasRoomBooked,
        showTravelDetail: wasRajprvasBooked,
        showFlatDetail: wasFlatBooked,
        showUtsavDetail: wasUtsavBooked,
        name: name,
        roomBookingDetails,
        adhyanBookingDetails,
        travelBookingDetails,
        flatBookingDetails,
        utsavBookingDetails,
        bookingStatus,
        welcomeMessage
      }
    });
  }
  //sending email to rajpras only in prod
  if (
    wasRajprvasBooked &&
    cardno != null &&
    ['prod'].includes(process.env.NODE_ENV)
  ) {
    sendMail({
      email: RAJ_PRAVAS_EMAIL,
      subject: getSubject(bookingStatus) +" "+ name,
      template: template,
      context: {
        showTravelDetail: wasRajprvasBooked,
        name: name,
        travelBookingDetails,
        bookingStatus,
        welcomeMessage
      }
    });
  }

    // ✅ Also send WhatsApp messages
  await sendUnifiedWhatsApp(user, adhyanBookingDetails, travelBookingDetails, flatBookingDetails, utsavBookingDetails, roomBookingDetails);

}

export async function createGuestsHelper(cardno, guests, t) {
  const registeredGuests = guests.filter((guest) => guest.cardno);
  const unregisteredGuests = guests.filter((guest) => !guest.cardno);

  // Generate all needed IDs in one call
  const newCardIds =
    unregisteredGuests.length > 0
      ? await createCardIds(unregisteredGuests.length)
      : [];

  const guestsToCreate = unregisteredGuests.map((guest, index) => ({
    issuedto: guest.name,
    gender: guest.gender,
    mobno: guest.mobno,
    guest_type: guest.type,
    cardno: newCardIds[index],
    res_status: STATUS_GUEST,
    updatedBy: cardno,
    packageid: guest.packageid
  }));

  let createdGuests = [];
  if (guestsToCreate.length > 0) {
    createdGuests = await CardDb.bulkCreate(guestsToCreate, {
      transaction: t,
      returning: true
    });
  }

  if (guestsToCreate.length > 0) {
    await GuestRelationship.bulkCreate(
      guestsToCreate.map((guest) => ({
        cardno: cardno,
        guest: guest.cardno,
        type: guest.guest_type,
        updatedBy: cardno
      })),
      {
        transaction: t
      }
    );
  }

  const allGuests = [...registeredGuests, ...guestsToCreate];
  return allGuests;
}

export async function createCardIds(count) {
  // Convert array to Set for O(1) lookups if needed
  const existingIds = await CardDb.findAll({
    attributes: ['cardno'],
    raw: true
  }).then((cards) => cards.map((card) => card.cardno));
  const usedIds =
    existingIds instanceof Set ? existingIds : new Set(existingIds);

  // Track the new IDs we're generating
  const newIds = [];

  // Constants for the ID range
  const MIN_ID = 1;
  const MAX_ID = 9999999999;

  // If we have too many existing IDs, a sequential approach might be more efficient
  const RANDOM_THRESHOLD = MAX_ID * 0.1; // Arbitrary threshold - adjust based on your data

  if (usedIds.size > RANDOM_THRESHOLD) {
    // With many existing IDs, use sequential generation with validation
    let currentId = MIN_ID;

    while (newIds.length < count && currentId <= MAX_ID) {
      const idString = currentId.toString().padStart(10, '0');

      if (!usedIds.has(idString)) {
        newIds.push(idString);
        usedIds.add(idString); // Prevent duplicates in our generated set
      }

      currentId++;
    }
  } else {
    // With fewer existing IDs, random generation might be more efficient
    let attempts = 0;
    const MAX_ATTEMPTS = count * 10; // Prevent infinite loops

    while (newIds.length < count && attempts < MAX_ATTEMPTS) {
      // Generate a random number between MIN_ID and MAX_ID
      const randomId =
        Math.floor(Math.random() * (MAX_ID - MIN_ID + 1)) + MIN_ID;
      const idString = randomId.toString().padStart(10, '0');

      if (!usedIds.has(idString)) {
        newIds.push(idString);
        usedIds.add(idString); // Prevent duplicates in our generated set
      }

      attempts++;

      // If we're struggling to find unique random IDs, switch to sequential
      if (attempts >= MAX_ATTEMPTS && newIds.length < count) {
        logger.warn('create_card_ids_switching_to_sequential', { remaining: count - newIds.length });

        // Find the next available ID
        let currentId = MIN_ID;
        while (newIds.length < count && currentId <= MAX_ID) {
          const idString = currentId.toString().padStart(10, '0');

          if (!usedIds.has(idString)) {
            newIds.push(idString);
            usedIds.add(idString);
          }

          currentId++;
        }
      }
    }
  }

  // Check if we were able to generate the requested number of IDs
  if (newIds.length < count) {
    throw new Error(
      `Could only generate ${newIds.length} unique IDs. The ID space may be exhausted.`
    );
  }

  return newIds;
}

export function isDateRangeOverlapping(start1, end1, start2, end2, boundaryAllowed = true) {
  const startDate1 = new Date(start1);
  const endDate1 = new Date(end1);
  const startDate2 = new Date(start2);
  const endDate2 = new Date(end2);

  // No overlap if one range ends before the other starts
  const noOverlap = boundaryAllowed
    ? endDate1 <= startDate2 || endDate2 <= startDate1
    : endDate1 < startDate2 || endDate2 < startDate1

  return !noOverlap;
}

export function isDateBlocked(blockedDate, startDate, endDate, boundaryAllowed) {  
  return isDateRangeOverlapping(
    blockedDate.checkin,
    blockedDate.checkout,
    startDate,
    endDate,
    boundaryAllowed
  );
}

export function validateBlockedDates(blockedDates, dateRanges) {
  const conflictingBlocks = [];
  for (const range of dateRanges) {
    for (const blockedDate of blockedDates) {
      if (isDateBlocked(blockedDate, range.start, range.end, range.overlappingWithUtsav)) {
        conflictingBlocks.push(
          `${moment(blockedDate.checkin).format('Do MMMM, YYYY')} to ${moment(
            blockedDate.checkout).format('Do MMMM, YYYY')}`
        );
      }
    }
  }

  if (conflictingBlocks.length > 0) {
    const blockingInfo = conflictingBlocks.join(',');
    throw new ApiError(
      400,
      `Dates are blocked during following periods: ${blockingInfo}`
    );
  }
}
