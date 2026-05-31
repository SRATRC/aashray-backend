import './config/environment.js';
import database from './config/database.js';
import { CardDb, Transactions } from './models/associations.js';
import { sendRoomStatusChangeWhatsApp } from './helpers/whatsapp.helper.js';

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

    // Stub CardDb.findOne to ensure subsequent lookups return these modified instances
    const originalFindOne = CardDb.findOne;
    CardDb.findOne = async (options) => {
      const cardno = options?.where?.cardno;
      if (cardno === '0002945690') return booker;
      if (cardno === '0002826713') return attendee;
      return originalFindOne.call(CardDb, options);
    };

    // Stub Transactions.findOne to simulate credits refunded lookup
    const originalTxFindOne = Transactions.findOne;
    Transactions.findOne = async (options) => {
      const bookingid = options?.where?.bookingid;
      if (bookingid && (bookingid.includes('pgci2cn') || bookingid.includes('pgci2acan') || bookingid.includes('pndgchki2canc') || bookingid.includes('pgci2acn'))) {
        return {
          status: 'credited',
          amount: 1400,
          discount: 0
        };
      }
      return originalTxFindOne.call(Transactions, options);
    };

    // Helper to make fake room booking objects
    const makeRoomBooking = (id, status, roomtype, bookedByVal = null) => ({
      bookingid: id,
      bookingId: id,
      id: id,
      status: status,
      roomtype: roomtype,
      roomno: '25',
      checkin: '2026-06-18',
      checkout: '2026-06-20',
      bookedBy: bookedByVal,
      cardno: attendee.cardno
    });

    console.log("=== 1. Testing Self Booker Room Transition Templates (12 cases) ===");

    // 1. Self - Waiting to Cancelled -> bk_sha_s_b_w2cn
    console.log("\nCase 1: Self Waiting to Cancelled (bk_sha_s_b_w2cn)");
    await sendRoomStatusChangeWhatsApp(makeRoomBooking('self_w2cn', 'cancelled', 'nac'), 'waiting');

    // 2. Self - Waiting to Admin Cancelled -> bk_sha_s_b_w2acn
    console.log("\nCase 2: Self Waiting to Admin Cancelled (bk_sha_s_b_w2acn)");
    await sendRoomStatusChangeWhatsApp(makeRoomBooking('self_w2acn', 'admin cancelled', 'nac'), 'waiting');

    // 3. Self - Waiting to Payment Pending -> bk_sha_s_b_w2ppg
    console.log("\nCase 3: Self Waiting to Payment Pending (bk_sha_s_b_w2ppg)");
    await sendRoomStatusChangeWhatsApp(makeRoomBooking('self_w2ppg', 'payment pending', 'nac'), 'waiting');

    // 4. Self - Payment Pending to Cancelled -> bk_sha_s_b_ppg2can
    console.log("\nCase 4: Self Pending to Cancelled (bk_sha_s_b_ppg2can)");
    await sendRoomStatusChangeWhatsApp(makeRoomBooking('self_ppg2can', 'cancelled', 'nac'), 'payment pending');

    // 5. Self - Payment Pending to Admin Cancelled (Cron) -> bk_sha_s_b_ppg2acn_c
    console.log("\nCase 5: Self Pending to Admin Cancelled - Cron (bk_sha_s_b_ppg2acn_c)");
    await sendRoomStatusChangeWhatsApp(makeRoomBooking('self_ppg2acn_c', 'admin cancelled', 'nac'), 'payment pending', { isCron: true });

    // 6. Self - Payment Pending to Admin Cancelled (Admin) -> bk_sha_s_b_ppg2acn_a
    console.log("\nCase 6: Self Pending to Admin Cancelled - Admin (bk_sha_s_b_ppg2acn_a)");
    await sendRoomStatusChangeWhatsApp(makeRoomBooking('self_ppg2acn_a', 'admin cancelled', 'nac'), 'payment pending', { updatedBy: 'admin' });

    // 7. Self - Payment Pending to Pending Checkin -> bk_sha_s_b_ppg2pgci
    console.log("\nCase 7: Self Pending to Pending Checkin (bk_sha_s_b_ppg2pgci)");
    await sendRoomStatusChangeWhatsApp(makeRoomBooking('self_ppg2pgci', 'pending checkin', 'nac'), 'payment pending');

    // 8. Self - Pending Checkin to Cancelled -> bk_sha_s_b_pgci2cn
    console.log("\nCase 8: Self Pending Checkin to Cancelled (bk_sha_s_b_pgci2cn)");
    await sendRoomStatusChangeWhatsApp(makeRoomBooking('self_pgci2cn', 'cancelled', 'nac'), 'pending checkin');

    // 9. Self - Pending Checkin to Admin Cancelled -> bk_sha_s_b_pgci2acan
    console.log("\nCase 9: Self Pending Checkin to Admin Cancelled (bk_sha_s_b_pgci2acan)");
    await sendRoomStatusChangeWhatsApp(makeRoomBooking('self_pgci2acan', 'admin cancelled', 'nac'), 'pending checkin');

    // 10. Self - Pending Checkin to Checkedin -> bk_sha_s_b_pci2ci
    console.log("\nCase 10: Self Pending Checkin to Checkedin (bk_sha_s_b_pci2ci)");
    await sendRoomStatusChangeWhatsApp(makeRoomBooking('self_pci2ci', 'checkedin', 'nac'), 'pending checkin');

    // 11. Self - Checkedin to Checkedout (No fee) -> bk_sha_s_b_ci2co
    console.log("\nCase 11: Self Checkedin to Checkedout - No Fee (bk_sha_s_b_ci2co)");
    await sendRoomStatusChangeWhatsApp(makeRoomBooking('self_ci2co', 'checkedout', 'nac'), 'checkedin', { checkoutTime: '10:00 AM' });

    // 12. Self - Checkedin to Checkedout (Late Checkout Fee) -> bk_sha_s_b_ci2co_lcf
    console.log("\nCase 12: Self Checkedin to Checkedout - Late Fee (bk_sha_s_b_ci2co_lcf)");
    await sendRoomStatusChangeWhatsApp(makeRoomBooking('self_ci2co_lcf', 'checkedout', 'nac'), 'checkedin', { checkoutTime: '2:00 PM', lateFee: 350 });


    console.log("\n=== 2. Testing Guest Booker Room Transition Templates (9 cases) ===");

    // 13. Guest - Waiting to Cancelled -> bk_sha_gu_b_wtg2cnfm
    console.log("\nCase 13: Guest Waiting to Cancelled (bk_sha_gu_b_wtg2cnfm)");
    await sendRoomStatusChangeWhatsApp(makeRoomBooking('guest_wtg2cnfm', 'cancelled', 'nac', booker.cardno), 'waiting');

    // 14. Guest - Waiting to Admin Cancelled -> bk_sha_gu_b_w2acn
    console.log("\nCase 14: Guest Waiting to Admin Cancelled (bk_sha_gu_b_w2acn)");
    await sendRoomStatusChangeWhatsApp(makeRoomBooking('guest_w2acn', 'admin cancelled', 'nac', booker.cardno), 'waiting');

    // 15. Guest - Waiting to Payment Pending -> bk_sha_gu_b_w2ppg
    console.log("\nCase 15: Guest Waiting to Payment Pending (bk_sha_gu_b_w2ppg)");
    await sendRoomStatusChangeWhatsApp(makeRoomBooking('guest_w2ppg', 'payment pending', 'nac', booker.cardno), 'waiting');

    // 16. Guest - Payment Pending to Cancelled -> bk_sha_gu_b_ppg2cn
    console.log("\nCase 16: Guest Pending to Cancelled (bk_sha_gu_b_ppg2cn)");
    await sendRoomStatusChangeWhatsApp(makeRoomBooking('guest_ppg2cn', 'cancelled', 'nac', booker.cardno), 'payment pending');

    // 17. Guest - Payment Pending to Admin Cancelled (Cron) -> bk_sha_gu_b_ppg2acn_c
    console.log("\nCase 17: Guest Pending to Admin Cancelled - Cron (bk_sha_gu_b_ppg2acn_c)");
    await sendRoomStatusChangeWhatsApp(makeRoomBooking('guest_ppg2acn_c', 'admin cancelled', 'nac', booker.cardno), 'payment pending', { isCron: true });

    // 18. Guest - Payment Pending to Admin Cancelled (Admin) -> bk_sha_gu_b_ppg2acn_a
    console.log("\nCase 18: Guest Pending to Admin Cancelled - Admin (bk_sha_gu_b_ppg2acn_a)");
    await sendRoomStatusChangeWhatsApp(makeRoomBooking('guest_ppg2acn_a', 'admin cancelled', 'nac', booker.cardno), 'payment pending', { updatedBy: 'admin' });

    // 19. Guest - Payment Pending to Pending Checkin -> bk_sha_gu_b_pypnd2pndchki
    console.log("\nCase 19: Guest Pending to Pending Checkin (bk_sha_gu_b_pypnd2pndchki)");
    await sendRoomStatusChangeWhatsApp(makeRoomBooking('guest_pypnd2pndchki', 'pending checkin', 'nac', booker.cardno), 'payment pending');

    // 20. Guest - Pending Checkin to Cancelled -> bk_sha_gu_b_pndgchki2canc
    console.log("\nCase 20: Guest Pending Checkin to Cancelled (bk_sha_gu_b_pndgchki2canc)");
    await sendRoomStatusChangeWhatsApp(makeRoomBooking('guest_pndgchki2canc', 'cancelled', 'nac', booker.cardno), 'pending checkin');

    // 21. Guest - Pending Checkin to Admin Cancelled -> bk_sha_gu_b_pgci2acn
    console.log("\nCase 21: Guest Pending Checkin to Admin Cancelled (bk_sha_gu_b_pgci2acn)");
    await sendRoomStatusChangeWhatsApp(makeRoomBooking('guest_pgci2acn', 'admin cancelled', 'nac', booker.cardno), 'pending checkin');

  } catch (err) {
    console.error("Test execution failed:", err);
  } finally {
    await database.close();
  }
})();
