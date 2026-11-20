import request from 'supertest';
import moment from 'moment';
import jwt from 'jsonwebtoken';
import { app, sequelize } from '../../../app.js';
import {
  RoomBooking,
  RoomDb,
  CardDb,
  AdminUsers,
  AdminRoles,
  Roles
} from '../../../models/associations.js';
import { STATUS_ACTIVE, ROLE_ROOM_ADMIN } from '../../../config/constants.js';
import RoomFactory from '../../factories/roomFactory.js';

jest.mock('../../../utils/sendMail.js');

const fmt = (m) => m.format('YYYY-MM-DD');

let ADMIN_AUTH;
const TEST_CARD_1 = 'BULK_TEST_1';
const TEST_CARD_2 = 'BULK_TEST_2';

describe('Admin Bulk Room Booking (/api/v1/admin/stay/bulk_book)', () => {
  beforeAll(async () => {
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
    await RoomBooking.truncate();
    await RoomDb.truncate();
    await CardDb.destroy({ where: { cardno: [TEST_CARD_1, TEST_CARD_2] } });
    await AdminRoles.truncate();
    await AdminUsers.truncate();
    await Roles.truncate();
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');

    await RoomDb.bulkCreate([
      { roomno: '1A', roomtype: 'ac', gender: 'M', roomstatus: 'available', updatedBy: 'admin' },
      { roomno: '2A', roomtype: 'ac', gender: 'M', roomstatus: 'available', updatedBy: 'admin' },
      { roomno: '3A', roomtype: 'nac', gender: 'M', roomstatus: 'available', updatedBy: 'admin' },
      { roomno: '1B', roomtype: 'ac', gender: 'F', roomstatus: 'available', updatedBy: 'admin' },
      { roomno: '2B', roomtype: 'ac', gender: 'F', roomstatus: 'available', updatedBy: 'admin' }
    ]);

    await RoomFactory.createRoomFor1DayVisit();

    await CardDb.bulkCreate([
      {
        cardno: TEST_CARD_1,
        issuedto: 'Bulk Guest 1',
        gender: 'M',
        mobno: '9999900001',
        res_status: 'GUEST',
        status: STATUS_ACTIVE,
        dob: '1960-01-01'
      },
      {
        cardno: TEST_CARD_2,
        issuedto: 'Bulk Guest 2',
        gender: 'M',
        mobno: '9999900002',
        res_status: 'GUEST',
        status: STATUS_ACTIVE,
        dob: '1995-05-05'
      }
    ]);

    const role = await Roles.create({
      name: ROLE_ROOM_ADMIN,
      status: STATUS_ACTIVE,
      updatedBy: 'test'
    });
    const adminUser = await AdminUsers.create({
      username: 'test_bulk_admin',
      password: 'x',
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

  afterAll(async () => {
    await CardDb.destroy({ where: { cardno: [TEST_CARD_1, TEST_CARD_2] } });
  });

  it('rejects when card number is missing', async () => {
    const res = await request(app)
      .post('/api/v1/admin/stay/bulk_book')
      .set(ADMIN_AUTH)
      .send({
        checkin_date: fmt(moment().add(1, 'day')),
        checkout_date: fmt(moment().add(3, 'day')),
        bookings: [{ cardno: '', room_type: 'ac' }]
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Card number is required/i);
  });

  it('rejects when room_type is invalid', async () => {
    const res = await request(app)
      .post('/api/v1/admin/stay/bulk_book')
      .set(ADMIN_AUTH)
      .send({
        checkin_date: fmt(moment().add(1, 'day')),
        checkout_date: fmt(moment().add(3, 'day')),
        bookings: [{ cardno: TEST_CARD_1, room_type: 'deluxe' }]
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Invalid room_type/i);
  });

  it('successfully books multiple guests atomically with distinct rooms assigned', async () => {
    const checkin = fmt(moment().add(2, 'day'));
    const checkout = fmt(moment().add(4, 'day'));

    const res = await request(app)
      .post('/api/v1/admin/stay/bulk_book')
      .set(ADMIN_AUTH)
      .send({
        checkin_date: checkin,
        checkout_date: checkout,
        bookings: [
          { cardno: TEST_CARD_1, room_type: 'ac' },
          { cardno: TEST_CARD_2, room_type: 'ac' }
        ]
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toHaveLength(2);
    const room1 = res.body.data[0].roomno;
    const room2 = res.body.data[1].roomno;
    expect(room1).toBeTruthy();
    expect(room2).toBeTruthy();
    expect(room1).not.toBe(room2);
    expect(res.body.data[0].status).toBe('booked');
    expect(res.body.data[1].status).toBe('booked');
  });

  it('rejects duplicate booking when guest already has an active booking for dates', async () => {
    const checkin = fmt(moment().add(2, 'day'));
    const checkout = fmt(moment().add(4, 'day'));

    await request(app)
      .post('/api/v1/admin/stay/bulk_book')
      .set(ADMIN_AUTH)
      .send({
        checkin_date: checkin,
        checkout_date: checkout,
        bookings: [{ cardno: TEST_CARD_1, room_type: 'ac' }]
      });

    const res = await request(app)
      .post('/api/v1/admin/stay/bulk_book')
      .set(ADMIN_AUTH)
      .send({
        checkin_date: checkin,
        checkout_date: checkout,
        bookings: [{ cardno: TEST_CARD_1, room_type: 'ac' }]
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already has an active booking/i);
  });

  it('attaches rolling window warning when stay exceeds 9 nights', async () => {
    const checkin = fmt(moment().add(10, 'day'));
    const checkout = fmt(moment().add(21, 'day')); // 11 nights (> 9)

    const res = await request(app)
      .post('/api/v1/admin/stay/bulk_book')
      .set(ADMIN_AUTH)
      .send({
        checkin_date: checkin,
        checkout_date: checkout,
        bookings: [{ cardno: TEST_CARD_1, room_type: 'ac' }]
      });

    expect(res.status).toBe(201);
    expect(res.body.data[0].warning).toBeDefined();
    expect(res.body.data[0].warning.windowNights).toBe(11);
  });

  it('available_rooms endpoint: offers SCM and M for seniors, and only M for non-seniors', async () => {
    // Also seed a dedicated SCM room
    await RoomDb.findOrCreate({
      where: { roomno: '99A' },
      defaults: { roomno: '99A', roomtype: 'ac', gender: 'SCM', roomstatus: 'available', updatedBy: 'admin' }
    });

    // Senior booking (TEST_CARD_1 has DOB 1960-01-01)
    const seniorBooking = await RoomBooking.create({
      bookingid: 'test-senior-booking',
      cardno: TEST_CARD_1,
      checkin: fmt(moment().add(1, 'day')),
      checkout: fmt(moment().add(3, 'day')),
      nights: 2,
      roomtype: 'ac',
      roomno: '1A',
      gender: 'M',
      status: 'pending checkin'
    });

    const seniorRes = await request(app)
      .get(`/api/v1/admin/stay/available_rooms/${seniorBooking.bookingid}`)
      .set(ADMIN_AUTH);

    expect(seniorRes.status).toBe(200);
    const seniorRoomGenders = seniorRes.body.data.map((r) => r.gender);
    expect(seniorRoomGenders).toContain('SCM');
    expect(seniorRoomGenders).toContain('M');

    // Non-senior booking (TEST_CARD_2 has DOB 1995-05-05)
    const youngBooking = await RoomBooking.create({
      bookingid: 'test-young-booking',
      cardno: TEST_CARD_2,
      checkin: fmt(moment().add(1, 'day')),
      checkout: fmt(moment().add(3, 'day')),
      nights: 2,
      roomtype: 'ac',
      roomno: '2A',
      gender: 'M',
      status: 'pending checkin'
    });

    const youngRes = await request(app)
      .get(`/api/v1/admin/stay/available_rooms/${youngBooking.bookingid}`)
      .set(ADMIN_AUTH);

    expect(youngRes.status).toBe(200);
    const youngRoomGenders = youngRes.body.data.map((r) => r.gender);
    expect(youngRoomGenders).not.toContain('SCM');
    expect(youngRoomGenders).toContain('M');
  });
});
