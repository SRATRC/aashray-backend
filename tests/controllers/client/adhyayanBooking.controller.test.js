// client/adhyayanBooking.controller.integration.test.js
import request from 'supertest';
import { app, sequelize } from '../../../app';
import { CardDb } from '../../../models/associations';
import { STATUS_CONFIRMED, STATUS_CANCELLED, TYPE_ADHYAYAN } from '../../../config/constants';

describe('Adhyayan Booking Controller', () => {
  beforeAll(() => {
    jest.spyOn(CardDb, 'findOne').mockResolvedValue({
      id: 1,
      cardno: 1234
    });
  });
  
  
  describe('Cancel Shibir', () => {

    test.todo('should cancel self booking successfully');
    test.todo('should cancel guest or mumukshu booking successfully');

    test.todo('should return an error when cancelling a cancelled booking');
    test.todo('should open a seat when cancelling a confirmed booking');
    test.todo('should open a seat when cancelling a payment pending booking');
    test.todo('should send email notification when cancelling a booking');


    it('should return an error when cancelling a non-existent booking', async () => {
      const res = await request(app)
      .delete('/api/v1/adhyayan/cancel')
      .send({ bookingid: 12345, cardno: 1234 });

      expect(res.status).toBe(404);
      expect(res.body.message).toEqual('Booking not found');
    });
  });

  afterAll(async () => {
    await sequelize.close();

  });
});
