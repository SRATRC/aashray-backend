import { jest } from '@jest/globals';
import Sequelize from 'sequelize';
import {
  RoomBooking,
  FlatBooking,
  CardDb,
  RoomBookingExemption
} from '../../models/associations.js';
import { STATUS_RESIDENT, STATUS_SEVA_KUTIR } from '../../config/constants.js';
import {
  checkRollingWindowLimit,
  checkRollingWindowLimitBatch
} from '../../helpers/rollingWindow.helper.js';

const nonResident = { cardno: 'C1', res_status: 'MUMUKSHU' };
const resident = { cardno: 'C2', res_status: STATUS_RESIDENT };

beforeEach(() => {
  jest.restoreAllMocks();
  jest.spyOn(CardDb, 'findOne').mockResolvedValue({ cardno: 'C1' });
  // Default: no per-card exemption rows. Individual tests override as needed.
  jest.spyOn(RoomBookingExemption, 'findAll').mockResolvedValue([]);
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

// C1 — the cap read must EXCLUDE committed day visits (nights = 0). A day visit
// stores checkout = checkin + 1 day; the projected read selects only
// cardno/checkin/checkout (not nights), so the model getter can't fire and the
// raw checkout would be counted as 1 phantom night. The query filters nights > 0
// so the row is never fetched.
test('day visits (nights = 0) are excluded by the query filter and contribute 0 to the cap', async () => {
  let capturedWhere = null;
  jest.spyOn(RoomBooking, 'findAll').mockImplementation((opts) => {
    capturedWhere = opts.where;
    // Simulate the DB honoring `nights > 0`: the committed day-visit row
    // (checkin 2026-03-10 → stored checkout 2026-03-11, nights 0) is NOT returned.
    return Promise.resolve([]);
  });
  jest.spyOn(FlatBooking, 'findAll').mockResolvedValue([]);

  const res = await checkRollingWindowLimit({
    card: nonResident,
    ranges: [{ checkin: '2026-03-12', checkout: '2026-03-13' }], // 1 real requested night
    t: null
  });

  // The room read carries a nights > 0 filter (day visits never fetched).
  expect(capturedWhere).not.toBeNull();
  expect(capturedWhere.nights).toEqual({ [Sequelize.Op.gt]: 0 });
  // Only the 1 requested night counts; the phantom day-visit night is gone.
  expect(res.exceeds).toBe(false);
  expect(res.windowNights).toBe(1);
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

describe('exemptions: widened res_status set + per-card exemption rows', () => {
  test('non-resident with 12 requested nights + active PERMANENT exemption → not exceeded', async () => {
    const roomSpy = jest.spyOn(RoomBooking, 'findAll').mockResolvedValue([]);
    jest.spyOn(FlatBooking, 'findAll').mockResolvedValue([]);
    jest
      .spyOn(RoomBookingExemption, 'findAll')
      .mockResolvedValue([{ cardno: 'C1', is_permanent: true, valid_from: null, valid_to: null }]);

    const res = await checkRollingWindowLimit({
      card: nonResident,
      ranges: [{ checkin: '2026-03-01', checkout: '2026-03-13' }], // 12 nights — would exceed if counted
      t: null
    });
    expect(res.exceeds).toBe(false);
    expect(res.windowNights).toBe(0);
    // Exempt card is dropped before the cap reads.
    expect(roomSpy).not.toHaveBeenCalled();
  });

  test('SEVA KUTIR card over cap → not exceeded, no exemption query needed', async () => {
    const roomSpy = jest.spyOn(RoomBooking, 'findAll').mockResolvedValue([]);
    jest.spyOn(FlatBooking, 'findAll').mockResolvedValue([]);
    const exemptionSpy = jest.spyOn(RoomBookingExemption, 'findAll').mockResolvedValue([]);

    const res = await checkRollingWindowLimit({
      card: { cardno: 'SK1', res_status: STATUS_SEVA_KUTIR },
      ranges: [{ checkin: '2026-03-01', checkout: '2026-03-14' }], // 13 nights
      t: null
    });
    expect(res.exceeds).toBe(false);
    // Status-exempt: skipped before candidate build → no reads, no exemption query.
    expect(roomSpy).not.toHaveBeenCalled();
    expect(exemptionSpy).not.toHaveBeenCalled();
  });

  test('Staff card over cap → not exceeded (widened res_status set)', async () => {
    jest.spyOn(RoomBooking, 'findAll').mockResolvedValue([]);
    jest.spyOn(FlatBooking, 'findAll').mockResolvedValue([]);

    const res = await checkRollingWindowLimit({
      card: { cardno: 'ST1', res_status: 'Staff' },
      ranges: [{ checkin: '2026-03-01', checkout: '2026-03-14' }], // 13 nights
      t: null
    });
    expect(res.exceeds).toBe(false);
  });

  test('temporary exemption whose valid_to == last stay night → still exempt (boundary)', async () => {
    const roomSpy = jest.spyOn(RoomBooking, 'findAll').mockResolvedValue([]);
    jest.spyOn(FlatBooking, 'findAll').mockResolvedValue([]);
    // Stay 2026-03-01 → 2026-03-14 (13 nights); last requested night = 2026-03-13.
    jest.spyOn(RoomBookingExemption, 'findAll').mockResolvedValue([
      { cardno: 'C1', is_permanent: false, valid_from: '2026-03-01', valid_to: '2026-03-13' }
    ]);

    const res = await checkRollingWindowLimit({
      card: nonResident,
      ranges: [{ checkin: '2026-03-01', checkout: '2026-03-14' }],
      t: null
    });
    expect(res.exceeds).toBe(false);
    expect(roomSpy).not.toHaveBeenCalled();
  });

  test('temporary exemption ending BEFORE the last night (valid_to == last night − 1) → NOT exempt', async () => {
    jest.spyOn(RoomBooking, 'findAll').mockResolvedValue([]);
    jest.spyOn(FlatBooking, 'findAll').mockResolvedValue([]);
    // Same 13-night stay; last night 2026-03-13, but exemption ends 2026-03-12.
    jest.spyOn(RoomBookingExemption, 'findAll').mockResolvedValue([
      { cardno: 'C1', is_permanent: false, valid_from: '2026-03-01', valid_to: '2026-03-12' }
    ]);

    const res = await checkRollingWindowLimit({
      card: nonResident,
      ranges: [{ checkin: '2026-03-01', checkout: '2026-03-14' }], // 13 nights → over cap
      t: null
    });
    expect(res.exceeds).toBe(true);
    expect(res.windowNights).toBe(13);
  });
});
