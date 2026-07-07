import { jest } from '@jest/globals';

// Mock the models module so bulkCreate is observable and no DB is touched.
const bulkCreate = jest.fn(async (rows) => rows);
const findOne = jest.fn(async () => null); // checkTravelAlreadyBooked finds nothing

jest.unstable_mockModule('../../models/associations.js', () => ({
  TravelDb: { bulkCreate, findOne },
  CardDb: { findOne: jest.fn() }
}));
jest.unstable_mockModule('../../helpers/card.helper.js', () => ({
  validateCards: jest.fn(async () => true)
}));

const { bookRoundTripTravel } = await import('../../helpers/travelBooking.helper.js');

test('round trip creates two linked rows per traveler with a shared trip_group_id', async () => {
  const onwardGroup = [{ pickup_point: 'Mumbai', drop_point: 'Research Centre', luggage: '1 bag', type: 'Regular', mumukshus: ['C1'], arrival_time: '10:00' }];
  const returnGroup = [{ pickup_point: 'Research Centre', drop_point: 'Pune', luggage: '1 bag', type: 'Regular', mumukshus: ['C1'], arrival_time: null }];
  const user = { cardno: 'C1' };

  await bookRoundTripTravel('2026-08-01', onwardGroup, '2026-08-05', returnGroup, {}, user);

  const created = bulkCreate.mock.calls.flatMap((c) => c[0]);
  expect(created).toHaveLength(2);
  const [a, b] = created;
  expect(a.trip_group_id).toBeTruthy();
  expect(a.trip_group_id).toBe(b.trip_group_id);
  expect(created.map((r) => r.date).sort()).toEqual(['2026-08-01', '2026-08-05']);
  expect(created.every((r) => !('leaving_post_adhyayan' in r))).toBe(true);
});
