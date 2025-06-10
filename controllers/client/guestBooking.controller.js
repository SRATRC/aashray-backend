import {
  ShibirDb,
  ShibirBookingDb,
  RoomBooking,
  Transactions,
  CardDb,
  GuestRelationship,
  FlatDb,
  UtsavDb
} from '../../models/associations.js';
import {
  STATUS_PAYMENT_PENDING,
  TYPE_EXPENSE,
  STATUS_AVAILABLE,
  TYPE_ROOM,
  STATUS_CONFIRMED,
  STATUS_WAITING,
  TYPE_FOOD,
  TYPE_ADHYAYAN,
  TYPE_GUEST_ADHYAYAN,
  ERR_INVALID_BOOKING_TYPE,
  ERR_ROOM_NO_BED_AVAILABLE,
  ERR_ROOM_ALREADY_BOOKED,
  ERR_ROOM_FAILED_TO_BOOK,
  ERR_ADHYAYAN_NOT_FOUND,
  LUNCH_PRICE,
  BREAKFAST_PRICE,
  DINNER_PRICE,
  MSG_BOOKING_SUCCESSFUL,
  MSG_UPDATE_SUCCESSFUL,
  STATUS_GUEST,
  TYPE_GUEST_ROOM,
  STATUS_OPEN,
  TYPE_UTSAV,
  TYPE_FLAT,
  MSG_BOOKING_WAITING
} from '../../config/constants.js';
import {
  calculateNights,
  validateDate,
  createGuestsHelper,
  setBookingIdMap,
  retrieveBookingIds,
  sendUnifiedEmail,
  sendUnifiedEmailForBookedBy,
  checkFlatAlreadyBooked,
  setWaitingBookingCountMap,
  validateBookingDatesBetweenUtsav
} from '../helper.js';
import { v4 as uuidv4 } from 'uuid';
import {
  bookDayVisit,
  checkRoomAlreadyBooked,
  findRoom,
  roomCharge,
  bookRoomDuringUtsavForGuests,
  createFlatBooking,
  checkRoomAvailabilityDuringUtsav
} from '../../helpers/roomBooking.helper.js';
import {
  createPendingTransaction,
  generateOrderId,
  updateRazorpayTransactions,
  usableCredits
} from '../../helpers/transactions.helper.js';
import database from '../../config/database.js';
import Sequelize from 'sequelize';
import getDates from '../../utils/getDates.js';
import ApiError from '../../utils/ApiError.js';
import {
  bookFoodForGuests,
  getFoodBookings
} from '../../helpers/foodBooking.helper.js';
import {
  validateUtsavs,
  bookUtsavForMumukshus
} from '../../helpers/utsavBooking.helper.js';
import { checkAdhyayanAlreadyBooked } from '../../helpers/adhyayanBooking.helper.js';

export const guestBooking = async (req, res) => {
  const { primary_booking, addons } = req.body;
  var t = await database.transaction();
  req.transaction = t;

  let amount = 0;
  const userBookingIdMap = {};
  const waitingBookingCountMap = {};
  const transactionIds = [];
  
  switch (primary_booking.booking_type) {
    case TYPE_ROOM:
      const roomResult = await bookRoom(primary_booking, t, req.user);
      amount += roomResult.amount;
      setBookingIdMap(userBookingIdMap, TYPE_ROOM, roomResult.userBookingIds);
      break;

    case TYPE_FOOD:
      const foodResult = await bookFood(primary_booking, t, req.user);
      amount += foodResult.amount;
      transactionIds.push(...foodResult.transactionIds);
      break;

    case TYPE_ADHYAYAN:
      const adhyayanResult = await bookAdhyayan(primary_booking, t, req.user);
      amount += adhyayanResult.amount;
      setBookingIdMap(
        userBookingIdMap,
        TYPE_ADHYAYAN,
        adhyayanResult.userBookingIds
      );
      setWaitingBookingCountMap(
        waitingBookingCountMap,
        TYPE_ADHYAYAN,
        adhyayanResult.waitingBookingCount,
        adhyayanResult.userBookingIds
      );
      break;

    case TYPE_UTSAV:
      const utsavResult = await bookUtsav(primary_booking, t, req.user);
      amount += utsavResult.amount;
      setBookingIdMap(userBookingIdMap, TYPE_UTSAV, utsavResult.userBookingIds);
      setWaitingBookingCountMap(
        waitingBookingCountMap,
        TYPE_UTSAV,
        utsavResult.waitingBookingCount,
        utsavResult.userBookingIds
      );
      break;

    default:
      throw new ApiError(400, ERR_INVALID_BOOKING_TYPE);
  }

  if (addons) {
    for (const addon of addons) {
      switch (addon.booking_type) {
        case TYPE_ROOM:
          const roomResult = await bookRoom(primary_booking, addon, t, req.user);
          amount += roomResult.amount;
          setBookingIdMap(
            userBookingIdMap,
            TYPE_ROOM,
            roomResult.userBookingIds
          );
          break;

        case TYPE_FOOD:
          const foodResult = await bookFood(primary_booking,addon, t, req.user);
          amount += foodResult.amount;
          transactionIds.push(...foodResult.transactionIds);
          break;

        case TYPE_ADHYAYAN:
          const adhyayanResult = await bookAdhyayan(addon, t, req.user);
          amount += adhyayanResult.amount;
          setBookingIdMap(
            userBookingIdMap,
            TYPE_ADHYAYAN,
            adhyayanResult.userBookingIds
          );
          setWaitingBookingCountMap(
            waitingBookingCountMap,
            TYPE_ADHYAYAN,
            adhyayanResult.waitingBookingCount,
            adhyayanResult.userBookingIds
          );
          break;

        default:
          throw new ApiError(400, ERR_INVALID_BOOKING_TYPE);
      }
    }
  }

  const order = await generateOrderId(amount);
  const bookingIds = retrieveBookingIds(userBookingIdMap);
  await updateRazorpayTransactions(bookingIds, transactionIds, order.id, t);

  await t.commit();

  //Sending email to logged in user for self or other mumkshus
  sendUnifiedEmailForBookedBy(userBookingIdMap, req.user);
  for (const cardno in userBookingIdMap) {
    if (cardno != req.user.cardno) {
      const bookings = userBookingIdMap[cardno];
      //Sending email to other mumkshu & Guest
      sendUnifiedEmail(cardno, bookings, req.user);
    }
  }
  let message = MSG_BOOKING_SUCCESSFUL;
  if (Object.keys(waitingBookingCountMap).length > 0) {
    message = MSG_BOOKING_WAITING;
  }
  return res.status(200).send({
    message: message,
    data: order,
    waitingBookingCountMap: waitingBookingCountMap
  });
};

export const validateBooking = async (req, res) => {
  const { primary_booking, addons } = req.body;

  const response = {
    roomDetails: [],
    adhyayanDetails: [],
    foodDetails: {},
    utsavDetails: [],
    totalCharge: 0
  };

  var utsav = null;
  if(primary_booking.booking_type == TYPE_UTSAV) {
    utsav = await UtsavDb.findOne({
      where: {
        id: primary_booking.details.utsavid
      }
    });
  }
  switch (primary_booking.booking_type) {
    case TYPE_ROOM:
      response.roomDetails = await checkRoomAvailability(
        req.body.primary_booking,
        req.user,
        utsav
      );
      response.totalCharge += response.roomDetails.reduce(
        (partialSum, room) => partialSum + room.charge,
        0
      );
      break;

    case TYPE_FOOD:
      response.foodDetails = await checkFoodAvailability(
        req.body.primary_booking,
        utsav
      );
      response.totalCharge += response.foodDetails.charge;
      break;

    case TYPE_ADHYAYAN:
      response.adhyayanDetails = await checkAdhyayanAvailability(
        req.body.primary_booking
      );
      response.totalCharge += response.adhyayanDetails.reduce(
        (partialSum, adhyayan) => partialSum + adhyayan.charge,
        0
      );
      break;

    case TYPE_UTSAV:
      response.utsavDetails = await validateUtsavs(
        req.body.primary_booking.details.utsavid,
        req.body.primary_booking.details.guests
      );
      response.totalCharge += response.utsavDetails.reduce(
        (partialSum, utsav) => partialSum + utsav.charge,
        0
      );
      break;

    default:
      throw new ApiError(400, ERR_INVALID_BOOKING_TYPE);
  }

  if (addons) {
    for (const addon of addons) {
      switch (addon.booking_type) {
        case TYPE_ROOM:
          response.roomDetails = await checkRoomAvailability(addon, req.user, utsav);
          response.totalCharge += response.roomDetails.reduce(
            (partialSum, room) => partialSum + room.charge,
            0
          );
          break;

        case TYPE_FOOD:
          response.foodDetails = await checkFoodAvailability(addon, utsav);
          response.totalCharge += response.foodDetails.charge;
          break;

        case TYPE_ADHYAYAN:
          response.adhyayanDetails = await checkAdhyayanAvailability(addon);
          response.totalCharge += response.adhyayanDetails.reduce(
            (partialSum, adhyayan) => partialSum + adhyayan.charge,
            0
          );
          break;

        //TODO: add travel for utsavs

        default:
          throw new ApiError(400, ERR_INVALID_BOOKING_TYPE);
      }
    }
  }

  return res.status(200).send({
    data: response
  });
};

async function checkRoomAvailability(data, user, utsav) {
  const { checkin_date, checkout_date, guestGroup } = data.details;
  validateDate(checkin_date, checkout_date);


  validateBookingDatesBetweenUtsav(checkin_date, checkout_date, utsav);
 

  const nights = await calculateNights(checkin_date, checkout_date);

  const totalGuests = guestGroup.flatMap((group) => group.guests);
  const guest_db = await CardDb.findAll({
    attributes: ['cardno', 'issuedto', 'gender'],
    where: { cardno: totalGuests }
  });
  const guest_details = guest_db.map((guest) => guest.dataValues);

  if (
    await checkRoomAlreadyBooked(checkin_date, checkout_date, ...totalGuests)
  ) {
    throw new ApiError(400, ERR_ROOM_ALREADY_BOOKED);
  }

  var roomDetails = [];
  for (const group of guestGroup) {
    const { roomType, floorType, guests } = group;

    for (const guest of guests) {
      const gender = floorType
        ? floorType +
          guest_details.filter((item) => item.cardno == guest)[0].gender
        : guest_details.filter((item) => item.cardno == guest)[0].gender;

      if(utsav){
        roomDetails.push(...await checkRoomAvailabilityDuringUtsav(checkin_date, checkout_date, roomType, gender, utsav,guest,user));
      }else{
      var status = STATUS_WAITING;
      var charge = 0;
      var availableCredits = 0;

      
      if (nights > 0) {
        const room = await findRoom(
          checkin_date,
          checkout_date,
          roomType,
          gender
        );

        if (room) {
          status = STATUS_AVAILABLE;
          charge = roomCharge(roomType) * nights;
          availableCredits = usableCredits(user, TYPE_ROOM, charge);
        }
      } else {
        status = STATUS_AVAILABLE;
      }

      roomDetails.push({
        guestId: guest,
        status,
        charge,
        availableCredits
        });
      }
    }
  }

  return roomDetails;
}

async function bookUtsav(data, t, user) {
  const { utsavid, guests } = data.details;

  const result = await bookUtsavForMumukshus(utsavid, guests, t, user);

  return result;
}

async function bookRoom(primary_booking,data, t, user) {
  const { checkin_date, checkout_date, guestGroup } = data.details;

  validateDate(checkin_date, checkout_date);

  let amount = 0;
  let userBookingIds = {};

  const nights = await calculateNights(checkin_date, checkout_date);
  const totalGuests = guestGroup.flatMap((group) => group.guests);

  const guest_db = await CardDb.findAll({
    attributes: ['cardno', 'issuedto', 'gender'],
    where: { cardno: totalGuests, res_status: STATUS_GUEST }
  });

  if (guest_db.length != totalGuests.length) {
    throw new ApiError(404, 'Guest not found');
  }

  const guest_details = guest_db.map((guest) => guest.dataValues);

  if (
    await checkRoomAlreadyBooked(checkin_date, checkout_date, ...totalGuests)
  ) {
    throw new ApiError(400, ERR_ROOM_ALREADY_BOOKED);
  }

  if (primary_booking.booking_type == TYPE_UTSAV) {
    const { utsavid, guests } = primary_booking.details;
    let result = await bookRoomDuringUtsavForGuests(
      utsavid,
      guestGroup,
      t,
      user,
      checkin_date,
      checkout_date
    );
    amount += result.amount;
    userBookingIds = result.userBookingIds;
    return { amount, userBookingIds };
  } else {
    for (const group of guestGroup) {
      const { roomType, floorType, guests } = group;
      let result = {};
      for (const guest of guests) {
        if (nights == 0) {
          result = await bookDayVisit(
            guest,
            checkin_date,
            checkout_date,
            user.cardno,
            user.cardno,
            t
          );
        } else {
          result = await bookRoomForSingleGuest(
            user,
            guest,
            guest_details,
            checkin_date,
            checkout_date,
            roomType,
            floorType,
            nights,
            t
          );
          amount += result.discountedAmount;
        }
        userBookingIds[guest] = [result.bookingId];
      }
    }
  }
  return { amount, userBookingIds };
}

async function bookRoomForSingleGuest(
  user,
  guest,
  guest_details,
  checkin,
  checkout,
  roomtype,
  floor_type,
  nights,
  t
) {
  const gender = floor_type
    ? floor_type +
      guest_details.filter((item) => item.cardno == guest)[0].gender
    : guest_details.filter((item) => item.cardno == guest)[0].gender;

  const roomno = await findRoom(checkin, checkout, roomtype, gender);

  if (!roomno) {
    throw new ApiError(400, ERR_ROOM_NO_BED_AVAILABLE);
  }

  let bookingId = uuidv4();
  const booking = await RoomBooking.create(
    {
      bookingid: bookingId,
      cardno: guest,
      bookedBy: user.cardno,
      roomno: roomno.dataValues.roomno,
      checkin,
      checkout,
      nights,
      roomtype,
      gender,
      status: STATUS_PAYMENT_PENDING,
      updatedBy: user.cardno
    },
    { transaction: t }
  );

  if (!booking) {
    throw new ApiError(400, ERR_ROOM_FAILED_TO_BOOK);
  }

  const amount = roomCharge(roomtype) * nights;

  const { transaction, discountedAmount } = await createPendingTransaction(
    user,
    booking,
    TYPE_GUEST_ROOM,
    amount,
    user.cardno,
    t
  );

  if (!transaction) {
    throw new ApiError(400, ERR_ROOM_FAILED_TO_BOOK);
  }

  return { t, discountedAmount, bookingId };
}

async function checkFoodAvailability(data, utsav) {
  const { start_date, end_date, guestGroup } = data.details;

  validateDate(start_date, end_date);
  validateBookingDatesBetweenUtsav(start_date, end_date, utsav);

  let allDates = [];
  if(utsav) {
    
    const event_start_date = utsav.start_date;
    const event_end_date =  utsav.end_date;
    
    if (new Date(start_date) < event_start_date) {
      const beforeEventDates = getDates(start_date, event_start_date);
      beforeEventDates.pop(); // Remove the event start date
      allDates = [...allDates, ...beforeEventDates];
    }

    if (new Date(end_date) > event_end_date) {
      const afterEventDates = getDates(event_end_date, end_date);
      afterEventDates.shift(); // Remove the event end date
      allDates = [...allDates, ...afterEventDates];
    }

  }else{
    allDates = getDates(start_date, end_date);
  }

  const guests = guestGroup.flatMap((group) => group.guests);
  
  const bookings = await getFoodBookings(allDates, guests);

  var charge = 0;
  for (const group of guestGroup) {
    const { meals, guests } = group;

    for (const date of allDates) {
      for (const guest of guests) {
        const booking = bookings[guest] && bookings[guest][date];

        if (booking) {
          // Only charge for meals that weren't previously booked
          charge +=
            meals.includes('breakfast') && !booking.breakfast
              ? BREAKFAST_PRICE
              : 0;
          charge += meals.includes('lunch') && !booking.lunch ? LUNCH_PRICE : 0;
          charge +=
            meals.includes('dinner') && !booking.dinner ? DINNER_PRICE : 0;
        } else {
          // Charge for all new meals
          charge += meals.includes('breakfast') ? BREAKFAST_PRICE : 0;
          charge += meals.includes('lunch') ? LUNCH_PRICE : 0;
          charge += meals.includes('dinner') ? DINNER_PRICE : 0;
        }
      }
    }
  }

  return {
    status: STATUS_AVAILABLE,
    charge
  };
}

 

async function bookFood(primary_booking,data, t, user) {
  const { start_date, end_date, guestGroup } = data.details;
  const utsavid = primary_booking.booking_type == TYPE_UTSAV ? primary_booking.details.utsavid : null;
  
  const result = await bookFoodForGuests(
    start_date,
    end_date,
    guestGroup,
    user.cardno,
    user.cardno,
    t,
    utsavid
  );

  return result;
}

async function checkAdhyayanAvailability(data) {
  const { shibir_ids, guests } = data.details;

  const shibirs = await ShibirDb.findAll({
    where: {
      id: {
        [Sequelize.Op.in]: shibir_ids
      }
    }
  });

  if (shibirs.length != shibir_ids.length) {
    throw new ApiError(400, ERR_ADHYAYAN_NOT_FOUND);
  }

  await checkAdhyayanAlreadyBooked(shibir_ids, ...guests);

  var adhyayanDetails = [];
  for (var shibir of shibirs) {
    var available = 0;
    var waiting = 0;
    var charge = 0;

    if (shibir.dataValues.status == STATUS_OPEN) {
      available = Math.min(shibir.dataValues.available_seats, guests.length);
      charge = available * shibir.dataValues.amount;
      waiting = guests.length - available;
    } else {
      waiting = guests.length;
    }

    adhyayanDetails.push({
      shibirId: shibir.dataValues.id,
      available: available,
      waiting: waiting,
      charge: charge
    });
  }

  return adhyayanDetails;
}

async function bookAdhyayan(data, t, user) {
  const { shibir_ids, guests } = data.details;
  const userBookingIds = {};

  let amount = 0,
    idx = 0;

  await checkAdhyayanAlreadyBooked(shibir_ids, ...guests);

  const shibirs = await ShibirDb.findAll({
    where: {
      id: {
        [Sequelize.Op.in]: shibir_ids
      }
    }
  });

  if (shibirs.length != shibir_ids.length) {
    throw new ApiError(400, ERR_ADHYAYAN_NOT_FOUND);
  }

  var booking_data = [];
  var transaction_data = [];
  var waitingBookingCount = 0;
  for (const guest of guests) {
    const bookingIds = [];
    for (var shibir of shibirs) {
      const bookingid = uuidv4();

      if (shibir.available_seats > 0 && shibir.status == STATUS_OPEN) {
        booking_data.push({
          bookingid: bookingid,
          shibir_id: shibir.dataValues.id,
          cardno: guest,
          bookedBy: user.cardno,
          status:
            shibir.dataValues.amount > 0
              ? STATUS_PAYMENT_PENDING
              : STATUS_CONFIRMED,
          updatedBy: user.cardno
        });

        shibir.available_seats -= 1;
        await shibir.save({ transaction: t });

        if (shibir.dataValues.amount > 0) {
          transaction_data.push({
            cardno: user.cardno,
            bookingid: bookingid,
            category: TYPE_GUEST_ADHYAYAN,
            type: TYPE_EXPENSE,
            amount: shibir.dataValues.amount,
            status: STATUS_PAYMENT_PENDING,
            updatedBy: user.cardno
          });

          amount += shibir.dataValues.amount;
        }
      } else {
        bookingIds[idx++] = bookingid;
        booking_data.push({
          bookingid: bookingid,
          shibir_id: shibir.dataValues.id,
          cardno: guest,
          bookedBy: user.cardno,
          status: STATUS_WAITING,
          updatedBy: user.cardno
        });
        waitingBookingCount++;
      }

      bookingIds.push(bookingid);
    }

    userBookingIds[guest] = bookingIds;
  }

  await ShibirBookingDb.bulkCreate(booking_data, { transaction: t });
  await Transactions.bulkCreate(transaction_data, { transaction: t });

  return { amount, userBookingIds, waitingBookingCount };
}

export const guestBookingFlat = async (req, res) => {
  const { guests, startDay, endDay } = req.body;

  const flatDb = await FlatDb.findOne({
    attributes: ['flatno'],
    where: {
      owner: req.user.cardno
    }
  });

  if (!flatDb) throw new ApiError(404, 'Flat not found');

  validateDate(startDay, endDay);

  for (var guest of guests) {
    if (await checkFlatAlreadyBooked(startDay, endDay, guest))
      throw new ApiError(400, `flat already Booked for ${guest}`);
  }

  const nights = await calculateNights(startDay, endDay);
  var t = await database.transaction();

  let amount = 0;
  const bookingIds = [],
    userBookingIdMap = {};

  for (var guest of guests) {
    const result = await createFlatBooking(
      guest,
      startDay,
      endDay,
      nights,
      flatDb.dataValues.flatno,
      req.user,
      t
    );
    amount += result.discountedAmount;
    userBookingIdMap[guest] = [result.bookingId];
    bookingIds.push(result.bookingId);
  }

  const order = await generateOrderId(amount);

  await updateRazorpayTransactions(bookingIds, [], order.id, t);
  await t.commit();

  sendUnifiedEmail(null, { [TYPE_FLAT]: bookingIds }, req.user);

  Object.entries(userBookingIdMap)
    .filter(([guestCardNo]) => guestCardNo !== req.user.cardno) // Filter out the current user's cardno
    .forEach(([guestCardNo, bookings]) => {
      // Create the single-entry bookingMap object directly when calling the function
      sendUnifiedEmail(guestCardNo, { [TYPE_FLAT]: bookings }, req.user);
    });

  return res.status(200).send({ message: MSG_BOOKING_SUCCESSFUL, data: order });
};

export const fetchGuests = async (req, res) => {
  const { cardno } = req.user;

  const guests = await CardDb.findAll({
    attributes: ['cardno', 'issuedto', 'mobno', 'gender', 'updatedAt'],
    include: [
      {
        model: GuestRelationship,
        where: { cardno: cardno },
        attributes: ['type']
      }
    ],
    raw: true,
    order: [['updatedAt', 'DESC']],
    limit: 10
  });

  return res.status(200).send({
    message: 'fetched results',
    data: guests
  });
};

export const createGuests = async (req, res) => {
  const { cardno } = req.user;
  const { guests } = req.body;

  const t = await database.transaction();
  req.transaction = t;

  const allGuests = await createGuestsHelper(cardno, guests, t);

  await t.commit();

  return res.status(200).send({
    message: MSG_UPDATE_SUCCESSFUL,
    guests: allGuests
  });
};

export const checkGuests = async (req, res) => {
  const { mobno } = req.params;

  const user = await CardDb.findOne({
    attributes: ['cardno', 'issuedto', 'mobno', 'gender', 'email'],
    where: { mobno: mobno }
  });
  if (!user) {
    return res.status(200).send({ message: 'Guest not found', data: null });
  }

  if (user.res_status == STATUS_GUEST) {
    return res.status(200).send({ message: 'Guest found', data: user });
  } else {
    throw new ApiError(401, 'User is not a guest');
  }
};
