import { STATUS_CONFIRMED } from "../../config/constants.js";
import { ShibirBookingDb } from "../../models/associations.js";

export default class ShibirBookingFactory {
  static async create(cardno) {
    const bookingDetails = {
      bookingid: 1,
      cardno: cardno,
      shibir_id: 1,
      status: STATUS_CONFIRMED
    };

    return await ShibirBookingDb.create(bookingDetails);
  }
}

