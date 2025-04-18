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
  TYPE_GUEST_FLAT,
  TYPE_GUEST_BREAKFAST,
  TYPE_GUEST_LUNCH,
  TYPE_GUEST_DINNER,
  TYPE_TRAVEL,
  TYPE_UTSAV,
  TYPE_GUEST_UTSAV,
} from '../config/constants.js';
import ApiError from '../utils/ApiError.js';

export async function getBooking(transaction) {
  var booking = null;

    switch(transaction.category) {
      case TYPE_ROOM:
      case TYPE_GUEST_ROOM:
        booking = await RoomBooking.findOne({
          where: {
            bookingid: transaction.bookingid
          }
        });
        break;

      case TYPE_FLAT:
      case TYPE_GUEST_FLAT:
        booking = await FlatBooking.findOne({
          where: {
            bookingid: transaction.bookingid
          }
        });
        break;

      case TYPE_ADHYAYAN:
      case TYPE_GUEST_ADHYAYAN:
        booking = await ShibirBookingDb.findOne({
          where: {
            bookingid: transaction.bookingid
          }
        });
        break;

      case TYPE_GUEST_BREAKFAST:
      case TYPE_GUEST_LUNCH:
      case TYPE_GUEST_DINNER:
        booking = await FoodDb.findOne({
          where: {
            id: transaction.bookingid
          }
        });
        break;

      case TYPE_TRAVEL:
        booking = await TravelDb.findOne({
          where: {
            id: transaction.bookingid
          }
        });
        break;

      case TYPE_UTSAV:
      case TYPE_GUEST_UTSAV:
        booking = await UtsavBooking.findOne({
          where: {
            id: transaction.bookingid
          }
        });
        break;

      default:
        throw new ApiError(400, `${ERR_INVALID_BOOKING_TYPE}: ${transaction.category}`);
    }

  return booking;
}

export async function confirmBooking(booking, updatedBy, t) {
  const bookingStatus = booking instanceof RoomBooking 
    ? ROOM_STATUS_CHECKEDIN 
    : STATUS_CONFIRMED;

  booking.update(
    {
      status: bookingStatus,
      updatedBy
    },
    { transaction: t }
  );

  return booking;
}