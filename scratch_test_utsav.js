import './config/environment.js';
import database from './config/database.js';
import { CardDb, Transactions } from './models/associations.js';
import { sendUnifiedWhatsApp } from './helpers/whatsapp.helper.js';
import Sequelize from 'sequelize';
const { Op } = Sequelize;

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

    // Stub Transactions.findAll to return mock transactions for our test IDs
    const originalFindAll = Transactions.findAll;
    Transactions.findAll = async (options) => {
      const bookingids = options?.where?.bookingid?.[Op.in] || [];
      if (bookingids.length) {
        return bookingids.map(id => ({
          bookingid: id,
          amount: 1400,
          discount: 0,
          razorpay_order_id: 'order_Ryiaj9odZWRARm'
        }));
      }
      return originalFindAll.call(Transactions, options);
    };

    console.log("Booker:", booker.issuedto, "Phone:", booker.mobno);
    console.log("Attendee:", attendee.issuedto, "Phone:", attendee.mobno);

    // Helper to make fake utsav booking objects mimicking helper.js output
    const makeUtsavBooking = (id, status, bookedByVal) => ({
      bookingid: id,
      bookingId: id,
      id: id,
      status: status,
      utsavname: 'Anand Mahotsav 2026',
      startdate: '18th January, 2026',
      enddate: '20th January, 2026',
      package: 'Package A (all days)',
      bookedBy: bookedByVal,
      cardno: attendee.cardno
    });

    console.log("\n=== 1. Testing Guest Booker (By) Utsav Templates ===");

    // 1. Guest Booker - Waiting -> bn_usv_gu_b_waiting
    console.log("\nCase 1: Guest Booker Waiting (bn_usv_gu_b_waiting)");
    await sendUnifiedWhatsApp(booker.cardno, [], [], [], [makeUtsavBooking('usv_guest_w', 'waiting', booker.cardno)], [], attendee.cardno);

    // 2. Guest Booker - Payment Pending -> bn_usv_gu_b_pymtpndg
    console.log("\nCase 2: Guest Booker Pending (bn_usv_gu_b_pymtpndg)");
    await sendUnifiedWhatsApp(booker.cardno, [], [], [], [makeUtsavBooking('usv_guest_pp', 'pending', booker.cardno)], [], attendee.cardno);

    // 3. Guest Booker - Confirmed -> bn_usv_gu_b_cf
    console.log("\nCase 3: Guest Booker Confirmed (bn_usv_gu_b_cf)");
    await sendUnifiedWhatsApp(booker.cardno, [], [], [], [makeUtsavBooking('usv_guest_cf', 'confirmed', booker.cardno)], [], attendee.cardno);


    console.log("\n=== 2. Testing Guest Attendee (For) Utsav Templates ===");

    // 4. Guest Attendee - Waiting -> bn_usv_gu_f_w
    console.log("\nCase 4: Guest Attendee Waiting (bn_usv_gu_f_w)");
    await sendUnifiedWhatsApp(attendee.cardno, [], [], [], [makeUtsavBooking('usv_guest_w', 'waiting', booker.cardno)], [], null);

    // 5. Guest Attendee - Payment Pending -> bn_usv_gu_f_ppg
    console.log("\nCase 5: Guest Attendee Pending (bn_usv_gu_f_ppg)");
    await sendUnifiedWhatsApp(attendee.cardno, [], [], [], [makeUtsavBooking('usv_guest_pp', 'pending', booker.cardno)], [], null);

    // 6. Guest Attendee - Confirmed -> bn_usv_gu_f_cf
    console.log("\nCase 6: Guest Attendee Confirmed (bn_usv_gu_f_cf)");
    await sendUnifiedWhatsApp(attendee.cardno, [], [], [], [makeUtsavBooking('usv_guest_cf', 'confirmed', booker.cardno)], [], null);


    console.log("\n=== 3. Testing Self Booker Utsav Templates ===");

    // 7. Self Booker - Waiting -> bn_usv_s_b_wg
    console.log("\nCase 7: Self Booker Waiting (bn_usv_s_b_wg)");
    await sendUnifiedWhatsApp(attendee.cardno, [], [], [], [makeUtsavBooking('usv_self_w', 'waiting', attendee.cardno)], [], null);

    // 8. Self Booker - Payment Pending -> bn_usv_s_b_pymtpndg
    console.log("\nCase 8: Self Booker Pending (bn_usv_s_b_pymtpndg)");
    await sendUnifiedWhatsApp(attendee.cardno, [], [], [], [makeUtsavBooking('usv_self_pp', 'pending', attendee.cardno)], [], null);

    // 9. Self Booker - Confirmed -> bn_usv_s_b_cf
    console.log("\nCase 9: Self Booker Confirmed (bn_usv_s_b_cf)");
    await sendUnifiedWhatsApp(attendee.cardno, [], [], [], [makeUtsavBooking('usv_self_cf', 'confirmed', attendee.cardno)], [], null);

  } catch (err) {
    console.error("Test execution failed:", err);
  } finally {
    await database.close();
  }
})();
