// client/adhyayanBooking.controller.integration.test.js
import request from 'supertest';
import { app, sequelize } from '../../../app';
import { CardDb } from '../../../models/associations';
import { STATUS_CONFIRMED, STATUS_CANCELLED, TYPE_ADHYAYAN } from '../../../config/constants';

describe('Cancel Shibir', () => {
  beforeAll(() => {
    jest.spyOn(CardDb, 'findOne').mockResolvedValue({
      id: 1,
      cardno: 1234
    });
  });
  

  describe('Cancel Shibir', () => {
    // it('should cancel a shibir booking', async () => {
    //   // Create a shibir and a booking in the database
    //   const shibir = await ShibirDb.create({
    //     name: 'Test Shibir',
    //     description: 'This is a test shibir',
    //     date: new Date(),
    //   });
    //   const booking = await ShibirBookingDb.create({
    //     shibirId: shibir.id,
    //     status: STATUS_CONFIRMED,
    //     type: TYPE_ADHYAYAN,
    //   });

    //   const res = await request(app)
    //     .delete(`/api/v1/adhyayan/cancel`)
    //     .send({ bookingid: booking.id });

    //   expect(res.status).toBe(200);
    //   expect(res.body).toEqual({
    //     id: booking.id,
    //     shibirId: shibir.id,
    //     status: STATUS_CANCELLED,
    //     type: TYPE_ADHYAYAN,
    //   });

    //   // Verify that the booking status has been updated in the database
    //   const updatedBooking = await ShibirBookingDb.findByPk(booking.id);
    //   expect(updatedBooking.status).toBe(STATUS_CANCELLED);
    // });

    it('should return an error when cancelling a non-existent booking', async () => {
      const res = await request(app)
      .delete('/api/v1/adhyayan/cancel')
      .send({ bookingid: 12345, cardno: 1234 });

      expect(res.status).toBe(404);
      expect(res.body.message).toEqual('Booking not found');
    });

    // it('should return an error when cancelling a booking that is already cancelled', async () => {
    //   // Create a shibir and a booking in the database
    //   const shibir = await ShibirDb.create({
    //     name: 'Test Shibir',
    //     description: 'This is a test shibir',
    //     date: new Date(),
    //   });
    //   const booking = await ShibirBookingDb.create({
    //     shibirId: shibir.id,
    //     status: STATUS_CANCELLED,
    //     type: TYPE_ADHYAYAN,
    //   });

    //   const res = await request(app)
    //     .delete('/api/v1/adhyayan/cancel')
    //     .send({ bookingid: booking.id });

    //   expect(res.status).toBe(400);
    //   expect(res.body).toEqual({
    //     error: 'Booking is already cancelled',
    //   });
    // });
  });


  afterAll(async () => {
    await sequelize.close();

  });
});
