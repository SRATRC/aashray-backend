import { matchAdhyayanForLeg } from '../../helpers/adhyayanTravel.helper.js';

const reg = (o) => ({ cardno: 'C1', status: 'confirmed', ...o });

test('arrival leg matches the session starting on/after travel date, nearest first', () => {
  const row = { cardno: 'C1', date: '2026-08-01', pickup_point: 'Mumbai', drop_point: 'Research Centre' };
  const regs = [
    reg({ name: 'Far', start_date: '2026-08-10', end_date: '2026-08-12' }),
    reg({ name: 'Near', start_date: '2026-08-02', end_date: '2026-08-04' })
  ];
  expect(matchAdhyayanForLeg(row, regs).name).toBe('Near');
});

test('departure leg matches the session ending on/before travel date, nearest first', () => {
  const row = { cardno: 'C1', date: '2026-08-05', pickup_point: 'Research Centre', drop_point: 'Pune' };
  const regs = [
    reg({ name: 'Ended', start_date: '2026-08-02', end_date: '2026-08-04' }),
    reg({ name: 'Older', start_date: '2026-07-20', end_date: '2026-07-22' })
  ];
  expect(matchAdhyayanForLeg(row, regs).name).toBe('Ended');
});

test('returns null when nothing falls within the window', () => {
  const row = { cardno: 'C1', date: '2026-08-01', pickup_point: 'Mumbai', drop_point: 'Research Centre' };
  const regs = [reg({ name: 'WayLater', start_date: '2026-09-20', end_date: '2026-09-22' })];
  expect(matchAdhyayanForLeg(row, regs)).toBeNull();
});

test('ignores registrations for other cardnos', () => {
  const row = { cardno: 'C1', date: '2026-08-01', pickup_point: 'Mumbai', drop_point: 'Research Centre' };
  const regs = [{ cardno: 'C2', name: 'X', start_date: '2026-08-02', end_date: '2026-08-03', status: 'confirmed' }];
  expect(matchAdhyayanForLeg(row, regs)).toBeNull();
});

test('arrival leg does not match a session that already ended before the travel date', () => {
  const row = { cardno: 'C1', date: '2026-08-01', pickup_point: 'Mumbai', drop_point: 'Research Centre' };
  const regs = [reg({ name: 'AlreadyEnded', start_date: '2026-07-30', end_date: '2026-07-31' })];
  expect(matchAdhyayanForLeg(row, regs)).toBeNull();
});

test('departure leg does not match a session that has not started yet as of the travel date', () => {
  const row = { cardno: 'C1', date: '2026-08-01', pickup_point: 'Research Centre', drop_point: 'Pune' };
  const regs = [reg({ name: 'NotStarted', start_date: '2026-08-02', end_date: '2026-08-03' })];
  expect(matchAdhyayanForLeg(row, regs)).toBeNull();
});
