import {
  RoomBooking,
  FlatBooking,
  FoodDb,
  ShibirBookingDb,
  ShibirDb,
  TravelDb,
  CardDb,
  GuestRelationship
} from '../models/associations.js';
import {
  STATUS_WAITING,
  ROOM_STATUS_CHECKEDIN,
  ROOM_STATUS_PENDING_CHECKIN,
  STATUS_CONFIRMED,
  TYPE_ROOM,
  TYPE_TRAVEL,
  TYPE_ADHYAYAN,
  ERR_INVALID_DATE,
  TYPE_FLAT,
  STATUS_GUEST
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

export async function checkFlatAlreadyBookedForGuest(
  checkin,
  checkout,
  guest_id
) {
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
      cardno: guest_id
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

export function findClosestSum(arr, target) {
  let closestSum = null;
  let closestIndices = null;

  function findExactSum(
    arr,
    n,
    target,
    currentSum = 0,
    currentIndices = [],
    index = 0
  ) {
    if (currentSum === target) {
      closestSum = currentSum;
      closestIndices = [...currentIndices];
      return true;
    }
    if (index === n || currentSum > target) {
      return false;
    }

    return (
      findExactSum(
        arr,
        n,
        target,
        currentSum + arr[index],
        [...currentIndices, index],
        index + 1
      ) || findExactSum(arr, n, target, currentSum, currentIndices, index + 1)
    );
  }

  function findClosestSubsetSum(
    arr,
    target,
    index,
    currentSum,
    currentIndices
  ) {
    if (index === arr.length) {
      if (
        closestSum === null ||
        Math.abs(target - currentSum) < Math.abs(target - closestSum)
      ) {
        closestSum = currentSum;
        closestIndices = [...currentIndices];
      }
      return;
    }

    findClosestSubsetSum(arr, target, index + 1, currentSum, currentIndices);
    findClosestSubsetSum(arr, target, index + 1, currentSum + arr[index], [
      ...currentIndices,
      index
    ]);
  }

  if (arr.includes(target)) {
    closestSum = target;
    closestIndices = [arr.indexOf(target)];
    return { closestSum, closestIndices };
  }

  if (findExactSum(arr, arr.length, target)) {
    return { closestSum, closestIndices };
  }

  findClosestSubsetSum(arr, target, 0, 0, []);

  return { closestSum, closestIndices };
}

export async function checkGuestRoomAlreadyBooked(checkin, checkout, guests) {
  const result = await RoomBooking.findAll({
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
      cardno: guests,
      status: {
        [Sequelize.Op.in]: [
          STATUS_WAITING,
          ROOM_STATUS_CHECKEDIN,
          ROOM_STATUS_PENDING_CHECKIN
        ]
      }
    }
  });

  if (result.length > 0) {
    return true;
  } else {
    return false;
  }
}

export async function checkGuestFoodAlreadyBooked(
  start_date,
  end_date,
  guests
) {
  const startDate = new Date(start_date);
  const endDate = new Date(end_date);

  const allDates = getDates(startDate, endDate);
  const food_bookings = await FoodDb.findAll({
    where: {
      date: { [Sequelize.Op.in]: allDates },
      guest: { [Sequelize.Op.in]: guests }
    }
  });

  if (food_bookings.length > 0) return true;
  else return false;
}

export async function checkGuestSpecialAllowance(start_date, end_date, guests) {
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
      guest: guests,
      status: STATUS_CONFIRMED
    }
  });

  if (adhyayans) {
    for (var data of adhyayans) {
      if (data.dataValues.ShibirDb.dataValues.food_allowed == 1) return true;
    }
  }

  return false;
}

export async function sendUnifiedEmail(user, bookingIds) {
  let wasAdhyanBooked = bookingIds[TYPE_ADHYAYAN] != null;
  let wasRajprvasBooked = bookingIds[TYPE_TRAVEL] != null;
  let wasRoomBooked = bookingIds[TYPE_ROOM] != null;
  let wasFlatBooked = bookingIds[TYPE_FLAT] != null;
  let adhyanBookingDetails = [],
    roomBookingDetails = [],
    travelBookingDetails = [],
    flatBookingDetails = [];
  //GetData for adhyan
  let idx = 0;
  if (wasAdhyanBooked) {
    const adhyanBookings = await ShibirBookingDb.findAll({
      include: [
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
    idx = 0;
    adhyanBookings.forEach((adhyanBooking) => {
      adhyanBookingDetails[idx++] = {
        bookingid: adhyanBooking.bookingid,
        name: adhyanBooking.dataValues.ShibirDb.name,
        speaker: adhyanBooking.dataValues.ShibirDb.speaker,
        startdate: adhyanBooking.dataValues.ShibirDb.start_date,
        enddate: adhyanBooking.dataValues.ShibirDb.end_date,
        status: adhyanBooking.status
      };
    });
  }
  if (wasRajprvasBooked) {
    const travelBookings = await TravelDb.findAll({
      where: {
        bookingId: { [Sequelize.Op.in]: bookingIds[TYPE_TRAVEL] }
      }
    });

    idx = 0;
    travelBookings.forEach((travelBooking) => {
      travelBookingDetails[idx++] = {
        bookingid: travelBooking.bookingid,
        date: travelBooking.date,
        pickuppoint: travelBooking.pickup_point,
        dropoffpoint: travelBooking.drop_point
      };
    });
  }

  if (wasRoomBooked) {
    const roomBookings = await RoomBooking.findAll({
      where: {
        bookingid: { [Sequelize.Op.in]: bookingIds[TYPE_ROOM] }
      }
    });
    idx = 0;
    roomBookings.forEach((roomBooking) => {
      roomBookingDetails[idx++] = {
        bookingid: roomBooking.bookingid,
        checkin: roomBooking.checkin,
        checkout: roomBooking.checkout
      };
    });
  }

  if (wasFlatBooked) {
    const flatBookings = await FlatBooking.findAll({
      where: {
        bookingid: { [Sequelize.Op.in]: bookingIds[TYPE_FLAT] }
      }
    });

    idx = 0;
    flatBookings.forEach((flatBooking) => {
      flatBookingDetails[idx++] = {
        bookingid: flatBooking.bookingid,
        flatno: flatBooking.flatno,
        checkin: flatBooking.checkin,
        checkout: flatBooking.checkout
      };
    });
  }

  const userInfo = await CardDb.findOne({
    where: {
      cardno: user.cardno
    }
  });

  //send email to me
  sendMail({
    email: userInfo.email,

    subject: `Your Booking Confirmation for Stay at SRATRC`,

    template: 'unifiedBookingEmail',

    context: {
      showAdhyanDetail: wasAdhyanBooked,
      showRoomDetail: wasRoomBooked,
      showTravelDetail: wasRajprvasBooked,
      showFlatDetail: wasFlatBooked,
      name: userInfo.issuedto,
      roomBookingDetails,
      adhyanBookingDetails,
      travelBookingDetails,
      flatBookingDetails
    }
  });

  //send email
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
