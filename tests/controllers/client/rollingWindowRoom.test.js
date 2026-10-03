import request from 'supertest';
import moment from 'moment';
import { app, sequelize } from '../../../app.js';
import { RoomBooking, RoomDb } from '../../../models/associations.js';
import { STATUS_WAITING } from '../../../config/constants.js';
import { MUMUKSHU_1 } from '../../testConstants.js';
import RoomFactory from '../../factories/roomFactory.js';

jest.mock('../../../utils/sendMail.js');

const fmt = (m) => m.format('YYYY-MM-DD');

const roomBookingJson = (checkin, checkout) => ({
  booking_type: 'room',
  details: {
    checkin_date: checkin,
    checkout_date: checkout,
    mumukshuGroup: [
      {
        roomType: 'ac',
        floorType: '',
        mumukshus: [MUMUKSHU_1]
      }
    ]
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
    // Truncating RoomDb above also wiped the global 'NA' single-day-visit room
    // that globalSetup seeded — waiting-room bookings FK to it, and other
    // suites running after this one in the same process expect it too.
    await RoomFactory.createRoomFor1DayVisit();
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

    const res = await request(app)
      .post('/api/v1/mumukshu/booking')
      .send({ cardno: MUMUKSHU_1, primary_booking: roomBookingJson(checkin, checkout) });

    expect(res.status).toBe(200);
    const bookings = await RoomBooking.findAll({ where: { cardno: MUMUKSHU_1 } });
    expect(bookings.length).toBeGreaterThan(0);
    expect(bookings.some((b) => b.status === STATUS_WAITING && b.roomno === 'NA')).toBe(false);
  });
});
