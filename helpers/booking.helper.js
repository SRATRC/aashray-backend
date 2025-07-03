import {
  FlatBooking,
  FoodDb,
  RoomBooking,
  ShibirBookingDb,
  TravelDb,
  UtsavBooking
} from '../models/associations.js';
import {
  TYPE_ADHYAYAN,
  TYPE_GUEST_ADHYAYAN,
  TYPE_FLAT,
  TYPE_ROOM,
  TYPE_GUEST_ROOM,
  TYPE_GUEST_BREAKFAST,
  TYPE_GUEST_LUNCH,
  TYPE_GUEST_DINNER,
  TYPE_TRAVEL,
  TYPE_UTSAV,
  TYPE_GUEST_UTSAV,
  TYPE_FOOD,
  ERR_INVALID_BOOKING_TYPE
} from '../config/constants.js';
import ApiError from '../utils/ApiError.js';

const bookingTypeMap = {
  [TYPE_ROOM]: TYPE_ROOM,
  [TYPE_GUEST_ROOM]: TYPE_ROOM,
  [TYPE_FLAT]: TYPE_FLAT,
  [TYPE_ADHYAYAN]: TYPE_ADHYAYAN,
  [TYPE_GUEST_ADHYAYAN]: TYPE_ADHYAYAN,
  [TYPE_GUEST_BREAKFAST]: TYPE_GUEST_BREAKFAST || TYPE_FOOD,
  [TYPE_GUEST_LUNCH]: TYPE_GUEST_LUNCH || TYPE_FOOD,
  [TYPE_GUEST_DINNER]: TYPE_GUEST_DINNER || TYPE_FOOD,
  [TYPE_TRAVEL]: TYPE_TRAVEL,
  [TYPE_UTSAV]: TYPE_UTSAV,
  [TYPE_GUEST_UTSAV]: TYPE_GUEST_UTSAV
};

export async function getBooking(bookingType, bookingid) {
  var booking = null;

  switch (bookingType) {
    case TYPE_ROOM:
      booking = await RoomBooking.findOne({
        where: { bookingid }
      });
      break;

    case TYPE_FLAT:
      booking = await FlatBooking.findOne({
        where: { bookingid }
      });
      break;

    case TYPE_ADHYAYAN:
      booking = await ShibirBookingDb.findOne({
        where: { bookingid }
      });
      break;

    case TYPE_FOOD:
      booking = await FoodDb.findOne({
        where: { id: bookingid }
      });
      break;

    case TYPE_TRAVEL:
      booking = await TravelDb.findOne({
        where: { bookingid }
      });
      break;

    case TYPE_UTSAV:
      booking = await UtsavBooking.findOne({
        where: { bookingid }
      });
      break;

    default:
      throw new ApiError(400, `${ERR_INVALID_BOOKING_TYPE}: ${bookingType}`);
  }

  return booking;
}

export function ifMigrated(transaction) {
  let bookingid = transaction.bookingid;
  let description = transaction.description;
  if (
    bookingid.length < 36 ||
    (description && description.includes('came from datachef migration'))
  ) {
    return true;
  }
  return false;
}

export function getBookingType(transaction) {
  const bookingType = bookingTypeMap[transaction.category];
  if (!bookingType) {
    throw new ApiError(
      400,
      `${ERR_INVALID_BOOKING_TYPE}: ${transaction.category}`
    );
  }

  return bookingType;
}

export function getBookingTypeFromBooking(booking) {
  var bookingType;

  if (booking instanceof RoomBooking) {
    bookingType = TYPE_ROOM;
  } else if (booking instanceof FlatBooking) {
    bookingType = TYPE_FLAT;
  } else if (booking instanceof FoodDb) {
    bookingType = TYPE_FOOD;
  } else if (booking instanceof TravelDb) {
    bookingType = TYPE_TRAVEL;
  } else if (booking instanceof ShibirBookingDb) {
    bookingType = TYPE_ADHYAYAN;
  } else if (booking instanceof UtsavBooking) {
    bookingType = TYPE_UTSAV;
  }

  if (!bookingType) {
    throw new ApiError(400, `${ERR_INVALID_BOOKING_TYPE}: ${typeof booking}`);
  }

  return bookingType;
}
