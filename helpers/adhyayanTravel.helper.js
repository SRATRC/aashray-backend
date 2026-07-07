import moment from 'moment';
import {
  STATUS_CANCELLED,
  STATUS_ADMIN_CANCELLED,
  RESEARCH_CENTRE
} from '../config/constants.js';

// Registrations in these statuses are NOT shown (everything else counts).
export const ATTENDING_EXCLUDED_STATUSES = [
  STATUS_CANCELLED,
  STATUS_ADMIN_CANCELLED
];

// Days of slack around the travel date when matching a session.
const WINDOW_DAYS = 3;

/**
 * Pick the study session relevant to a single travel leg.
 * Arrival (drop = Research Centre): nearest session starting on/after the travel date.
 * Departure (pickup = Research Centre): nearest session ending on/before the travel date.
 * @returns {{name, start_date, end_date} | null}
 */
export function matchAdhyayanForLeg(travelRow, registrations) {
  if (!travelRow || !Array.isArray(registrations)) return null;
  const { cardno, date, pickup_point, drop_point } = travelRow;
  const travel = moment(date, 'YYYY-MM-DD');
  const isArrival = drop_point === RESEARCH_CENTRE;

  const mine = registrations.filter((r) => r.cardno === cardno);
  let best = null;
  let bestDelta = Infinity;

  for (const r of mine) {
    const start = moment(r.start_date, 'YYYY-MM-DD');
    const end = moment(r.end_date, 'YYYY-MM-DD');
    let delta;
    if (isArrival) {
      // Arriving for a session that starts on/after the travel date.
      delta = start.diff(travel, 'days');
    } else {
      // Leaving after a session that ended on/before the travel date.
      delta = travel.diff(end, 'days');
    }
    const absDelta = Math.abs(delta);
    if (absDelta > WINDOW_DAYS) continue; // outside the matching window entirely
    if (absDelta < bestDelta) {
      bestDelta = absDelta;
      best = { name: r.name, start_date: r.start_date, end_date: r.end_date };
    }
  }
  return best;
}
