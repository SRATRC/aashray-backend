import { CardDb, ShibirBookingDb } from "../../models/associations.js";

export default class ShibirBookingFactory {
  static async create(cardno) {
    const bookingDetails = {
      bookingid: "1",
      cardno: cardno,
      shibir_id: 1,
      status: "confirmed"
    };

    return await ShibirBookingDb.create(bookingDetails);
  }
}

