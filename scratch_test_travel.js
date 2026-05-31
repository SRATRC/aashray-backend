import './config/environment.js';
import database from './config/database.js';
import { CardDb } from './models/associations.js';
import { sendUnifiedWhatsApp } from './helpers/whatsapp.helper.js';

(async () => {
  try {
    await database.authenticate();
    console.log("Database connected successfully.");

    // Load Harshit (Booker) and Dhara Kamani (Attendee)
    const booker = await CardDb.findOne({ where: { cardno: '0002945690' } });
    const attendee = await CardDb.findOne({ where: { cardno: '0002826713' } });

    if (!booker || !attendee) {
      console.error("Test cards not found!");
      return;
    }

    // Override phone numbers to Harshit's test number
    const testPhone = "8274856695";
    booker.mobno = testPhone;
    attendee.mobno = testPhone;

    // Stub CardDb.findOne to return our modified test card instances
    const originalFindOne = CardDb.findOne;
    CardDb.findOne = async (options) => {
      const cardno = options?.where?.cardno;
      if (cardno === '0002945690') return booker;
      if (cardno === '0002826713') return attendee;
      return originalFindOne.call(CardDb, options);
    };

    console.log("Booker:", booker.issuedto, "Phone:", booker.mobno);
    console.log("Attendee:", attendee.issuedto, "Phone:", attendee.mobno);

    // Helper to make fake travel booking objects mimicking controllers/helper.js output
    const makeTravelBooking = (id, status, bookedByVal, totalPeople = 1) => ({
      bookingid: id,
      bookingId: id,
      id: id,
      status: status,
      date: '18th June, 2026', // Formatted as 'Do MMMM, YYYY' like in helper.js
      pickuppoint: 'Amar Mahal',
      dropoffpoint: 'Research Centre',
      bookedBy: bookedByVal,
      total_people: totalPeople,
      cardno: attendee.cardno
    });

    console.log("\n=== 1. Testing Self Booker Travel Awaiting Confirmation ===");
    console.log("Case 1: Self Booker Awaiting Confirmation (bn_pvs_s_b_awc)");
    await sendUnifiedWhatsApp(
      booker.cardno,
      [],
      [makeTravelBooking('travel_self_awc', 'awaiting confirmation', booker.cardno, 1)],
      [],
      [],
      [],
      null
    );

    console.log("\n=== 2. Testing Guest Booker (By) Travel Awaiting Confirmation ===");
    console.log("Case 2: Guest Booker (By) Awaiting Confirmation (bn_pvs_mu_b_awtgcnfm)");
    await sendUnifiedWhatsApp(
      booker.cardno,
      [],
      [makeTravelBooking('travel_guest_awc', 'awaiting confirmation', booker.cardno, 3)],
      [],
      [],
      [],
      attendee.cardno
    );

    console.log("\n=== 3. Testing Guest Attendee (For) Travel Awaiting Confirmation ===");
    console.log("Case 3: Guest Attendee (For) Awaiting Confirmation (bn_pvs_mu_f_awcf)");
    await sendUnifiedWhatsApp(
      attendee.cardno,
      [],
      [makeTravelBooking('travel_guest_awc', 'awaiting confirmation', booker.cardno, 3)],
      [],
      [],
      [],
      null
    );

  } catch (err) {
    console.error("Test execution failed:", err);
  } finally {
    await database.close();
  }
})();
