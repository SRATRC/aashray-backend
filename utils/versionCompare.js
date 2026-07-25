/**
 * Total, numeric, dot-segment version comparator.
 *
 * Works uniformly for app marketing versions ("2.5.0", "2.1") and OS marketing
 * versions ("13", "16.3.1"). Segments are compared as integers, so "10" > "4"
 * (a plain string compare would get this wrong). Missing trailing segments are
 * treated as 0, so "2.1" === "2.1.0".
 *
 * This never throws. If either input is missing or has no parseable numeric
 * segment, it returns null so callers can apply a safe fallback (e.g. do not
 * force an update when installability cannot be proven).
 *
 * @param {string|number} a
 * @param {string|number} b
 * @returns {-1|0|1|null} sign of (a - b), or null if either is unparseable.
 */
export function compareVersions(a, b) {
  const segA = parseSegments(a);
  const segB = parseSegments(b);
  if (segA === null || segB === null) return null;

  const len = Math.max(segA.length, segB.length);
  for (let i = 0; i < len; i++) {
    const x = segA[i] ?? 0;
    const y = segB[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/**
 * Convenience: is version `a` greater than or equal to version `b`?
 * Returns false when either input is unparseable.
 *
 * @param {string|number} a
 * @param {string|number} b
 * @returns {boolean}
 */
export function isAtLeast(a, b) {
  const cmp = compareVersions(a, b);
  return cmp === 0 || cmp === 1;
}

/**
 * Splits a version string into an array of integer segments.
 * Ignores any non-numeric suffix on a segment (e.g. "2-beta" -> 2).
 * Returns null if the input is nullish or yields no numeric segments.
 *
 * @param {string|number} value
 * @returns {number[]|null}
 */
function parseSegments(value) {
  if (value === null || value === undefined) return null;

  const str = String(value).trim();
  if (str === '') return null;

  const segments = str.split('.').map((part) => {
    const match = part.match(/^\d+/);
    return match ? parseInt(match[0], 10) : null;
  });

  // The leading segment must be numeric for the value to be meaningful.
  if (segments.length === 0 || segments[0] === null) return null;

  return segments.map((n) => (n === null ? 0 : n));
}
