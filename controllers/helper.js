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
  STATUS_ACTIVE
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

export function retrieveBookingIds(userBookingIdMap) {
  return Object.values(userBookingIdMap).map(
    (bookingIdsByType) => Object.values(bookingIdsByType).flat()
  ).flat();
}

export async function sendUnifiedEmailForBookedBy(userBookingIdMap, bookedBy) {
  const flattenedMap = {};
let isSelfBooking = true;
Object.entries(userBookingIdMap).forEach(([cardNo, bookingInfo]) => {
  if(cardNo != bookedBy.cardno) {
    isSelfBooking = false;
  }
  Object.entries(bookingInfo).forEach(([bookingType, bookingIdArray]) => {
    if (!flattenedMap[bookingType]) {
      flattenedMap[bookingType] = [];
    }
    if (Array.isArray(bookingIdArray) && bookingIdArray.length > 0) {
      flattenedMap[bookingType].push(bookingIdArray[0]);
    }
  });
});
if( Object.getOwnPropertyNames(flattenedMap).length != 0){
sendUnifiedEmail(isSelfBooking ? bookedBy.cardNo : null, flattenedMap, bookedBy);
}
}

export async function sendUnifiedEmail(cardno, bookingIds, bookedBy = null) {
  let wasAdhyanBooked = bookingIds[TYPE_ADHYAYAN] != null;
  let wasRajprvasBooked = bookingIds[TYPE_TRAVEL] != null;
  let wasRoomBooked = bookingIds[TYPE_ROOM] != null;
  let wasFlatBooked = bookingIds[TYPE_FLAT] != null;
  let wasUtsavBooked = bookingIds[TYPE_UTSAV] != null;
 
  let adhyanBookingDetails = [],
    roomBookingDetails = [],
    travelBookingDetails = [],
    flatBookingDetails = [],includeProfile = false,user;

    if(cardno == null) {
      includeProfile = true;
    } else{
      user = await CardDb.findOne({
        where: { cardno }
      });
    } 
  
    if(wasUtsavBooked) {
      const utsavBookings = await UtsavBooking.findAll({
        
        include: [
          {
            model: UtsavDb,
            attributes: ['name'],
            as: 'utsav',
            where: { id: Sequelize.col('UtsavBookingDb.utsav_id') }
          },
          {
            model: UtsavPackagesDb,
            attributes: ['name'] ,
            as: 'package',
            where: { id: Sequelize.col('UtsavBookingDb.packageid') }
          },
          includeProfile ? {
            model: CardDb,
            attributes: ['issuedto'],
            where: { cardno: Sequelize.col('UtsavBookingDb.cardno') },
          } : null,
        ],
        where: { bookingId: { [Sequelize.Op.in]: bookingIds[TYPE_UTSAV] } }
      });
      utsavBookings.forEach((utsavBooking) => {
        utsavBookingDetails.push({
          name: user ? user.issuedto : utsavBooking.dataValues.CardDb.issuedto,
          utsavname: utsavBooking.dataValues.UtsavDb.name,
          status: utsavBooking.status,
          bookingid: utsavBooking.bookingid,
          checkin: moment(utsavBooking.checkin).format('Do MMMM, YYYY'),
          checkout: moment(utsavBooking.checkout).format('Do MMMM, YYYY'),
          package: utsavBooking.dataValues.UtsavPackagesDb.name,
        });
      });
    }
  //GetData for adhyan
  if (wasAdhyanBooked) {
    const adhyanBookings = await ShibirBookingDb.findAll({
      include: [
        includeProfile ? {
          model: CardDb,
          attributes: ['issuedto'],
          where: { '$ShibirBookingDb.cardno$': Sequelize.col('carddb.cardNo') }
        } : null, 
        {
          model: ShibirDb,
          attributes: ['name', 'speaker', 'month', 'start_date', 'end_date'],
          where: { id: Sequelize.col('ShibirBookingDb.shibir_id') }
        }
      ],
      where: {
        bookingId: { [Sequelize.Op.in]: bookingIds[TYPE_ADHYAYAN] }
      }
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
    if(includeProfile) {
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
      }
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
    if(includeProfile) {
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
      }
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
    if(includeProfile) {
      includeOptions.push({
        model: CardDb,
        attributes: ['issuedto'],
        as: 'flatBookingsByCardNo',
      });
    }
    const flatBookings = await FlatBooking.findAll({
      include: includeOptions, 
      where: {
        bookingid: { [Sequelize.Op.in]: bookingIds[TYPE_FLAT] }
      }
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

  const email = user && user.email ? user.email : bookedBy.email;
  const name = user && user.issuedto ? user.issuedto : bookedBy.issuedto;
  if (email) {
    sendMail({
      email: email,
      subject: `Your Booking Confirmation for Stay at SRATRC`,
      template: 'unifiedBookingEmail',
      context: {
        showAdhyanDetail: wasAdhyanBooked,
        showRoomDetail: wasRoomBooked,
        showTravelDetail: wasRajprvasBooked,
        showFlatDetail: wasFlatBooked,
        name: name,
        roomBookingDetails,
        adhyanBookingDetails,
        travelBookingDetails,
        flatBookingDetails
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
