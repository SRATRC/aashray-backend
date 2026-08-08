import request from 'supertest';
import moment from 'moment';
import { app, sequelize } from '../../../app.js';
import { FlatBooking, FlatDb } from '../../../models/associations.js';
import { STATUS_WAITING, HOLD_REASON } from '../../../config/constants.js';
import { MUMUKSHU_1 } from '../../testConstants.js';
import FlatFactory from '../../factories/flatFactory.js';

jest.mock('../../../utils/sendMail.js');

const fmt = (m) => m.format('YYYY-MM-DD');

// NOTE: reconcile this payload with tests/controllers/client/flatBooking.controller.test.js
// (reuse its createFlatBookingJson helper if the shape differs).
const flatBookingJson = (checkin, checkout) => ({
  booking_type: 'flat',
  details: { checkin_date: checkin, checkout_date: checkout }
});

describe('Flat rolling-window cap (client, non-resident)', () => {
  beforeAll(async () => {
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
    await FlatBooking.truncate();
    await FlatDb.truncate();
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
    await FlatFactory.create(MUMUKSHU_1, 101); // MUMUKSHU_1 is a non-resident who owns a flat
  });

  beforeEach(async () => {
    await FlatBooking.truncate();
  });

  it('forces a non-resident flat stay over 9 nights to waiting with no charge', async () => {
    const checkin = fmt(moment().add(1, 'day'));
    const checkout = fmt(moment().add(12, 'day')); // 11 nights

    const res = await request(app)
      .post('/api/v1/mumukshu/booking')
      .send({ cardno: MUMUKSHU_1, primary_booking: flatBookingJson(checkin, checkout) });

    expect(res.status).toBe(200);
    const bookings = await FlatBooking.findAll({ where: { cardno: MUMUKSHU_1 } });
    expect(bookings.length).toBeGreaterThan(0);
    expect(bookings.every((b) => b.status === STATUS_WAITING)).toBe(true);
  });

  it('does NOT 400 on a 10-night flat stay — soft cap routes it to waiting and persists the reason', async () => {
    const checkin = fmt(moment().add(1, 'day'));
    const checkout = fmt(moment().add(11, 'day')); // 10 nights
    const reason = 'Long visit for a family event';

    const res = await request(app)
      .post('/api/v1/mumukshu/booking')
      .send({
        cardno: MUMUKSHU_1,
        extra_stay_reason: reason,
        primary_booking: flatBookingJson(checkin, checkout)
      });

    // The vvshk >9-night hard-fail is gone: over-cap flats go SOFT, never 400.
    expect(res.status).toBe(200);
    const bookings = await FlatBooking.findAll({ where: { cardno: MUMUKSHU_1 } });
    expect(bookings.length).toBeGreaterThan(0);
    expect(bookings.every((b) => b.status === STATUS_WAITING)).toBe(true);
    expect(
      bookings.every((b) => b.hold_reason === HOLD_REASON.ROLLING_WINDOW_LIMIT)
    ).toBe(true);
    expect(
      bookings.every(
        (b) => b.hold_reason_meta && b.hold_reason_meta.userReason === reason
      )
    ).toBe(true);
  });

  it('persists a reason nested under primary_booking.details for an over-cap flat', async () => {
    const checkin = fmt(moment().add(1, 'day'));
    const checkout = fmt(moment().add(12, 'day')); // 11 nights
    const reason = 'Nested flat reason';

    const primary = flatBookingJson(checkin, checkout);
    primary.details.extra_stay_reason = reason;

    const res = await request(app)
      .post('/api/v1/mumukshu/booking')
      .send({ cardno: MUMUKSHU_1, primary_booking: primary });

    expect(res.status).toBe(200);
    const bookings = await FlatBooking.findAll({ where: { cardno: MUMUKSHU_1 } });
    expect(bookings.length).toBeGreaterThan(0);
    expect(
      bookings.every(
        (b) => b.hold_reason_meta && b.hold_reason_meta.userReason === reason
      )
    ).toBe(true);
  });
});
