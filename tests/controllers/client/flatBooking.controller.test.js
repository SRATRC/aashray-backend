import request from 'supertest';
import { app, sequelize } from '../../../app.js';
import { CardDb, FlatBooking, FlatDb } from '../../../models/associations.js';
import {
  TYPE_FLAT,
  TYPE_ROOM,
  TYPE_UTSAV,
  STATUS_PAYMENT_PENDING,
  ROOM_STATUS_PENDING_CHECKIN,
  MSG_BOOKING_SUCCESSFUL
} from '../../../config/constants.js';
import { MUMUKSHU_1, TODAY } from '../../testConstants.js';
import { nDaysFromToday } from '../../helpers/date.helper.js';
import FlatFactory from '../../factories/flatFactory.js';

jest.mock('../../../utils/sendMail.js');

describe('Flat Booking Integration Tests', () => {
  beforeAll(async () => {
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
    await FlatBooking.truncate();
    await FlatDb.truncate();
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');

    // Create a flat for testing
    await FlatFactory.create(MUMUKSHU_1, 101);
  });

  describe('Mumukshu Flat Booking as Primary Booking', () => {
    beforeEach(async () => {
      await FlatBooking.truncate();
    });

    it('should book flat successfully as primary booking', async () => {
      const startDay = nDaysFromToday(1);
      const endDay = nDaysFromToday(3);

      const res = await request(app)
        .post('/api/v1/mumukshu/booking')
        .send({
          cardno: MUMUKSHU_1,
          primary_booking: createFlatBookingJson(MUMUKSHU_1, startDay, endDay)
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe(MSG_BOOKING_SUCCESSFUL);

      const booking = await FlatBooking.findOne({
        where: {
          cardno: MUMUKSHU_1,
          checkin: startDay,
          checkout: endDay,
          nights: 2
        }
      });

      expect(booking).not.toBeNull();
      expect(booking.flatno).toBe(101);
      expect(booking.status).toBe(ROOM_STATUS_PENDING_CHECKIN); // Flat owner gets free booking
    });

    it('should validate flat booking successfully', async () => {
      const startDay = nDaysFromToday(1);
      const endDay = nDaysFromToday(3);

      const res = await request(app)
        .post('/api/v1/mumukshu/validate')
        .send({
          cardno: MUMUKSHU_1,
          primary_booking: createFlatBookingJson(MUMUKSHU_1, startDay, endDay)
        });

      expect(res.status).toBe(200);
      expect(res.body.data.flatDetails).toBeDefined();
      expect(res.body.data.flatDetails).toHaveLength(1);
      expect(res.body.data.flatDetails[0].flatno).toBe(101);
      expect(res.body.data.flatDetails[0].charge).toBe(0); // Flat owner gets free booking
      expect(res.body.data.flatDetails[0].availableCredits).toBe(0); // No credits needed for free booking
    });

    it('should reject flat booking as addon', async () => {
      const startDay = nDaysFromToday(1);
      const endDay = nDaysFromToday(3);

      const res = await request(app)
        .post('/api/v1/mumukshu/booking')
        .send({
          cardno: MUMUKSHU_1,
          primary_booking: createRoomBookingJson(MUMUKSHU_1, startDay, endDay),
          addons: [createFlatBookingJson(MUMUKSHU_1, startDay, endDay)]
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain(
        'Flat booking cannot be added as an addon'
      );
    });

    it('should reject flat booking with room addon', async () => {
      const startDay = nDaysFromToday(1);
      const endDay = nDaysFromToday(3);

      const res = await request(app)
        .post('/api/v1/mumukshu/booking')
        .send({
          cardno: MUMUKSHU_1,
          primary_booking: createFlatBookingJson(MUMUKSHU_1, startDay, endDay),
          addons: [createRoomBookingJson(MUMUKSHU_1, startDay, endDay)]
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain(
        'Flat booking cannot be combined with other accommodation types'
      );
    });

    it('should reject flat booking without flat ownership', async () => {
      const startDay = nDaysFromToday(1);
      const endDay = nDaysFromToday(3);

      const res = await request(app)
        .post('/api/v1/mumukshu/booking')
        .send({
          cardno: 'Mumukshu_2', // Different user who doesn't own a flat
          primary_booking: createFlatBookingJson('Mumukshu_2', startDay, endDay)
        });

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('Flat not found');
    });
  });

  describe('Guest Flat Booking as Primary Booking', () => {
    beforeEach(async () => {
      await FlatBooking.truncate();
    });

    it('should book flat successfully for guest as primary booking', async () => {
      const startDay = nDaysFromToday(1);
      const endDay = nDaysFromToday(3);

      const res = await request(app)
        .post('/api/v1/guest/booking')
        .send({
          cardno: MUMUKSHU_1, // Flat owner booking for guest
          primary_booking: createGuestFlatBookingJson(
            ['Guest_1'],
            startDay,
            endDay
          )
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe(MSG_BOOKING_SUCCESSFUL);

      const booking = await FlatBooking.findOne({
        where: {
          cardno: 'Guest_1',
          checkin: startDay,
          checkout: endDay,
          nights: 2
        }
      });

      expect(booking).not.toBeNull();
      expect(booking.flatno).toBe(101);
      expect(booking.bookedBy).toBe(MUMUKSHU_1);
    });

    it('should validate guest flat booking successfully', async () => {
      const startDay = nDaysFromToday(1);
      const endDay = nDaysFromToday(3);

      const res = await request(app)
        .post('/api/v1/guest/validate')
        .send({
          cardno: MUMUKSHU_1,
          primary_booking: createGuestFlatBookingJson(
            ['Guest_1'],
            startDay,
            endDay
          )
        });

      expect(res.status).toBe(200);
      expect(res.body.data.flatDetails).toBeDefined();
      expect(res.body.data.flatDetails).toHaveLength(1);
      expect(res.body.data.flatDetails[0].flatno).toBe(101);
      expect(res.body.data.flatDetails[0]).toHaveProperty('availableCredits');
    });

    it('should validate flat booking with credit information for non-owner', async () => {
      const startDay = nDaysFromToday(1);
      const endDay = nDaysFromToday(3);

      const res = await request(app)
        .post('/api/v1/mumukshu/validate')
        .send({
          cardno: MUMUKSHU_1,
          primary_booking: createFlatBookingJson(
            'Non_Owner_1',
            startDay,
            endDay
          )
        });

      expect(res.status).toBe(200);
      expect(res.body.data.flatDetails).toBeDefined();
      expect(res.body.data.flatDetails).toHaveLength(1);
      expect(res.body.data.flatDetails[0].flatno).toBe(101);
      expect(res.body.data.flatDetails[0].charge).toBeGreaterThan(0); // Non-owner pays charge
      expect(res.body.data.flatDetails[0]).toHaveProperty('availableCredits');
      expect(typeof res.body.data.flatDetails[0].availableCredits).toBe(
        'number'
      );
    });
  });

  describe('Backward Compatibility - Deprecated Endpoints', () => {
    beforeEach(async () => {
      await FlatBooking.truncate();
    });

    it('should still work with deprecated mumukshu flat booking endpoint', async () => {
      const startDay = nDaysFromToday(1);
      const endDay = nDaysFromToday(3);

      const res = await request(app)
        .post('/api/v1/room/flat')
        .send({
          cardno: MUMUKSHU_1,
          mumukshus: [{ cardno: MUMUKSHU_1 }],
          startDay: startDay,
          endDay: endDay
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe(MSG_BOOKING_SUCCESSFUL);

      const booking = await FlatBooking.findOne({
        where: {
          cardno: MUMUKSHU_1,
          checkin: startDay,
          checkout: endDay
        }
      });

      expect(booking).not.toBeNull();
    });

    it('should still work with deprecated guest flat booking endpoint', async () => {
      const startDay = nDaysFromToday(1);
      const endDay = nDaysFromToday(3);

      const res = await request(app)
        .post('/api/v1/guest/flat')
        .send({
          cardno: MUMUKSHU_1,
          guests: ['Guest_1'],
          startDay: startDay,
          endDay: endDay
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe(MSG_BOOKING_SUCCESSFUL);

      const booking = await FlatBooking.findOne({
        where: {
          cardno: 'Guest_1',
          checkin: startDay,
          checkout: endDay
        }
      });

      expect(booking).not.toBeNull();
    });
  });

  afterAll(async () => {
    await sequelize.close();
  });
});

// Helper functions to create booking JSON objects
function createFlatBookingJson(cardno, startDay, endDay) {
  return {
    booking_type: TYPE_FLAT,
    details: {
      startDay: startDay,
      endDay: endDay,
      mumukshus: [cardno]
    }
  };
}

function createGuestFlatBookingJson(guests, startDay, endDay) {
  return {
    booking_type: TYPE_FLAT,
    details: {
      startDay: startDay,
      endDay: endDay,
      guests: guests
    }
  };
}

function createRoomBookingJson(cardno, checkin, checkout) {
  return {
    booking_type: TYPE_ROOM,
    details: {
      checkin_date: checkin,
      checkout_date: checkout,
      mumukshuGroup: [
        {
          roomType: 'ac',
          floorType: '',
          mumukshus: [cardno]
        }
      ]
    }
  };
}
