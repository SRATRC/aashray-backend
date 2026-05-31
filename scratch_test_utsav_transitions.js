import './config/environment.js';
import database from './config/database.js';
import { CardDb, Transactions, UtsavDb, UtsavPackagesDb } from './models/associations.js';
import { sendUtsavStatusChangeWhatsApp } from './helpers/whatsapp.helper.js';

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
    const originalCardFindOne = CardDb.findOne;
    CardDb.findOne = async (options) => {
      const cardno = options?.where?.cardno;
      if (cardno === '0002945690') return booker;
      if (cardno === '0002826713') return attendee;
      return originalCardFindOne.call(CardDb, options);
    };

    // Stub UtsavDb.findOne and UtsavPackagesDb.findOne
    const originalUtsavFindOne = UtsavDb.findOne;
    UtsavDb.findOne = async (options) => {
      return { id: 1, name: 'Anand Mahotsav 2026' };
    };

    const originalPackageFindOne = UtsavPackagesDb.findOne;
    UtsavPackagesDb.findOne = async (options) => {
      return { id: 1, name: 'Package A (all days)' };
    };

    // Stub Transactions.findOne to mock payments & credits
    let currentMockTxStatus = "payment pending";
    let currentMockTxAmount = 7000;
    
    const originalTxFindOne = Transactions.findOne;
    Transactions.findOne = async (options) => {
      return {
        bookingid: options?.where?.bookingid,
        amount: currentMockTxAmount,
        discount: 0,
        razorpay_order_id: 'order_Ryiaj9odZWRARm',
        status: currentMockTxStatus
      };
    };

    // Helper to make fake utsav booking objects
    const makeUtsavBooking = (id, status, bookedByVal, roomno = null) => ({
      bookingid: id,
      bookingId: id,
      id: id,
      status: status,
      utsavid: 1,
      packageid: 1,
      bookedBy: bookedByVal,
      cardno: attendee.cardno,
      roomno: roomno
    });

    console.log("Booker:", booker.issuedto, "Phone:", booker.mobno);
    console.log("Attendee:", attendee.issuedto, "Phone:", attendee.mobno);

    console.log("\n=== 1. Testing Guest Booker (By) Utsav Status Transitions ===");

    // Case 1: Guest - Waiting -> Cancelled (bk_usv_gu_b_wtng2canc)
    console.log("\nCase 1: Guest - Waiting -> Cancelled");
    await sendUtsavStatusChangeWhatsApp(makeUtsavBooking('usv_guest_w2c', 'cancelled', booker.cardno), 'waiting');

    // Case 2: Guest - Waiting -> Admin Cancelled (bk_usv_gu_b_w2acn)
    console.log("\nCase 2: Guest - Waiting -> Admin Cancelled");
    await sendUtsavStatusChangeWhatsApp(makeUtsavBooking('usv_guest_w2acn', 'admin cancelled', booker.cardno), 'waiting');

    // Case 3: Guest - Waiting -> Payment Pending (bk_usv_gu_b_w2ppg)
    console.log("\nCase 3: Guest - Waiting -> Payment Pending");
    await sendUtsavStatusChangeWhatsApp(makeUtsavBooking('usv_guest_w2ppg', 'payment pending', booker.cardno), 'waiting');

    // Case 4: Guest - Payment Pending -> Cancelled (bk_usv_gu_b_pymtpndg2canc)
    console.log("\nCase 4: Guest - Payment Pending -> Cancelled");
    await sendUtsavStatusChangeWhatsApp(makeUtsavBooking('usv_guest_ppg2cn', 'cancelled', booker.cardno), 'payment pending');

    // Case 5: Guest - Payment Pending -> Admin Cancelled (Cron) (bk_usv_gu_b_ppg2acn_c)
    console.log("\nCase 5: Guest - Payment Pending -> Admin Cancelled (Cron)");
    await sendUtsavStatusChangeWhatsApp(makeUtsavBooking('usv_guest_ppg2acn_c', 'admin cancelled', booker.cardno), 'payment pending', { isCron: true });

    // Case 6: Guest - Payment Pending -> Admin Cancelled (Admin) (bk_usv_gu_b_ppg2acn_a)
    console.log("\nCase 6: Guest - Payment Pending -> Admin Cancelled (Admin)");
    await sendUtsavStatusChangeWhatsApp(makeUtsavBooking('usv_guest_ppg2acn_a', 'admin cancelled', booker.cardno), 'payment pending', { updatedBy: 'admin' });

    // Case 7: Guest - Payment Pending -> Confirmed (bk_usv_gu_b_ppg2cf)
    console.log("\nCase 7: Guest - Payment Pending -> Confirmed");
    await sendUtsavStatusChangeWhatsApp(makeUtsavBooking('usv_guest_ppg2cf', 'confirmed', booker.cardno), 'payment pending');

    // Case 8: Guest - Confirmed -> Cancelled (bk_usv_gu_b_cnfc2canc)
    console.log("\nCase 8: Guest - Confirmed -> Cancelled");
    await sendUtsavStatusChangeWhatsApp(makeUtsavBooking('usv_guest_cf2cn', 'cancelled', booker.cardno), 'confirmed');

    // Case 9: Guest - Confirmed -> Admin Cancelled (Credits) (bk_usv_gu_b_cf2acn_wc)
    console.log("\nCase 9: Guest - Confirmed -> Admin Cancelled (Credits)");
    currentMockTxStatus = "completed";
    currentMockTxAmount = 7000;
    await sendUtsavStatusChangeWhatsApp(makeUtsavBooking('usv_guest_cf2acn_wc', 'admin cancelled', booker.cardno), 'confirmed');

    // Case 10: Guest - Confirmed -> Admin Cancelled (No Credits) (bk_usv_gu_b_cf2acn_woc)
    console.log("\nCase 10: Guest - Confirmed -> Admin Cancelled (No Credits)");
    currentMockTxStatus = "pending";
    currentMockTxAmount = 0;
    await sendUtsavStatusChangeWhatsApp(makeUtsavBooking('usv_guest_cf2acn_woc', 'admin cancelled', booker.cardno), 'confirmed');

    // Case 11: Guest - Cancelled -> Admin Cancelled (Credits) (bk_usv_gu_b_canc2adcanc_wcre)
    console.log("\nCase 11: Guest - Cancelled -> Admin Cancelled (Credits)");
    currentMockTxStatus = "credited";
    currentMockTxAmount = 7000;
    await sendUtsavStatusChangeWhatsApp(makeUtsavBooking('usv_guest_canc2adcanc_wcre', 'admin cancelled', booker.cardno), 'cancelled');


    console.log("\n=== 2. Testing Self Booker Utsav Status Transitions ===");

    // Case 12: Self - Waiting -> Cancelled (bk_usv_s_b_w2cn)
    console.log("\nCase 12: Self - Waiting -> Cancelled");
    await sendUtsavStatusChangeWhatsApp(makeUtsavBooking('usv_self_w2c', 'cancelled', attendee.cardno), 'waiting');

    // Case 13: Self - Waiting -> Admin Cancelled (bk_usv_s_b_w2acn)
    console.log("\nCase 13: Self - Waiting -> Admin Cancelled");
    await sendUtsavStatusChangeWhatsApp(makeUtsavBooking('usv_self_w2acn', 'admin cancelled', attendee.cardno), 'waiting');

    // Case 14: Self - Waiting -> Payment Pending (bk_usv_s_b_wtng2pymtpndg)
    console.log("\nCase 14: Self - Waiting -> Payment Pending");
    await sendUtsavStatusChangeWhatsApp(makeUtsavBooking('usv_self_w2ppg', 'payment pending', attendee.cardno), 'waiting');

    // Case 15: Self - Payment Pending -> Cancelled (bk_usv_s_b_pymtpndg2canc)
    console.log("\nCase 15: Self - Payment Pending -> Cancelled");
    await sendUtsavStatusChangeWhatsApp(makeUtsavBooking('usv_self_ppg2cn', 'cancelled', attendee.cardno), 'payment pending');

    // Case 16: Self - Payment Pending -> Admin Cancelled (Cron) (bk_usv_s_b_ppg2acn_c)
    console.log("\nCase 16: Self - Payment Pending -> Admin Cancelled (Cron)");
    await sendUtsavStatusChangeWhatsApp(makeUtsavBooking('usv_self_ppg2acn_c', 'admin cancelled', attendee.cardno), 'payment pending', { isCron: true });

    // Case 17: Self - Payment Pending -> Admin Cancelled (Admin) (bk_usv_s_b_ppg2acn_a)
    console.log("\nCase 17: Self - Payment Pending -> Admin Cancelled (Admin)");
    await sendUtsavStatusChangeWhatsApp(makeUtsavBooking('usv_self_ppg2acn_a', 'admin cancelled', attendee.cardno), 'payment pending', { updatedBy: 'admin' });

    // Case 18: Self - Payment Pending -> Confirmed (bk_usv_s_b_ppg2cf)
    console.log("\nCase 18: Self - Payment Pending -> Confirmed");
    await sendUtsavStatusChangeWhatsApp(makeUtsavBooking('usv_self_ppg2cf', 'confirmed', attendee.cardno), 'payment pending');

    // Case 19: Self - Confirmed -> Checked-in (bk_usv_s_b_cf2ci)
    console.log("\nCase 19: Self - Confirmed -> Checked-in");
    await sendUtsavStatusChangeWhatsApp(makeUtsavBooking('usv_self_cf2ci', 'checkedin', attendee.cardno, '25'), 'confirmed');

    // Case 20: Self - Confirmed -> Cancelled (bk_usv_s_b_cf2cn)
    console.log("\nCase 20: Self - Confirmed -> Cancelled");
    await sendUtsavStatusChangeWhatsApp(makeUtsavBooking('usv_self_cf2cn', 'cancelled', attendee.cardno), 'confirmed');

    // Case 21: Self - Confirmed -> Admin Cancelled (Credits) (bk_usv_s_b_cf2acn_wc)
    console.log("\nCase 21: Self - Confirmed -> Admin Cancelled (Credits)");
    currentMockTxStatus = "completed";
    currentMockTxAmount = 7000;
    await sendUtsavStatusChangeWhatsApp(makeUtsavBooking('usv_self_cf2acn_wc', 'admin cancelled', attendee.cardno), 'confirmed');

    // Case 22: Self - Confirmed -> Admin Cancelled (No Credits) (bk_usv_s_b_cf2acn_woc)
    console.log("\nCase 22: Self - Confirmed -> Admin Cancelled (No Credits)");
    currentMockTxStatus = "pending";
    currentMockTxAmount = 0;
    await sendUtsavStatusChangeWhatsApp(makeUtsavBooking('usv_self_cf2acn_woc', 'admin cancelled', attendee.cardno), 'confirmed');

    // Case 23: Self - Cancelled -> Admin Cancelled (Credits) (bk_usv_s_b_canc2adcanc_wcre -> bk_usv_gu_b_canc2adcanc_wcre fallback)
    console.log("\nCase 23: Self - Cancelled -> Admin Cancelled (Credits)");
    currentMockTxStatus = "credited";
    currentMockTxAmount = 7000;
    await sendUtsavStatusChangeWhatsApp(makeUtsavBooking('usv_self_canc2adcanc_wcre', 'admin cancelled', attendee.cardno), 'cancelled');

  } catch (err) {
    console.error("Test execution failed:", err);
  } finally {
    await database.close();
  }
})();
