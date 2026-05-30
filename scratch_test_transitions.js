import './config/environment.js';
import database from './config/database.js';
import { CardDb, ShibirDb } from './models/associations.js';
import { sendAdhyayanStatusChangeWhatsApp } from './helpers/whatsapp.helper.js';

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

    // Override phone numbers to Harshit's number to avoid spamming the real Dhara Kamani
    // Change this variable to test with a different destination number.
    const testPhone = "8274856695";
    booker.mobno = testPhone;
    attendee.mobno = testPhone;

    console.log("Booker:", booker.issuedto, "Phone:", booker.mobno);
    console.log("Attendee:", attendee.issuedto, "Phone:", attendee.mobno);

    const shibir = await ShibirDb.findOne({ where: { id: 159 } });
    if (!shibir) {
      console.error("Shibir not found!");
      return;
    }

    // A helper to make a fake booking object
    const makeBooking = (id, prev, curr, updatedBy = 'admin', bookedByVal = null) => ({
      bookingid: id,
      shibir_id: shibir.id,
      cardno: attendee.cardno,
      bookedBy: bookedByVal,
      status: curr,
      updatedBy: updatedBy
    });

    console.log("\n--- Testing Scenario B Transition templates (Guest - By) ---");

    // 1. Waiting to Cancelled -> bk_adh_gu_b_wg2cn
    console.log("\n1. wg2cn:");
    await sendAdhyayanStatusChangeWhatsApp(makeBooking('test_trans_wg2cn', 'waiting', 'cancelled', 'admin', booker.cardno), shibir, 'waiting');

    // 2. Waiting to Admin Cancelled -> bk_adh_gu_b_wg2acn
    console.log("\n2. wg2acn:");
    await sendAdhyayanStatusChangeWhatsApp(makeBooking('test_trans_wg2acn', 'waiting', 'admin cancelled', 'admin', booker.cardno), shibir, 'waiting');

    // 3. Waiting to Payment Pending -> bk_adh_gu_b_wg2ppg
    console.log("\n3. wg2ppg:");
    await sendAdhyayanStatusChangeWhatsApp(makeBooking('test_trans_wg2ppg', 'waiting', 'payment pending', 'admin', booker.cardno), shibir, 'waiting');

    // 4. Payment Pending to Cancelled -> bk_adh_gu_b_ppg2cn
    console.log("\n4. ppg2cn:");
    await sendAdhyayanStatusChangeWhatsApp(makeBooking('test_trans_ppg2cn', 'payment pending', 'cancelled', 'admin', booker.cardno), shibir, 'payment pending');

    // 5. Payment Pending to Admin Cancelled (Cron) -> bk_adh_gu_b_ppg2acn_c
    console.log("\n5. ppg2acn_c:");
    await sendAdhyayanStatusChangeWhatsApp(makeBooking('test_trans_ppg2acn_c', 'payment pending', 'admin cancelled', 'admin', booker.cardno), shibir, 'payment pending');

    // 6. Payment Pending to Admin Cancelled (Office) -> bk_adh_gu_b_ppg2acn_a
    console.log("\n6. ppg2acn_a:");
    await sendAdhyayanStatusChangeWhatsApp(makeBooking('test_trans_ppg2acn_a', 'payment pending', 'admin cancelled', 'office_user', booker.cardno), shibir, 'payment pending');

    // 7. Payment Pending to Confirmed -> bk_adh_gu_b_ppg2cf
    console.log("\n7. ppg2cf:");
    await sendAdhyayanStatusChangeWhatsApp(makeBooking('test_trans_ppg2cf', 'payment pending', 'confirmed', 'admin', booker.cardno), shibir, 'payment pending');

    // 8. Confirmed to Cancelled -> bk_adh_gu_b_cnfm2canc
    console.log("\n8. cnfm2canc:");
    await sendAdhyayanStatusChangeWhatsApp(makeBooking('test_trans_cnfm2canc', 'confirmed', 'cancelled', 'admin', booker.cardno), shibir, 'confirmed');

    // 9. Confirmed to Admin Cancelled -> bk_adh_gu_b_cf2acn
    console.log("\n9. cf2acn:");
    await sendAdhyayanStatusChangeWhatsApp(makeBooking('test_trans_cf2acn', 'confirmed', 'admin cancelled', 'admin', booker.cardno), shibir, 'confirmed');

    // 9.1 Waiting to Confirmed -> bk_adh_gu_b_wtg2conf
    console.log("\n9.1 wtg2conf (Guest Booker):");
    await sendAdhyayanStatusChangeWhatsApp(makeBooking('test_trans_wtg2conf_g', 'waiting', 'confirmed', 'admin', booker.cardno), shibir, 'waiting');

    // 9.2 Cancelled to Confirmed -> bk_adh_gu_b_canc2conf
    console.log("\n9.2 canc2conf (Guest Booker):");
    await sendAdhyayanStatusChangeWhatsApp(makeBooking('test_trans_canc2conf_g', 'cancelled', 'confirmed', 'admin', booker.cardno), shibir, 'cancelled');

    // 9.3 Admin Cancelled to Confirmed -> bk_adh_gu_b_adcanc2conf
    console.log("\n9.3 adcanc2conf (Guest Booker):");
    await sendAdhyayanStatusChangeWhatsApp(makeBooking('test_trans_adcanc2conf_g', 'admin cancelled', 'confirmed', 'admin', booker.cardno), shibir, 'admin cancelled');


    console.log("\n--- Testing Primary Attendee (Self) Transition templates ---");

    // 10. Waiting to Confirmed -> bk_adh_s_b_wtg2conf
    console.log("\n10. wtg2conf:");
    await sendAdhyayanStatusChangeWhatsApp(makeBooking('test_trans_wtg2conf', 'waiting', 'confirmed', 'admin', null), shibir, 'waiting');

    // 11. Cancelled to Confirmed -> bk_adh_s_b_canc2conf
    console.log("\n11. canc2conf:");
    await sendAdhyayanStatusChangeWhatsApp(makeBooking('test_trans_canc2conf', 'cancelled', 'confirmed', 'admin', null), shibir, 'cancelled');

    // 12. Admin Cancelled to Confirmed -> bk_adh_s_b_adcanc2conf
    console.log("\n12. adcanc2conf:");
    await sendAdhyayanStatusChangeWhatsApp(makeBooking('test_trans_adcanc2conf', 'admin cancelled', 'confirmed', 'admin', null), shibir, 'admin cancelled');

  } catch (err) {
    console.error("Test execution failed:", err);
  } finally {
    await database.close();
  }
})();
