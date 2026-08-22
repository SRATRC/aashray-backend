import request from 'supertest';
import moment from 'moment';
import jwt from 'jsonwebtoken';
import { app, sequelize } from '../../../app.js';
import {
  RoomBooking,
  RoomDb,
  AdminUsers,
  AdminRoles,
  Roles
} from '../../../models/associations.js';
import { STATUS_ACTIVE, ROLE_ROOM_ADMIN } from '../../../config/constants.js';
import { MUMUKSHU_1 } from '../../testConstants.js';

jest.mock('../../../utils/sendMail.js');

const fmt = (m) => m.format('YYYY-MM-DD');

// Set from a real signed admin JWT in beforeAll (the admin routes require auth).
let ADMIN_AUTH;

describe('Admin rolling-window warning (non-blocking: create + warn)', () => {
  beforeAll(async () => {
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
    await RoomBooking.truncate();
    await RoomDb.truncate();
    await AdminRoles.truncate();
    await AdminUsers.truncate();
    await Roles.truncate();
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

    // Admin auth fixture: a room-admin user with a valid signed JWT.
    const role = await Roles.create({
      name: ROLE_ROOM_ADMIN,
      status: STATUS_ACTIVE,
      updatedBy: 'test'
    });
    const adminUser = await AdminUsers.create({
      username: 'test_room_admin',
      password: 'x', // NOT NULL; never validated by the auth middleware
      status: STATUS_ACTIVE
    });
    await AdminRoles.create({
      user_id: adminUser.id,
      role_name: role.name,
      status: STATUS_ACTIVE,
      updatedBy: 'test'
    });
    const token = jwt.sign(
      { user: { id: adminUser.id, username: adminUser.username } },
      process.env.SECRET
    );
    ADMIN_AUTH = { Authorization: `Bearer ${token}` };
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
