import request from 'supertest';
import moment from 'moment';
import { app, sequelize } from '../../../app.js';
import { RoomBooking, RoomDb } from '../../../models/associations.js';
import {
  STATUS_WAITING,
  STATUS_PAYMENT_PENDING,
  HOLD_REASON
} from '../../../config/constants.js';
import { MUMUKSHU_1 } from '../../testConstants.js';
import { createAdminAuth } from '../../helpers/adminAuthFixture.js';

jest.mock('../../../utils/sendMail.js');

const fmt = (m) => m.format('YYYY-MM-DD');

// Set from a real signed admin JWT in beforeAll (the admin routes require auth).
let ADMIN_AUTH;

describe('Admin rolling-window warning (non-blocking: create + warn)', () => {
  beforeAll(async () => {
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
    await RoomBooking.truncate();
    await RoomDb.truncate();
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
    for (let i = 1; i <= 5; i++) {
      await RoomDb.create({
        roomno: `${i}A`,
        roomtype: 'ac',
        gender: 'M',
        roomstatus: 'available',
        updatedBy: 'admin'
      });
    }

    ADMIN_AUTH = await createAdminAuth(sequelize, 'test_room_admin');
  });

  beforeEach(async () => {
    await RoomBooking.truncate();
  });

  it('over cap: still creates the booking AND returns a warning', async () => {
    const checkin = fmt(moment().add(1, 'day'));
    const checkout = fmt(moment().add(12, 'day')); // 11 nights

    const res = await request(app)
      .post('/api/v1/admin/stay/bookForMumukshu')
      .set(ADMIN_AUTH)
      .send({ cardno: MUMUKSHU_1, checkin_date: checkin, checkout_date: checkout, room_type: 'ac', floor_pref: '' });

    expect(res.status).toBe(201);
    expect(res.body.warning).toBeTruthy();
    expect(res.body.warning.windowNights).toBeDefined();
    const bookings = await RoomBooking.findAll({ where: { cardno: MUMUKSHU_1 } });
    expect(bookings.length).toBeGreaterThan(0); // booking WAS created (no hard stop)
  });

  it('within cap: creates the booking with no warning', async () => {
    const checkin = fmt(moment().add(1, 'day'));
    const checkout = fmt(moment().add(6, 'day')); // 5 nights

    const res = await request(app)
      .post('/api/v1/admin/stay/bookForMumukshu')
      .set(ADMIN_AUTH)
      .send({ cardno: MUMUKSHU_1, checkin_date: checkin, checkout_date: checkout, room_type: 'ac', floor_pref: '' });

    expect(res.status).toBe(201);
    expect(res.body.warning).toBeUndefined();
    const bookings = await RoomBooking.findAll({ where: { cardno: MUMUKSHU_1 } });
    expect(bookings.length).toBeGreaterThan(0);
  });

  it('promotion (waiting -> payment_pending) of a cap-hold booking succeeds AND returns a warning when still over cap', async () => {
    const checkin = fmt(moment().add(1, 'day'));
    const checkout = fmt(moment().add(12, 'day')); // 11 nights, over the 9-night cap on its own
    const bookingid = 'test-promo-cap-hold-1';

    // Simulate what the client funnel already produced: a booking parked in
    // `waiting` with hold_reason=ROLLING_WINDOW_LIMIT, unassigned room ('NA'),
    // awaiting admin approval.
    await RoomBooking.create({
      bookingid,
      cardno: MUMUKSHU_1,
      bookedBy: MUMUKSHU_1,
      roomno: 'NA',
      checkin,
      checkout,
      nights: 11,
      roomtype: 'ac',
      gender: 'M',
      status: STATUS_WAITING,
      hold_reason: HOLD_REASON.ROLLING_WINDOW_LIMIT,
      hold_reason_meta: { windowNights: 11, limit: 9 },
      updatedBy: 'test'
    });

    const res = await request(app)
      .put('/api/v1/admin/stay/update_booking_status')
      .set(ADMIN_AUTH)
      .send({ bookingid, status: STATUS_PAYMENT_PENDING });

    expect(res.status).toBe(200);
    // Non-blocking: promotion succeeds even though the stay is still over cap.
    expect(res.body.warning).toBeTruthy();
    expect(res.body.warning.windowNights).toBeDefined();

    const updated = await RoomBooking.findOne({ where: { bookingid } });
    expect(updated.status).toBe(STATUS_PAYMENT_PENDING);
    // findRoom auto-assign-on-promote should have replaced the 'NA' placeholder,
    // coexisting with the cap warning above.
    expect(updated.roomno).not.toBe('NA');
  });
});
