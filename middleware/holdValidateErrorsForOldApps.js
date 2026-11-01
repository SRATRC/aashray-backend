// =====================================================================================
// TEMPORARY - remove when the fixed app release (FIXED_APP_VERSION) is the oldest build
// still in use. See "HOW TO REMOVE" below.
//
// WHY: the old iPhone app (builds before the fix) shows its "Room already booked" /
// "Dates are blocked" pop-up the moment the validate request fails. If the failure comes
// back faster than the screen's slide-in animation (about 100-300 ms), iOS drops the
// pop-up and the whole booking screen freezes. The member has to kill the app.
// Android is not affected. We cannot fix the installed apps, so for the old apps only we
// hold a validate ERROR reply until HOLD_MS after the request arrived. Then the pop-up
// shows normally. Measured on an iPhone SE (F1 / H1 artifacts): no wait = froze in most
// runs, 700 ms = pop-up and "Okay" worked 5/5.
//
// WHAT IT TOUCHES: only POST validate on the member (/mumukshu) and guest (/guest) routes,
// only 4xx replies, only for apps that are NOT known to be fixed. Success replies are
// never delayed. A held reply is logged once ("validate_error_held") so you can count
// how many old apps still hit it.
//
// WHO IS SKIPPED (no wait): an app that sends X-Aashray-Validate-Mode: data (the new
// validate screens), and an app whose x-app-version is >= FIXED_APP_VERSION. Builds that
// send no x-app-version header at all are the old ones and are held.
//
// HOW TO REMOVE: delete this file, and in routes/client/mumukshuBooking.routes.js and
// routes/client/guestBooking.routes.js delete the import line and the
// `router.post('/validate', holdValidateErrorsForOldApps)` line. Remove it once the
// "validate_error_held" log shows no (or negligible) hits for a few weeks after the fixed
// release went out. Nothing else depends on it.
// =====================================================================================
import { HEADER_APP_VERSION, HEADER_PLATFORM } from '../config/constants.js';

export const HOLD_MS = 700;
// The planned fixed release. Override with the FIXED_APP_VERSION env var (no code change).
export const DEFAULT_FIXED_APP_VERSION = '1.1.61';
const HEADER_VALIDATE_MODE = 'x-aashray-validate-mode';

// "1.1.61" -> [1, 1, 61]. Reads the leading dotted numbers, so "v1.2.0", "1.2.0-beta"
// and "1.2.0 (45)" all read as 1.2.0. Returns null if there are none.
const parseVersion = (text) => {
  if (typeof text !== 'string') return null;
  const match = text.trim().match(/^v?(\d+(?:\.\d+)*)/i);
  return match ? match[1].split('.').map(Number) : null;
};

// Numeric compare (1.1.9 < 1.1.61). Missing parts count as 0. Returns -1, 0 or 1.
const compareVersions = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
};

// True when this request comes from an app that freezes on a fast validate error.
export const isOldApp = (req) => {
  if (String(req.headers[HEADER_VALIDATE_MODE]).toLowerCase() === 'data')
    return false;
  const sent = req.headers[HEADER_APP_VERSION];
  if (sent === undefined) return true; // no header = a build from before the fix
  const have = parseVersion(sent);
  if (!have) return true; // unreadable version: treat as old (the safe side)
  const fixed =
    parseVersion(process.env.FIXED_APP_VERSION) ||
    parseVersion(DEFAULT_FIXED_APP_VERSION);
  return compareVersions(have, fixed) < 0;
};

export const holdValidateErrorsForOldApps = (req, res, next) => {
  const arrivedAt = Date.now();
  const originalSend = res.send;
  let handled = false;
  res.send = function (...args) {
    if (handled) return originalSend.apply(this, args);
    handled = true;
    const wait = HOLD_MS - (Date.now() - arrivedAt);
    if (
      res.statusCode >= 400 &&
      res.statusCode < 500 &&
      wait > 0 &&
      isOldApp(req)
    ) {
      (req.log || console).info('validate_error_held', {
        route: req.originalUrl.split('?')[0],
        statusCode: res.statusCode,
        heldMs: wait,
        platform: req.headers[HEADER_PLATFORM] || null,
        appVersion: req.headers[HEADER_APP_VERSION] || null
      });
      setTimeout(() => {
        // The client may have gone away, or something else may have replied during the wait.
        if (res.headersSent || res.writableEnded) return;
        try {
          originalSend.apply(this, args);
        } catch (err) {
          (req.log || console).error('validate_error_held_send_failed', {
            error: err.message
          });
        }
      }, wait);
      return this;
    }
    return originalSend.apply(this, args);
  };
  next();
};
