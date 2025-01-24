import { 
  ERR_TRAVEL_ALREADY_BOOKED,
  STATUS_CONFIRMED, 
  STATUS_WAITING, 
} from '../config/constants.js';
import {
  TravelDb
} from '../models/associations.js'
import ApiError from '../utils/ApiError.js';
  
export async function checkTravelAlreadyBooked(date, ...mumukshus) {
  const booking = await TravelDb.findOne({
    where: {
      cardno: mumukshus,
      status: [STATUS_CONFIRMED, STATUS_WAITING],
      date: date
    }
  });

  if (booking) {
    throw new ApiError(400, ERR_TRAVEL_ALREADY_BOOKED);
  }
}