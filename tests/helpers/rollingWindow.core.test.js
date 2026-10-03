import {
  expandNights,
  peakWindowNightsTouching
} from '../../helpers/rollingWindow.core.js';
import { ROLLING_WINDOW_NIGHT_LIMIT } from '../../config/constants.js';

// Helper for the "single request, no prior bookings" case: all nights are
// requested, so the touching-peak equals the plain peak of the set.
const peak = (ranges) => {
  const nights = expandNights(ranges);
  return peakWindowNightsTouching(nights, nights);
};
const check = (ranges) => peak(ranges) > ROLLING_WINDOW_NIGHT_LIMIT;
// Peak over windows containing a requested night (existing vs requested split).
const peakTouch = (existing, requested) =>
  peakWindowNightsTouching(
    expandNights([...existing, ...requested]),
    expandNights(requested)
  );

describe('rollingWindow.core', () => {
  test('expandNights: exclusive checkout, sorted unique', () => {
    expect(expandNights([{ checkin: '2026-01-01', checkout: '2026-01-04' }]).length).toBe(3);
  });

  test('0-night day visit contributes nothing', () => {
    expect(expandNights([{ checkin: '2026-01-01', checkout: '2026-01-01' }]).length).toBe(0);
  });

  test('exactly 9 nights does not exceed', () => {
    expect(check([{ checkin: '2026-01-01', checkout: '2026-01-10' }])).toBe(false);
  });

  test('10 consecutive nights exceeds', () => {
    expect(check([{ checkin: '2026-01-01', checkout: '2026-01-11' }])).toBe(true);
  });

  test('two 5-night stays within a 30-day window exceed', () => {
    expect(
      check([
        { checkin: '2026-01-01', checkout: '2026-01-06' },
        { checkin: '2026-01-20', checkout: '2026-01-25' }
      ])
    ).toBe(true); // 10 nights, spread 24 days < 30
  });

  test('two 5-night stays 40 days apart do not exceed', () => {
    expect(
      check([
        { checkin: '2026-01-01', checkout: '2026-01-06' },
        { checkin: '2026-02-15', checkout: '2026-02-20' }
      ])
    ).toBe(false);
  });

  test('overlapping ranges are de-duplicated', () => {
    expect(
      check([
        { checkin: '2026-01-01', checkout: '2026-01-10' },
        { checkin: '2026-01-05', checkout: '2026-01-10' }
      ])
    ).toBe(false); // still 9 unique nights
  });

  describe('peakWindowNightsTouching (the "N of 9" number)', () => {
    test('empty requested is 0', () => {
      expect(peak([])).toBe(0);
    });

    test('9 consecutive nights peaks at 9', () => {
      expect(peak([{ checkin: '2026-01-01', checkout: '2026-01-10' }])).toBe(9);
    });

    test('7 existing + 4 requested within one 30-day window peaks at 11', () => {
      expect(
        peakTouch(
          [{ checkin: '2026-03-01', checkout: '2026-03-08' }],
          [{ checkin: '2026-03-10', checkout: '2026-03-14' }]
        )
      ).toBe(11);
    });

    test('pre-existing over-cap cluster does NOT inflate a far-away new booking', () => {
      // 12 existing nights in March; a new 3-night stay in May is >30 days away,
      // so its own window has only 3 — it must not be judged against the cluster.
      expect(
        peakTouch(
          [{ checkin: '2026-03-01', checkout: '2026-03-13' }], // 12 nights (e.g. admin override)
          [{ checkin: '2026-05-01', checkout: '2026-05-04' }] // 3 nights, clean window
        )
      ).toBe(3);
    });
  });
});
