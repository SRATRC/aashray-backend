import { jest } from '@jest/globals';
import { RoomBooking, FlatBooking, CardDb } from '../../models/associations.js';
import { STATUS_RESIDENT } from '../../config/constants.js';
import {
  checkRollingWindowLimit,
  checkRollingWindowLimitBatch
} from '../../helpers/rollingWindow.helper.js';

const nonResident = { cardno: 'C1', res_status: 'MUMUKSHU' };
const resident = { cardno: 'C2', res_status: STATUS_RESIDENT };

beforeEach(() => {
  jest.restoreAllMocks();
  jest.spyOn(CardDb, 'findOne').mockResolvedValue({ cardno: 'C1' });
});

test('room nights + requested exceed → exceeds true', async () => {
  jest
    .spyOn(RoomBooking, 'findAll')
    .mockResolvedValue([{ checkin: '2026-03-01', checkout: '2026-03-08' }]); // 7 nights
  jest.spyOn(FlatBooking, 'findAll').mockResolvedValue([]);
  const res = await checkRollingWindowLimit({
    card: nonResident,
    ranges: [{ checkin: '2026-03-10', checkout: '2026-03-14' }], // +4 = 11
    t: null
  });
  expect(res.exceeds).toBe(true);
  // 7 existing + 4 requested nights all fall inside one 30-day window.
  expect(res.windowNights).toBe(11);
});

test('non-resident: flat nights are counted', async () => {
  jest.spyOn(RoomBooking, 'findAll').mockResolvedValue([]);
  jest
    .spyOn(FlatBooking, 'findAll')
    .mockResolvedValue([{ checkin: '2026-03-01', checkout: '2026-03-09' }]); // 8 nights
  const res = await checkRollingWindowLimit({
    card: nonResident,
    ranges: [{ checkin: '2026-03-10', checkout: '2026-03-13' }], // +3 = 11
    t: null
  });
  expect(res.exceeds).toBe(true);
});

test('resident: cap does not apply — never exceeds, no queries at all', async () => {
  const roomSpy = jest.spyOn(RoomBooking, 'findAll').mockResolvedValue([]);
  const flatSpy = jest.spyOn(FlatBooking, 'findAll').mockResolvedValue([]);
  const res = await checkRollingWindowLimit({
    card: resident,
    ranges: [{ checkin: '2026-03-01', checkout: '2026-03-14' }], // 13 nights — would exceed if counted
    t: null
  });
  expect(res.exceeds).toBe(false);
  expect(roomSpy).not.toHaveBeenCalled();
  expect(flatSpy).not.toHaveBeenCalled();
});

test('all day-visits (0 nights) short-circuit to not-exceeded', async () => {
  const roomSpy = jest.spyOn(RoomBooking, 'findAll').mockResolvedValue([]);
  jest.spyOn(FlatBooking, 'findAll').mockResolvedValue([]);
  const res = await checkRollingWindowLimit({
    card: nonResident,
    ranges: [{ checkin: '2026-03-10', checkout: '2026-03-10' }],
    t: null
  });
  expect(res.exceeds).toBe(false);
  expect(roomSpy).not.toHaveBeenCalled();
});

test('a far pre-existing over-cap cluster does not waitlist a clean new booking', async () => {
  jest
    .spyOn(RoomBooking, 'findAll')
    .mockResolvedValue([{ checkin: '2026-03-01', checkout: '2026-03-13' }]); // 12 committed nights
  jest.spyOn(FlatBooking, 'findAll').mockResolvedValue([]);
  const res = await checkRollingWindowLimit({
    card: nonResident,
    ranges: [{ checkin: '2026-05-01', checkout: '2026-05-04' }], // 3 nights, >30 days away
    t: null
  });
  expect(res.exceeds).toBe(false);
  expect(res.windowNights).toBe(3);
});

describe('checkRollingWindowLimitBatch (group bookings)', () => {
  test('resolves over-cap and under-cap occupants in one batch', async () => {
    // One batched read returns rows for all occupants; grouped by cardno.
    jest
      .spyOn(RoomBooking, 'findAll')
      .mockResolvedValue([
        { cardno: 'C1', checkin: '2026-03-01', checkout: '2026-03-09' } // C1: 8 existing
      ]);
    jest.spyOn(FlatBooking, 'findAll').mockResolvedValue([]);

    const cards = [
      { cardno: 'C1', res_status: 'MUMUKSHU' },
      { cardno: 'C2', res_status: 'GUEST' }
    ];
    const rangesByCard = {
      C1: [{ checkin: '2026-03-10', checkout: '2026-03-13' }], // +3 = 11 → over
      C2: [{ checkin: '2026-03-10', checkout: '2026-03-13' }] // 3 only → under
    };

    const res = await checkRollingWindowLimitBatch({ cards, rangesByCard, t: null });
    expect(res.get('C1').exceeds).toBe(true);
    expect(res.get('C1').windowNights).toBe(11);
    expect(res.get('C2').exceeds).toBe(false);
  });

  test('resident in the group is exempt regardless of nights', async () => {
    const roomSpy = jest.spyOn(RoomBooking, 'findAll').mockResolvedValue([]);
    jest.spyOn(FlatBooking, 'findAll').mockResolvedValue([]);

    const cards = [{ cardno: 'R1', res_status: STATUS_RESIDENT }];
    const rangesByCard = {
      R1: [{ checkin: '2026-03-01', checkout: '2026-03-14' }] // 13 nights
    };

    const res = await checkRollingWindowLimitBatch({ cards, rangesByCard, t: null });
    expect(res.get('R1').exceeds).toBe(false);
    expect(roomSpy).not.toHaveBeenCalled(); // no active non-residents → no query
  });
});
