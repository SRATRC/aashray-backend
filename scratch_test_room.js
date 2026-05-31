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

    // Override phone numbers to Harshit's test number to avoid spamming the real Dhara Kamani
    const testPhone = "8274856695";
    booker.mobno = testPhone;
    attendee.mobno = testPhone;

    // Stub CardDb.findOne to ensure subsequent lookups return these modified instances with the test phone number
    const originalFindOne = CardDb.findOne;
    CardDb.findOne = async (options) => {
      const cardno = options?.where?.cardno;
      if (cardno === '0002945690') return booker;
      if (cardno === '0002826713') return attendee;
      return originalFindOne.call(CardDb, options);
    };

    console.log("Booker:", booker.issuedto, "Phone:", booker.mobno);
    console.log("Attendee:", attendee.issuedto, "Phone:", attendee.mobno);

    // Helper to make fake room booking objects
    const makeRoomBooking = (id, status, roomtype, bookedByVal = null) => ({
      bookingid: id,
      bookingId: id,
      id: id,
      status: status,
      roomtype: roomtype,
      roomno: '101A',
      checkin: '2026-06-18',
      checkout: '2026-06-20',
      bookedBy: bookedByVal
    });

    console.log("\n=== 1. Testing Self Booker Room Templates ===");
    
    // 1. Self Booker - Waiting -> bn_sha_s_b_w
    console.log("\nCase 1: Self Waiting (bn_sha_s_b_w)");
    await sendUnifiedWhatsApp(attendee.cardno, [], [], [], [], [makeRoomBooking('room_self_w', 'waiting', 'nac')], null);

    // 2. Self Booker - Payment Pending -> bn_sha_s_b_ppg
    console.log("\nCase 2: Self Pending (bn_sha_s_b_ppg)");
    await sendUnifiedWhatsApp(attendee.cardno, [], [], [], [], [makeRoomBooking('room_self_ppg', 'pending', 'nac')], null);

    // 3. Self Booker - Confirmed -> bn_sha_s_b_cf
    console.log("\nCase 3: Self Confirmed (bn_sha_s_b_cf)");
    await sendUnifiedWhatsApp(attendee.cardno, [], [], [], [], [makeRoomBooking('room_self_cf', 'confirmed', 'nac')], null);


    console.log("\n=== 2. Testing Guest Booker (By) Room Templates ===");
    
    // 4. Guest Booker - Waiting -> bn_sha_gu_b_w
    console.log("\nCase 4: Guest Booker Waiting (bn_sha_gu_b_w)");
    await sendUnifiedWhatsApp(booker.cardno, [], [], [], [], [makeRoomBooking('room_guest_w', 'waiting', 'nac', booker.cardno)], attendee.cardno);

    // 5. Guest Booker - Payment Pending -> bn_sha_gu_b_ppg
    console.log("\nCase 5: Guest Booker Pending (bn_sha_gu_b_ppg)");
    await sendUnifiedWhatsApp(booker.cardno, [], [], [], [], [makeRoomBooking('room_guest_ppg', 'pending', 'nac', booker.cardno)], attendee.cardno);

    // 6. Guest Booker - Confirmed -> bn_sha_gu_b_cf
    console.log("\nCase 6: Guest Booker Confirmed (bn_sha_gu_b_cf)");
    await sendUnifiedWhatsApp(booker.cardno, [], [], [], [], [makeRoomBooking('room_guest_cf', 'confirmed', 'nac', booker.cardno)], attendee.cardno);


    console.log("\n=== 3. Testing Guest Attendee (For) Room Templates ===");

    // 7. Guest Attendee - Waiting -> bn_sha_gu_f_wg
    console.log("\nCase 7: Guest Attendee Waiting (bn_sha_gu_f_wg)");
    await sendUnifiedWhatsApp(attendee.cardno, [], [], [], [], [makeRoomBooking('room_guest_w', 'waiting', 'nac', booker.cardno)], null);

    // 8. Guest Attendee - Payment Pending -> bn_sha_gu_f_pp
    console.log("\nCase 8: Guest Attendee Pending (bn_sha_gu_f_pp)");
    await sendUnifiedWhatsApp(attendee.cardno, [], [], [], [], [makeRoomBooking('room_guest_ppg', 'pending', 'nac', booker.cardno)], null);

    // 9. Guest Attendee - Confirmed -> bn_sha_gu_f_cf
    console.log("\nCase 9: Guest Attendee Confirmed (bn_sha_gu_f_cf)");
    await sendUnifiedWhatsApp(attendee.cardno, [], [], [], [], [makeRoomBooking('room_guest_cf', 'confirmed', 'nac', booker.cardno)], null);

  } catch (err) {
    console.error("Test execution failed:", err);
  } finally {
    await database.close();
  }
})();
