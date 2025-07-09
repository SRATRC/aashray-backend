// client/adhyayanBooking.controller.integration.test.js
import request from 'supertest';
import { app, sequelize } from '../../../app';
import { CardDb } from '../../../models/associations';
import {
  STATUS_CONFIRMED,
  STATUS_CANCELLED,
  TYPE_ADHYAYAN
} from '../../../config/constants';

import ShibirBookingFactory from '../../factories/shibirBookingFactory.js';
jest.mock('../../../utils/sendMail.js');

describe('Adhyayan Booking Controller', () => {
  describe('Cancel Shibir', () => {
    it('should cancel self booking successfully', async () => {
      const booking = await ShibirBookingFactory.create('Mumukshu_1');
      const res = await request(app)
        .delete('/api/v1/adhyayan/cancel')
        .send({ bookingid: 1, cardno: 'Mumukshu_1' });

      expect(res.status).toBe(200);
      expect(await booking.reload()).toHaveProperty('status', STATUS_CANCELLED);
    });

    test.todo('should cancel guest or mumukshu booking successfully');

    test.todo('should return an error when cancelling a cancelled booking');
    test.todo('should open a seat when cancelling a confirmed booking');
    test.todo('should open a seat when cancelling a payment pending booking');
    test.todo('should send email notification when cancelling a booking');

    it('should return an error when cancelling a non-existent booking', async () => {
      const res = await request(app)
        .delete('/api/v1/adhyayan/cancel')
        .send({ bookingid: 12345, cardno: 'Mumukshu_1' });

      expect(res.status).toBe(404);
      expect(res.body.message).toEqual('Booking not found');
    });
  });

  afterAll(async () => {
    await sequelize.close();
  });
});
