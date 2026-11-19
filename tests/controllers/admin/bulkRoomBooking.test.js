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
    expect(res.body.data.results).toHaveLength(2);
    const room1 = res.body.data.results[0].roomno;
    const room2 = res.body.data.results[1].roomno;
    expect(room1).toBeTruthy();
    expect(room2).toBeTruthy();
    expect(room1).not.toBe(room2);
    expect(res.body.data.results[0].status).toBe('booked');
    expect(res.body.data.results[1].status).toBe('booked');
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
    expect(res.body.data.results[0].warning).toBeDefined();
    expect(res.body.data.results[0].warning.windowNights).toBe(11);
  });
});
