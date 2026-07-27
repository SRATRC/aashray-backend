import request from 'supertest';
import moment from 'moment';
import { app, sequelize } from '../../../app.js';
import { RoomBooking, RoomDb } from '../../../models/associations.js';
import { STATUS_WAITING, HOLD_REASON } from '../../../config/constants.js';
import { MUMUKSHU_1 } from '../../testConstants.js';

jest.mock('../../../utils/sendMail.js');

const fmt = (m) => m.format('YYYY-MM-DD');

// NOTE: reconcile this payload with tests/controllers/client/mumukshuBooking.controller.test.js
// (reuse its room-booking JSON helper if the shape differs).
const roomBookingJson = (checkin, checkout) => ({
  booking_type: 'room',
  details: {
    checkin_date: checkin,
    checkout_date: checkout,
    room_type: 'ac',
    floor_pref: ''
  }
});

describe('Room rolling-window cap (client)', () => {
  beforeAll(async () => {
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
    await RoomBooking.truncate();
    await RoomDb.truncate();
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
    // Plenty of available rooms so waiting is caused by the CAP, not scarcity.
    for (let i = 1; i <= 5; i++) {
      await RoomDb.create({
        roomno: `${i}A`,
        roomtype: 'ac',
        gender: 'M',
        roomstatus: 'available',
        updatedBy: 'admin'
      });
    }
  });

  beforeEach(async () => {
    await RoomBooking.truncate();
  });

  it('forces the whole stay to waiting when the request alone exceeds 9 nights', async () => {
    const checkin = fmt(moment().add(1, 'day'));
    const checkout = fmt(moment().add(12, 'day')); // 11 nights

    const res = await request(app)
      .post('/api/v1/mumukshu/booking')
      .send({ cardno: MUMUKSHU_1, primary_booking: roomBookingJson(checkin, checkout) });

    expect(res.status).toBe(200);
    const bookings = await RoomBooking.findAll({ where: { cardno: MUMUKSHU_1 } });
    expect(bookings.length).toBeGreaterThan(0);
    expect(bookings.every((b) => b.status === STATUS_WAITING)).toBe(true);
    expect(bookings.every((b) => b.roomno === 'NA')).toBe(true);
  });

  it('books normally (not waiting) for a 9-night stay', async () => {
    const checkin = fmt(moment().add(1, 'day'));
    const checkout = fmt(moment().add(10, 'day')); // 9 nights

    await request(app)
      .post('/api/v1/mumukshu/booking')
      .send({ cardno: MUMUKSHU_1, primary_booking: roomBookingJson(checkin, checkout) });

    const bookings = await RoomBooking.findAll({ where: { cardno: MUMUKSHU_1 } });
    expect(bookings.some((b) => b.status === STATUS_WAITING && b.roomno === 'NA')).toBe(false);
  });

  it('persists the userReason in hold_reason_meta and creates NO Razorpay order when a reason is sent', async () => {
    const checkin = fmt(moment().add(1, 'day'));
    const checkout = fmt(moment().add(12, 'day')); // 11 nights
    const reason = 'Extended stay for medical treatment';

    const res = await request(app)
      .post('/api/v1/mumukshu/booking')
      .send({
        cardno: MUMUKSHU_1,
        extra_stay_reason: reason,
        primary_booking: roomBookingJson(checkin, checkout)
      });

    expect(res.status).toBe(200);
    // A waiting-only (zero-charge) booking must not open a Razorpay order.
    expect(res.body.order.id).toBeUndefined();

    const bookings = await RoomBooking.findAll({ where: { cardno: MUMUKSHU_1 } });
    expect(bookings.length).toBeGreaterThan(0);
    expect(bookings.every((b) => b.status === STATUS_WAITING)).toBe(true);
    expect(
      bookings.every((b) => b.hold_reason === HOLD_REASON.ROLLING_WINDOW_LIMIT)
    ).toBe(true);
    expect(
      bookings.every(
        (b) => b.hold_reason_meta && b.hold_reason_meta.userReason === reason
      )
    ).toBe(true);
  });

  it('omits the userReason key from hold_reason_meta when no reason is sent', async () => {
    const checkin = fmt(moment().add(1, 'day'));
    const checkout = fmt(moment().add(12, 'day')); // 11 nights

    const res = await request(app)
      .post('/api/v1/mumukshu/booking')
      .send({ cardno: MUMUKSHU_1, primary_booking: roomBookingJson(checkin, checkout) });

    expect(res.status).toBe(200);
    const bookings = await RoomBooking.findAll({ where: { cardno: MUMUKSHU_1 } });
    expect(bookings.length).toBeGreaterThan(0);
    expect(
      bookings.every((b) => b.hold_reason === HOLD_REASON.ROLLING_WINDOW_LIMIT)
    ).toBe(true);
    // meta still carries windowNights/limit, but the userReason key is absent.
    expect(
      bookings.every(
        (b) =>
          b.hold_reason_meta &&
          b.hold_reason_meta.userReason === undefined &&
          typeof b.hold_reason_meta.limit === 'number'
      )
    ).toBe(true);
  });

  it('accepts a reason nested under primary_booking.details (the app double-nests it)', async () => {
    const checkin = fmt(moment().add(1, 'day'));
    const checkout = fmt(moment().add(12, 'day')); // 11 nights
    const reason = 'Nested reason from the app';

    const primary = roomBookingJson(checkin, checkout);
    primary.details.extra_stay_reason = reason;

    const res = await request(app)
      .post('/api/v1/mumukshu/booking')
      .send({ cardno: MUMUKSHU_1, primary_booking: primary });

    expect(res.status).toBe(200);
    const bookings = await RoomBooking.findAll({ where: { cardno: MUMUKSHU_1 } });
    expect(bookings.length).toBeGreaterThan(0);
    expect(
      bookings.every(
        (b) => b.hold_reason_meta && b.hold_reason_meta.userReason === reason
      )
    ).toBe(true);
  });
});
