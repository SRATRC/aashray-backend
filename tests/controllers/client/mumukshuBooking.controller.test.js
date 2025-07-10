import request from 'supertest';
import { app, sequelize } from '../../../app.js';
import { CardDb, RoomBooking } from '../../../models/associations.js';
import {
  ROOM_STATUS_PENDING_CHECKIN,
  STATUS_PAYMENT_PENDING
} from '../../../config/constants.js';
import { MUMUKSHU_1 } from '../../testConstants.js';

jest.mock('../../../utils/sendMail.js');

const TODAY = new Date();

describe('Mumukshu Booking Controller', () => {
  describe('Booking', () => {
    describe('Utsav Booking', () => {
      test.todo(
        'should return an error when booking an utsav with invalid details'
      );
      test.todo(
        'should return an error when booking an utsav with no packageid'
      );
      test.todo(
        'should return an error when booking an utsav with packageid which is not available'
      );
      test.todo('should book utsav successfully');
    });

    describe('Room Booking', () => {
      beforeEach(async () => {
        await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
        await RoomBooking.truncate();
        await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
      });

      test.todo(
        'should book room in waiting status if checking in on Utsav end date'
      );
      test.todo(
        'should book room in waiting status if checking out on Utsav begining date'
      );

      it('should book room for single day visit successfully', async () => {
        const res = await request(app)
          .post('/api/v1/mumukshu/booking')
          .send({
            cardno: MUMUKSHU_1,
            primary_booking: createRoomJson(
              MUMUKSHU_1,
              TODAY,
              TODAY
            )
          });

        const booking = await RoomBooking.findOne({
          where: {
            cardno: MUMUKSHU_1,
            status: ROOM_STATUS_PENDING_CHECKIN,
            bookedBy: null,
            checkin: TODAY,
            checkout: TODAY,
            nights: 0,
            updatedBy: MUMUKSHU_1
          }
        });

        expect(booking).not.toBeNull();
        expect(res.status).toBe(200);
      });

      it('should book room for multiple days successfully', async () => {
        const checkout = new Date(Date.now() + 2 * 86400000);
        const res = await request(app)
          .post('/api/v1/mumukshu/booking')
          .send({
            cardno: MUMUKSHU_1,
            primary_booking: createRoomJson(
              MUMUKSHU_1,
              TODAY,
              checkout
            )
          });

        const booking = await RoomBooking.findOne({
          where: {
            cardno: MUMUKSHU_1,
            status: STATUS_PAYMENT_PENDING,
            bookedBy: null,
            checkin: TODAY,
            checkout: checkout,
            nights: 3,
            updatedBy: MUMUKSHU_1
          }
        });

        expect(booking).not.toBeNull();
        expect(res.status).toBe(200);
      });
    });

    test.todo('should book adhyayans successfully');
    test.todo('should book rooms successfully');
    test.todo('should book food successfully');
    test.todo('should book travel successfully');
  });

  describe('Validate Booking', () => {
    test.todo('should validate utsav successfully');
    test.todo('should validate adhyayans successfully');
    test.todo('should validate rooms successfully');
    test.todo('should validate food successfully');
    test.todo('should validate travel successfully');
  });

  afterAll(async () => {
    await sequelize.close();
  });
});

function createRoomJson(cardno, checkin, checkout) {
  return {
    booking_type: 'room',
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
