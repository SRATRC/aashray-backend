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
  ERR_DATES_NOT_BETWEEN_UTSAV,
  RAJ_PRAVAS_EMAIL,
  BOOKING_STATUS_PENDING
} from '../config/constants.js';
import Sequelize from 'sequelize';
import getDates from '../utils/getDates.js';
import moment from 'moment';
import ApiError from '../utils/ApiError.js';
import BlockDates from '../models/block_dates.model.js';
import sendMail from '../utils/sendMail.js';

export async function getBlockedDates(checkin_date, checkout_date) {
  const startDate = new Date(checkin_date);
  const endDate = new Date(checkout_date);

  const blockedDates = await BlockDates.findAll({
    where: {
      status: STATUS_ACTIVE,
      [Sequelize.Op.or]: [
        {
          [Sequelize.Op.and]: [
            { checkin: { [Sequelize.Op.lte]: startDate } },
            { checkout: { [Sequelize.Op.gte]: startDate } }
          ]
        },
        {
          [Sequelize.Op.and]: [
            { checkin: { [Sequelize.Op.lte]: endDate } },
            { checkout: { [Sequelize.Op.gte]: endDate } }
          ]
        },
        {
          [Sequelize.Op.and]: [
            { checkin: { [Sequelize.Op.gte]: startDate } },
            { checkin: { [Sequelize.Op.lte]: endDate } }
          ]
        }
      ]
    }
  });

  return blockedDates;
}

export async function checkFlatAlreadyBooked(checkin, checkout, card_no) {
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
      cardno: card_no
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

export async function checkSpecialAllowance(start_date, end_date, cardno) {
  const adhyayans = await ShibirBookingDb.findAll({
    include: [
      {
        model: ShibirDb,
        where: {
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

  for (var data of adhyayans) {
    if (data.dataValues.ShibirDb.dataValues.food_allowed == 1) return true;
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
  subject,
  bookingStatus,
  welcomeMessage
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
      subject,
      bookingStatus,
      welcomeMessage
    );
  }
}

export async function sendUnifiedEmail(
  cardno,
  bookingIds,
  bookedBy,
  subject = 'Vitraag Vigyaan Aashray: Bookings Confirmed',
  bookingStatus = 'Confirmed',
  welcomeMessage = 'We are pleased to inform you that your bookings have been confirmed.',
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
        bookingId: { [Sequelize.Op.in]: bookingIds[TYPE_ADHYAYAN] }
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
  if (
    country &&
    country != 'India' &&
    bookingStatus == BOOKING_STATUS_PENDING
  ) {
    welcomeMessage =
      'Your bookings are temporarily reserved. NRIs can make payments for bookings at the Research Center upon arrival.';
  }

  const email = user && user.email ? user.email : bookedBy && bookedBy.email;
  const name =
    user && user.issuedto ? user.issuedto : bookedBy && bookedBy.issuedto;
  
  if (email) {
    sendMail({
      email: email,
      subject,
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
  if(wasRajprvasBooked && cardno != null && ['prod'].includes(process.env.NODE_ENV)){
    sendMail({
      email: RAJ_PRAVAS_EMAIL,
      subject: "Vitraag Vigyaan Aashray: "+name,
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
        console.warn(
          `Random generation inefficient, switching to sequential for remaining ${
            count - newIds.length
          } IDs`
        );

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

// Validate that at least one of the selected dates intersects the Utsav period.
// Completely outside Utsav bookings are now permitted, so we only restrict a booking
// if it ends before it even starts or starts after it ends (i.e. an invalid range).
export function validateBookingDatesBetweenUtsav(start_date, end_date, utsav) {
  if (!utsav) return;

  const start = new Date(start_date);
  const end = new Date(end_date);
  const utsavStart = new Date(utsav.start_date);
  const utsavEnd = new Date(utsav.end_date);

  if (start > end) {
    throw new ApiError(400, ERR_DATES_NOT_BETWEEN_UTSAV);
  }
  // No further restrictions – bookings completely outside the Utsav period are allowed.
}
