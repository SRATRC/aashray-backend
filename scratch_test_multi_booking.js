import './config/environment.js';
import database from './config/database.js';
import { CardDb, ShibirDb } from './models/associations.js';
import { sendUnifiedWhatsApp } from './helpers/whatsapp.helper.js';

(async () => {
  try {
    await database.authenticate();
    console.log("Database connected successfully.");

    // Load Harshit (Booker)
    const user = await CardDb.findOne({ where: { cardno: '0002945690' } });
    if (!user) {
      console.error("Test card not found!");
      return;
    }

    // Override phone number to Harshit's test number
    const testPhone = "8274856695";
    user.mobno = testPhone;

    // Load a real Shibir for adhyayan details if possible, or mock it
    const shibir = await ShibirDb.findOne() || {
      name: "Test Shibir",
      speaker: "Pujya Gurudevshri",
      start_date: "2026-06-18",
      end_date: "2026-06-20",
      location: "Research Centre"
    };

    const adhyanBookingDetails = [{
      bookingid: "test_adhyayan_123",
      status: "pending",
      ShibirDb: shibir
    }];

    const roomBookingDetails = [{
      bookingid: "test_room_123",
      status: "pending",
      roomtype: "nac",
      roomno: "25",
      checkin: "2026-06-18",
      checkout: "2026-06-20",
      nights: 2
    }];

    const travelBookingDetails = [{
      bookingid: "test_travel_123",
      status: "awaiting confirmation",
      date: "18th June, 2026",
      pickup_point: "Dadar",
      drop_point: "Research Centre",
      total_people: 1,
      bookedBy: user.cardno
    }];

    const foodBookingDetails = [{
      id: "test_food_123",
      bookingid: "test_food_123",
      cardno: user.cardno,
      bookedBy: null,
      date: "2026-06-18",
      breakfast: 1,
      lunch: 1,
      dinner: 1,
      spicy: 0,
      hightea: 0
    }];

    console.log("=== Testing sendUnifiedWhatsApp ===");
    await sendUnifiedWhatsApp(
      user,
      adhyanBookingDetails,
      travelBookingDetails,
      [],
      [],
      roomBookingDetails,
      null,
      foodBookingDetails
    );

  } catch (err) {
    console.error("Test execution failed:", err);
  } finally {
    await database.close();
  }
})();
