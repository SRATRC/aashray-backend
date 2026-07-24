import request from 'supertest';
import moment from 'moment';
import { app, sequelize } from '../../../app.js';
import { RoomBooking, RoomDb } from '../../../models/associations.js';
import { MUMUKSHU_1 } from '../../testConstants.js';

jest.mock('../../../utils/sendMail.js');

const fmt = (m) => m.format('YYYY-MM-DD');

// NOTE: fill ADMIN_AUTH with the header/token pattern used by other admin
// tests/routes (admin routes require staff auth). e.g. { Authorization: `Bearer ${adminToken}` }.
const ADMIN_AUTH = {};

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
  });

  beforeEach(async () => {
    await RoomBooking.truncate();
  });

  it('over cap: still creates the booking AND returns a warning', async () => {
    const checkin = fmt(moment().add(1, 'day'));
    const checkout = fmt(moment().add(12, 'day')); // 11 nights

    const res = await request(app)
      .post('/api/v1/admin/bookForMumukshu')
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
      .post('/api/v1/admin/bookForMumukshu')
      .set(ADMIN_AUTH)
      .send({ cardno: MUMUKSHU_1, checkin_date: checkin, checkout_date: checkout, room_type: 'ac', floor_pref: '' });

    expect(res.status).toBe(201);
    expect(res.body.warning).toBeUndefined();
    const bookings = await RoomBooking.findAll({ where: { cardno: MUMUKSHU_1 } });
    expect(bookings.length).toBeGreaterThan(0);
  });
});
