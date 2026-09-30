import request from 'supertest';
import { app, sequelize } from '../../../app.js';
import { CardDb, RoomBooking, UtsavBooking, UtsavDb } from '../../../models/associations.js';
import BlockDates from '../../../models/block_dates.model.js';
import {
  STATUS_PAYMENT_PENDING,
  STATUS_WAITING,
  HOLD_REASON
} from '../../../config/constants.js';
import { MUMUKSHU_1, TODAY } from '../../testConstants.js';
import UtsavFactory from '../../factories/utsavFactory.js';
import { nDaysFromToday } from '../../helpers/date.helper.js';

jest.mock('../../../utils/sendMail.js');

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
      // Every test starts from empty booking / utsav / block tables and leaves
      // them empty, so no test depends on what an earlier one (or an earlier
      // suite) left behind. Utsav and block rows leaking out of this file used
      // to change the results of later tests and of other suites.
      const resetTables = async () => {
        await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
        await RoomBooking.truncate();
        await UtsavDb.truncate();
        // Utsav ids restart at 1 after a truncate, so a leftover booking from
        // another suite would make this member look like an attendee of the
        // new test utsav.
        await UtsavBooking.truncate();
        await BlockDates.truncate();
        await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
      };
      beforeEach(resetTables);
      afterAll(resetTables);

      it('should book room for single day visit successfully', async () => {
        const res = await request(app)
          .post('/api/v1/mumukshu/booking')
          .send({
            cardno: MUMUKSHU_1,
            primary_booking: createRoomJson(MUMUKSHU_1, TODAY, TODAY)
          });

        // A day visit in a room is a half-day stay: a real room is assigned
        // and it waits for payment, like any other room booking.
        // It is stored with nights 0 and a raw checkout of the next
        // day; the model reports checkout as the visit day itself. So look it
        // up by check-in date and nights, and check the reported checkout.
        const booking = await RoomBooking.findOne({
          where: {
            cardno: MUMUKSHU_1,
            status: STATUS_PAYMENT_PENDING,
            bookedBy: null,
            checkin: TODAY,
            nights: 0,
            updatedBy: MUMUKSHU_1
          }
        });

        expect(booking).not.toBeNull();
        expect(booking.checkout).toBe(TODAY);
        expect(booking.roomno).not.toBe('NA');
        expect(res.status).toBe(200);
      });

      it('should book room for multiple days successfully', async () => {
        const checkin = nDaysFromToday(1);
        const checkout = nDaysFromToday(2);
        const res = await request(app)
          .post('/api/v1/mumukshu/booking')
          .send({
            cardno: MUMUKSHU_1,
            primary_booking: createRoomJson(MUMUKSHU_1, checkin, checkout)
          });

        const booking = await RoomBooking.findOne({
          where: {
            cardno: MUMUKSHU_1,
            status: STATUS_PAYMENT_PENDING,
            bookedBy: null,
            checkin: checkin,
            checkout: checkout,
            nights: 1,
            updatedBy: MUMUKSHU_1
          }
        });

        expect(booking).not.toBeNull();
        expect(res.status).toBe(200);
      });

      it('should put a room booking of more than 9 nights on the waiting list', async () => {
        // Over the 9-night cap is no longer rejected: the booking is accepted
        // and held for admin approval.
        const checkin = nDaysFromToday(1);
        const checkout = nDaysFromToday(11); // 10 nights
        const res = await request(app)
          .post('/api/v1/mumukshu/booking')
          .send({
            cardno: MUMUKSHU_1,
            primary_booking: createRoomJson(MUMUKSHU_1, checkin, checkout)
          });

        expect(res.status).toBe(200);
        const booking = await RoomBooking.findOne({
          where: { cardno: MUMUKSHU_1, checkin, checkout, nights: 10 }
        });
        expect(booking).not.toBeNull();
        expect(booking.status).toBe(STATUS_WAITING);
        expect(booking.hold_reason).toBe(HOLD_REASON.ROLLING_WINDOW_LIMIT);
      });

      it('should reject a room booking when the dates are blocked by admin', async () => {
        // A centre block is a hard stop: the booking is refused (not parked on
        // the waiting list) and no row is written.
        const checkin = nDaysFromToday(1);
        const checkout = nDaysFromToday(3);

        await BlockDates.create({
          checkin,
          checkout,
          comments: 'Blocked by admin',
          status: 'active',
          updatedBy: 'admin'
        });

        const res = await request(app)
          .post('/api/v1/mumukshu/booking')
          .send({
            cardno: MUMUKSHU_1,
            primary_booking: createRoomJson(MUMUKSHU_1, checkin, checkout)
          });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/^Dates are blocked/);

        const booking = await RoomBooking.findOne({
          where: { cardno: MUMUKSHU_1, checkin, checkout }
        });
        expect(booking).toBeNull();
      });

      describe('During Utsav', () => {

        describe('if mumukshu has booked utsav or has utsav booking in progress' , () => {
          test.todo('should book room in waiting status if staying for 1 night and checking out on Utsav start date');
          test.todo('should book room in waiting status if staying for 1 night and checking in on Utsav end date');
          test.todo('should book room in confirmed status if staying for 2+ nights and checking out on Utsav start date');
          test.todo('should book room in confirmed status if staying for 2+ nights and checking in on Utsav end date');
        });

        describe('if mumukshu has not booked utsav' , () => {
          test.todo('should not allow room booking during Utsav');
          test.todo('should not allow room booking if checking out on Utsav start date');
          test.todo('should not allow room booking if checking in on Utsav end date');
          test.todo('should allow room booking if checking in next day after Utsav end date');
          test.todo('should allow room booking if checking out 1 day before Utsav start date');
        });
        

        it('should book room in waiting status if checking in on Utsav end date', async () => {
          const utsavStart = nDaysFromToday(3);
          const utsavEnd = nDaysFromToday(5);
          await UtsavFactory.create(utsavStart, utsavEnd);

          const checkin = utsavEnd;
          const checkout = nDaysFromToday(6);
          const res = await request(app)
            .post('/api/v1/mumukshu/booking')
            .send({
              cardno: MUMUKSHU_1,
              primary_booking: createRoomJson(MUMUKSHU_1, checkin, checkout)
            });

          const booking = await RoomBooking.findOne({
            where: {
              cardno: MUMUKSHU_1,
              status: STATUS_WAITING,
              bookedBy: null,
              checkin: checkin,
              checkout: checkout,
              nights: 1,
              updatedBy: MUMUKSHU_1
            }
          });

          expect(booking).not.toBeNull();
          expect(res.status).toBe(200);
        });

        it('should book room in waiting status if checking out on Utsav begining date', async () => {
          try {
            const utsavStart = nDaysFromToday(7);
            const utsavEnd = nDaysFromToday(8);
            await UtsavFactory.create(utsavStart, utsavEnd);

            const checkin = nDaysFromToday(6);
            const checkout = utsavStart;
            const res = await request(app)
              .post('/api/v1/mumukshu/booking')
              .send({
                cardno: MUMUKSHU_1,
                primary_booking: createRoomJson(MUMUKSHU_1, checkin, checkout)
              });

            const booking = await RoomBooking.findOne({
              where: {
                cardno: MUMUKSHU_1,
                status: STATUS_WAITING,
                bookedBy: null,
                checkin: checkin,
                checkout: checkout,
                nights: 1,
                updatedBy: MUMUKSHU_1
              }
            });

            expect(booking).not.toBeNull();
            expect(res.status).toBe(200);
          } catch (error) {
            console.log(error);
          }
        });

        test.todo('should book room in waiting status if checking out on Utsav end + 1 date');
        test.todo('should book room in waiting status if checking in on Utsav start - 1 date');


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
