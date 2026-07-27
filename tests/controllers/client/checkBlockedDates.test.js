import request from 'supertest';
import moment from 'moment';
import { app, sequelize } from '../../../app.js';
import { CardDb, RoomBooking } from '../../../models/associations.js';
import CardFactory from '../../factories/cardFactory.js';

jest.mock('../../../utils/sendMail.js');

const fmt = (m) => m.format('YYYY-MM-DD');

const OVER_CAP_CARD = 'CBD_OverCap_1';
const WITHIN_CAP_CARD = 'CBD_WithinCap_1';

describe('POST /stay/check-blocked-dates (app contract, Task B4)', () => {
  beforeAll(async () => {
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
    await RoomBooking.truncate();
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
    await CardFactory.create(OVER_CAP_CARD);
    await CardFactory.create(WITHIN_CAP_CARD);
  });

  afterAll(async () => {
    await CardDb.destroy({ where: { cardno: [OVER_CAP_CARD, WITHIN_CAP_CARD] } });
  });

  it('returns the full app-contract shape with exceedsLimit:true for an over-cap request', async () => {
    const checkin = fmt(moment().add(1, 'day'));
    const checkout = fmt(moment().add(12, 'day')); // 11 nights > 9-night cap

    const res = await request(app)
      .post('/api/v1/stay/check-blocked-dates')
      .send({ cardno: OVER_CAP_CARD, checkin, checkout });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        exceedsLimit: true,
        totalWindowNights: expect.any(Number),
        reasonType: 'rolling_limit_exceeded',
        splitRanges: expect.anything(),
        isBlocked: expect.any(Boolean),
        blockedPeriods: expect.any(Array),
        isUtsavBlock: expect.any(Boolean),
        // New app contract (T1a/T1c): reject | split | null. No block rows exist
        // for these future dates, so the action must be null.
        blockedAction: null
      })
    );
    expect(res.body.totalWindowNights).toBeGreaterThan(0);
  });

  it('returns exceedsLimit:false for a within-cap (9-night) request', async () => {
    const checkin = fmt(moment().add(1, 'day'));
    const checkout = fmt(moment().add(10, 'day')); // 9 nights === cap, not exceeding

    const res = await request(app)
      .post('/api/v1/stay/check-blocked-dates')
      .send({ cardno: WITHIN_CAP_CARD, checkin, checkout });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        exceedsLimit: false,
        totalWindowNights: expect.any(Number),
        isBlocked: expect.any(Boolean),
        blockedPeriods: expect.any(Array),
        isUtsavBlock: expect.any(Boolean),
        blockedAction: null
      })
    );
    // reasonType is only forced to 'rolling_limit_exceeded' when exceeding; within-cap
    // keeps the default/other value (empty string in the current handler).
    expect(res.body.reasonType).not.toBe('rolling_limit_exceeded');
  });
});
