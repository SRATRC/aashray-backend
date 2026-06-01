import './config/environment.js';
import database from './config/database.js';
import { CardDb, Transactions } from './models/associations.js';
import { sendFlatStatusChangeWhatsApp } from './helpers/whatsapp.helper.js';

(async () => {
  try {
    await database.authenticate();
    console.log("Database connected successfully.");

    // Load Harshit (Booker/Owner) and Dhara Kamani (Attendee/Guest)
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

    // Stub CardDb.findOne to ensure lookups return our modified instances with the test phone
    const originalFindOne = CardDb.findOne;
    CardDb.findOne = async (options) => {
      const cardno = options?.where?.cardno;
      if (cardno === '0002945690') return booker;
      if (cardno === '0002826713') return attendee;
      return originalFindOne.call(CardDb, options);
    };

    // Stub Transactions.findOne to simulate credit refund / Razorpay order ID lookup
    const originalTxFindOne = Transactions.findOne;
    Transactions.findOne = async (options) => {
      const bookingid = options?.where?.bookingid;
      if (bookingid) {
        if (bookingid.includes('wcre') || bookingid.includes('adcanc')) {
          return {
            status: 'credited',
            amount: 1500,
            discount: 0,
            razorpay_order_id: 'order_Ryiaj9odZWRARm'
          };
        }
        if (bookingid.includes('ppg2conf')) {
          return {
            status: 'completed',
            amount: 1500,
            discount: 0,
            razorpay_order_id: 'order_Ryiaj9odZWRARm'
          };
        }
      }
      return originalTxFindOne.call(Transactions, options);
    };

    // Helper to make fake flat booking objects
    const makeFlatBooking = (id, status, bookedByVal = '0002945690', attendeeVal = '0002826713') => ({
      bookingid: id,
      bookingId: id,
      id: id,
      status: status,
      flatno: 101,
      checkin: '2026-06-18',
      checkout: '2026-06-20',
      bookedBy: bookedByVal,
      cardno: attendeeVal
    });

    console.log("\n=== TESTING FLAT STATUS TRANSITIONS (16 TEMPLATES) ===\n");

    // Scenario 2: Payment Pending to Admin Cancelled
    // Booker Template: bk_flt_gu_b_ppg2acn
    // Attendee Template: bk_flt_gu_f_ppg2acn
    console.log("\n--- 2. Transition: Payment Pending -> Admin Cancelled (Admin Action) ---");
    await sendFlatStatusChangeWhatsApp(
      makeFlatBooking('flat_ppg2acn', 'admin cancelled'),
      'payment pending',
      { updatedBy: 'admin_user' }
    );

    // Scenario 3: Payment Pending to Admin Cancelled (Cron)
    // Booker Template: bk_flt_gu_b_ppg2acn_cron
    // Attendee Template: bk_flt_gu_f_ppg2acn_cron
    console.log("\n--- 3. Transition: Payment Pending -> Admin Cancelled (Cron Action) ---");
    await sendFlatStatusChangeWhatsApp(
      makeFlatBooking('flat_ppg2acn_cron', 'admin cancelled'),
      'payment pending',
      { isCron: true }
    );

    console.log("\n=== ALL TESTS FINISHED ===");
    process.exit(0);
  } catch (err) {
    console.error("Test execution failed:", err);
    process.exit(1);
  }
})();
