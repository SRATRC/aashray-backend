import './config/environment.js';
import database from './config/database.js';
import { CardDb, Transactions } from './models/associations.js';
import { sendTravelStatusChangeWhatsApp } from './helpers/whatsapp.helper.js';

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

    // Stub Transactions.findOne to return credits for travel refunds
    const originalTxFindOne = Transactions.findOne;
    Transactions.findOne = async (options) => {
      const bookingid = options?.where?.bookingid;
      if (bookingid && (bookingid.includes('wcre') || bookingid.includes('cf2acn_wc'))) {
        return {
          status: 'credited',
          amount: 315,
          discount: 0
        };
      }
      return originalTxFindOne.call(Transactions, options);
    };

    console.log("Booker:", booker.issuedto, "Phone:", booker.mobno);
    console.log("Attendee:", attendee.issuedto, "Phone:", attendee.mobno);

    // Helper to make fake travel booking objects
    const makeTravelBooking = (id, status, bookedByVal, adminComments = null) => ({
      bookingid: id,
      bookingId: id,
      id: id,
      status: status,
      date: '2026-06-18', // YYYY-MM-DD
      pickuppoint: 'Amar Mahal',
      dropoffpoint: 'Research Centre',
      bookedBy: bookedByVal,
      total_people: 1,
      cardno: attendee.cardno,
      admin_comments: adminComments
    });

    console.log("\n=== 1. Testing Self Travel Booking Transitions (12 templates) ===");

    // 1. Awaiting Confirmation to Payment Pending -> bk_pvs_s_b_awc2ppg
    console.log("\nCase 1: Self AWC to Payment Pending (bk_pvs_s_b_awc2ppg)");
    await sendTravelStatusChangeWhatsApp(makeTravelBooking('s_awc2ppg', 'proceed for payment', attendee.cardno), 'awaiting confirmation');

    // 2. Awaiting Confirmation to Admin Cancelled -> bk_pvs_s_b_awc2acn
    console.log("\nCase 2: Self AWC to Admin Cancelled (bk_pvs_s_b_awc2acn)");
    await sendTravelStatusChangeWhatsApp(makeTravelBooking('s_awc2acn', 'admin cancelled', attendee.cardno), 'awaiting confirmation');

    // 3. Awaiting Confirmation to Cancelled -> bk_pvs_s_b_awc2cn
    console.log("\nCase 3: Self AWC to Cancelled (bk_pvs_s_b_awc2cn)");
    await sendTravelStatusChangeWhatsApp(makeTravelBooking('s_awc2cn', 'cancelled', attendee.cardno), 'awaiting confirmation');

    // 4. Awaiting Confirmation to Admin Cancelled (Wrong Form) -> bk_pvs_s_b_awc2acn_wff
    console.log("\nCase 4: Self AWC to Wrong Form Cancel (bk_pvs_s_b_awc2acn_wff)");
    await sendTravelStatusChangeWhatsApp(makeTravelBooking('s_awc2acn_wff', 'admin cancelled', attendee.cardno, 'admin_cancel_wrong_form'), 'awaiting confirmation');

    // 5. Awaiting Confirmation to Admin Cancelled (Seats Full) -> bk_pvs_s_b_awc2acn_asf
    console.log("\nCase 5: Self AWC to Seats Full Cancel (bk_pvs_s_b_awc2acn_asf)");
    await sendTravelStatusChangeWhatsApp(makeTravelBooking('s_awc2acn_asf', 'admin cancelled', attendee.cardno, 'admin_cancel_seats_full'), 'awaiting confirmation');

    // 6. Payment Pending to Cancelled -> bk_pvs_s_b_ppg2cn
    console.log("\nCase 6: Self Pending to Cancelled (bk_pvs_s_b_ppg2cn)");
    await sendTravelStatusChangeWhatsApp(makeTravelBooking('s_ppg2cn', 'cancelled', attendee.cardno), 'proceed for payment');

    // 7. Payment Pending to Admin Cancelled -> bk_pvs_s_b_ppg2acn
    console.log("\nCase 7: Self Pending to Admin Cancelled (bk_pvs_s_b_ppg2acn)");
    await sendTravelStatusChangeWhatsApp(makeTravelBooking('s_ppg2acn', 'admin cancelled', attendee.cardno), 'proceed for payment');

    // 8. Payment Pending to Confirmed -> bk_pvs_s_b_pypdg2conf
    console.log("\nCase 8: Self Pending to Confirmed (bk_pvs_s_b_pypdg2conf)");
    await sendTravelStatusChangeWhatsApp(makeTravelBooking('s_ppg2conf', 'confirmed', attendee.cardno), 'proceed for payment', { razorpay_payment_id: 'pay_test12345' });

    // 9. Confirmed to Cancelled -> bk_pvs_s_b_cf2cn
    console.log("\nCase 9: Self Confirmed to Cancelled (bk_pvs_s_b_cf2cn)");
    await sendTravelStatusChangeWhatsApp(makeTravelBooking('s_cf2cn', 'cancelled', attendee.cardno), 'confirmed');

    // 10. Confirmed to Admin Cancelled (No Credits) -> bk_pvs_s_b_cf2acn_woc
    console.log("\nCase 10: Self Confirmed to Admin Cancel (No Credits) (bk_pvs_s_b_cf2acn_woc)");
    await sendTravelStatusChangeWhatsApp(makeTravelBooking('s_cf2acn_woc', 'admin cancelled', attendee.cardno), 'confirmed');

    // 11. Confirmed to Admin Cancelled (Credits) -> bk_pvs_s_b_conf2adcanc_wcre
    console.log("\nCase 11: Self Confirmed to Admin Cancel (Credits) (bk_pvs_s_b_conf2adcanc_wcre)");
    await sendTravelStatusChangeWhatsApp(makeTravelBooking('s_cf2acn_wcre', 'admin cancelled', attendee.cardno), 'confirmed');

    // 12. Cancelled to Admin Cancelled (Credits) -> bk_pvs_s_b_canc2adcanc_wcre
    console.log("\nCase 12: Self Cancelled to Admin Cancel (Credits) (bk_pvs_s_b_canc2adcanc_wcre)");
    await sendTravelStatusChangeWhatsApp(makeTravelBooking('s_cn2acn_wcre', 'admin cancelled', attendee.cardno), 'cancelled');


    console.log("\n=== 2. Testing Guest Travel Booking Transitions (12 templates) ===");

    // 13. Awaiting Confirmation to Payment Pending -> bk_pvs_mu_b_awc2ppg
    console.log("\nCase 13: Guest AWC to Payment Pending (bk_pvs_mu_b_awc2ppg)");
    await sendTravelStatusChangeWhatsApp(makeTravelBooking('g_awc2ppg', 'proceed for payment', booker.cardno), 'awaiting confirmation');

    // 14. Awaiting Confirmation to Admin Cancelled -> bk_pvs_mu_b_awc2acn
    console.log("\nCase 14: Guest AWC to Admin Cancelled (bk_pvs_mu_b_awc2acn)");
    await sendTravelStatusChangeWhatsApp(makeTravelBooking('g_awc2acn', 'admin cancelled', booker.cardno), 'awaiting confirmation');

    // 15. Awaiting Confirmation to Cancelled -> bk_pvs_mu_b_awtconf2canc
    console.log("\nCase 15: Guest AWC to Cancelled (bk_pvs_mu_b_awtconf2canc)");
    await sendTravelStatusChangeWhatsApp(makeTravelBooking('g_awc2cn', 'cancelled', booker.cardno), 'awaiting confirmation');

    // 16. Awaiting Confirmation to Admin Cancelled (Wrong Form) -> bk_pvs_mu_b_awc2acn_wff
    console.log("\nCase 16: Guest AWC to Wrong Form Cancel (bk_pvs_mu_b_awc2acn_wff)");
    await sendTravelStatusChangeWhatsApp(makeTravelBooking('g_awc2acn_wff', 'admin cancelled', booker.cardno, 'admin_cancel_wrong_form'), 'awaiting confirmation');

    // 17. Awaiting Confirmation to Admin Cancelled (Seats Full) -> bk_pvs_mu_b_awc2acn_asf
    console.log("\nCase 17: Guest AWC to Seats Full Cancel (bk_pvs_mu_b_awc2acn_asf)");
    await sendTravelStatusChangeWhatsApp(makeTravelBooking('g_awc2acn_asf', 'admin cancelled', booker.cardno, 'admin_cancel_seats_full'), 'awaiting confirmation');

    // 18. Payment Pending to Cancelled -> bk_pvs_mu_b_ppg2cn
    console.log("\nCase 18: Guest Pending to Cancelled (bk_pvs_mu_b_ppg2cn)");
    await sendTravelStatusChangeWhatsApp(makeTravelBooking('g_ppg2cn', 'cancelled', booker.cardno), 'proceed for payment');

    // 19. Payment Pending to Admin Cancelled -> bk_pvs_mu_b_ppg2acn
    console.log("\nCase 19: Guest Pending to Admin Cancelled (bk_pvs_mu_b_ppg2acn)");
    await sendTravelStatusChangeWhatsApp(makeTravelBooking('g_ppg2acn', 'admin cancelled', booker.cardno), 'proceed for payment');

    // 20. Payment Pending to Confirmed -> bk_pvs_mu_b_pympndg2conf
    console.log("\nCase 20: Guest Pending to Confirmed (bk_pvs_mu_b_pympndg2conf)");
    await sendTravelStatusChangeWhatsApp(makeTravelBooking('g_ppg2conf', 'confirmed', booker.cardno), 'proceed for payment', { razorpay_payment_id: 'pay_test56789' });

    // 21. Confirmed to Cancelled -> bk_pvs_mu_b_conf2canc
    console.log("\nCase 21: Guest Confirmed to Cancelled (bk_pvs_mu_b_conf2canc)");
    await sendTravelStatusChangeWhatsApp(makeTravelBooking('g_cf2cn', 'cancelled', booker.cardno), 'confirmed');

    // 22. Confirmed to Admin Cancelled (No Credits) -> bk_pvs_mu_b_cf2acn_woc
    console.log("\nCase 22: Guest Confirmed to Admin Cancel (No Credits) (bk_pvs_mu_b_cf2acn_woc)");
    await sendTravelStatusChangeWhatsApp(makeTravelBooking('g_cf2acn_woc', 'admin cancelled', booker.cardno), 'confirmed');

    // 23. Confirmed to Admin Cancelled (Credits) -> bk_pvs_mu_b_cf2acn_wc
    console.log("\nCase 23: Guest Confirmed to Admin Cancel (Credits) (bk_pvs_mu_b_cf2acn_wc)");
    await sendTravelStatusChangeWhatsApp(makeTravelBooking('g_cf2acn_wc', 'admin cancelled', booker.cardno), 'confirmed');

    // 24. Cancelled to Admin Cancelled (Credits) -> bk_pvs_mu_b_canc2adcanc_wcre
    console.log("\nCase 24: Guest Cancelled to Admin Cancel (Credits) (bk_pvs_mu_b_canc2adcanc_wcre)");
    await sendTravelStatusChangeWhatsApp(makeTravelBooking('g_cn2acn_wcre', 'admin cancelled', booker.cardno), 'cancelled');

  } catch (err) {
    console.error("Test execution failed:", err);
  } finally {
    await database.close();
  }
})();
