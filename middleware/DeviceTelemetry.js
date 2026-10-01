import { DeviceTelemetry } from '../models/associations.js';
import {
  HEADER_PLATFORM,
  HEADER_APP_VERSION,
  HEADER_OS_VERSION
} from '../config/constants.js';

// Captures last-seen device facts (platform, app version, OS version) from the
// compatibility headers, so we can size how many users a release would orphan.
//
// Fire-and-forget: the upsert runs on res 'finish' (after route auth has
// populated req.user) and can never delay or fail the response. Only records
// authenticated requests, keeping the table bounded to one row per (user,
// platform).
export const deviceTelemetry = (req, res, next) => {
  res.on('finish', () => {
    try {
      const platform = (req.headers[HEADER_PLATFORM] || '')
        .toString()
        .toLowerCase();
      if (platform !== 'android' && platform !== 'ios') return;

      const cardno = req.user?.cardno;
      if (!cardno) return; // only authenticated traffic → bounded table

      const app_version =
        (req.headers[HEADER_APP_VERSION] || '').toString().trim() || null;
      const os_version =
        (req.headers[HEADER_OS_VERSION] || '').toString().trim() || null;

      DeviceTelemetry.upsert({
        cardno,
        platform,
        app_version,
        os_version
      }).catch((err) => {
        req.log?.warn?.('device_telemetry_upsert_failed', {
          error: err.message
        });
      });
    } catch (_) {
      // Telemetry must never affect the response.
    }
  });

  next();
};
