import { jest } from '@jest/globals';
import moment from 'moment-timezone';

// Mock the models module so bulkCreate is observable and no DB is touched.
jest.mock('../../models/associations.js', () => ({
  TravelDb: {
    bulkCreate: jest.fn(async (rows) => rows),
    findOne: jest.fn(async () => null) // checkTravelAlreadyBooked finds nothing
  },
  CardDb: { findOne: jest.fn() }
}));
jest.mock('../../helpers/card.helper.js', () => ({
  validateCards: jest.fn(async () => true)
}));

import { TravelDb } from '../../models/associations.js';
import { bookRoundTripTravel, bookTravelDispatch } from '../../helpers/travelBooking.helper.js';

test('round trip creates two linked rows per traveler with a shared trip_group_id', async () => {
  const onwardGroup = [{ pickup_point: 'Mumbai', drop_point: 'Research Centre', luggage: '1 bag', type: 'Regular', mumukshus: ['C1'], arrival_time: '10:00' }];
  const returnGroup = [{ pickup_point: 'Research Centre', drop_point: 'Pune', luggage: '1 bag', type: 'Regular', mumukshus: ['C1'], arrival_time: null }];
  const user = { cardno: 'C1' };

  // Relative dates so the helper's Asia/Kolkata "not in the past" guard never expires.
  const onward = moment().add(10, 'days').format('YYYY-MM-DD');
  const ret = moment().add(14, 'days').format('YYYY-MM-DD');

  await bookRoundTripTravel(onward, onwardGroup, ret, returnGroup, {}, user);

  const created = TravelDb.bulkCreate.mock.calls.flatMap((c) => c[0]);
  expect(created).toHaveLength(2);
  const [a, b] = created;
  expect(a.trip_group_id).toBeTruthy();
  expect(a.trip_group_id).toBe(b.trip_group_id);
  expect(created.map((r) => r.date).sort()).toEqual([onward, ret].sort());
});

test('an empty return group with a return date is refused, not treated as a round trip', async () => {
  const onward = moment().add(10, 'days').format('YYYY-MM-DD');
  const ret = moment().add(14, 'days').format('YYYY-MM-DD');
  const group = [{ pickup_point: 'Mumbai', drop_point: 'Research Centre', mumukshus: ['C1'] }];
  await expect(
    bookTravelDispatch(onward, group, ret, [], {}, { cardno: 'C1' })
  ).rejects.toMatchObject({ statusCode: 400 });
});
