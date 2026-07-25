import { ROLLING_WINDOW_DAYS } from '../config/constants.js';

export const DAY_MS = 86400000;

// Expand [{checkin, checkout}] (YYYY-MM-DD, checkout exclusive) into a sorted,
// de-duplicated array of night dates as UTC-midnight epoch milliseconds.
export function expandNights(ranges) {
  const nights = new Set();
  for (const { checkin, checkout } of ranges || []) {
    if (!checkin || !checkout) continue;
    const start = Date.parse(`${String(checkin).slice(0, 10)}T00:00:00Z`);
    const end = Date.parse(`${String(checkout).slice(0, 10)}T00:00:00Z`);
    for (let d = start; d < end; d += DAY_MS) nights.add(d);
  }
  return [...nights].sort((a, b) => a - b);
}

// The most nights in any ROLLING_WINDOW_DAYS window that CONTAINS at least one
// requested night — i.e. a window this booking actually contributes to. A
// pre-existing over-cap cluster elsewhere (e.g. from an admin override) must
// not, on its own, waitlist a new booking that lands in a clean window. This is
// also the honest "N of 9" number to show. `requestedNights` ⊆ `sortedCombined`,
// both sorted ascending (epoch ms). O(n) two-pointer sweep.
export function peakWindowNightsTouching(sortedCombined, requestedNights) {
  if (!requestedNights || requestedNights.length === 0) return 0;
  const spanMs = (ROLLING_WINDOW_DAYS - 1) * DAY_MS;
  let peak = 0;
  let j = 0;
  let rq = 0;
  for (let i = 0; i < sortedCombined.length; i++) {
    const lo = sortedCombined[i];
    const hi = lo + spanMs;
    if (j < i) j = i;
    while (j + 1 < sortedCombined.length && sortedCombined[j + 1] <= hi) {
      j++;
    }
    // Anchoring windows at a night is sufficient: any window containing a
    // requested night can be shifted right to start on a night without losing
    // count or dropping that requested night. Advance rq (monotonic as lo grows)
    // to the first requested night >= lo; the window touches it if it's <= hi.
    while (rq < requestedNights.length && requestedNights[rq] < lo) rq++;
    const touches =
      rq < requestedNights.length && requestedNights[rq] <= hi;
    if (touches) peak = Math.max(peak, j - i + 1);
  }
  return peak;
}
