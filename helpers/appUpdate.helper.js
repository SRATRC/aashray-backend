import {
  TIER_REQUIRED,
  UPDATE_TYPE_NONE,
  UPDATE_TYPE_OPTIONAL,
  UPDATE_TYPE_FORCED,
  UPDATE_TYPE_UNSUPPORTED
} from '../config/constants.js';
import { compareVersions } from '../utils/versionCompare.js';

/**
 * The OS-ladder forced-update decision. Pure function — no DB, no I/O.
 * See docs/version-os-compatibility.md for the full contract.
 *
 * Given the release catalogue for a platform and the client's build + device OS,
 * decides whether an update is none / optional / forced / unsupported, and which
 * build the device should actually be sent to (always one it can install).
 *
 * @param {Array<{version:string, build_number:number, min_os:?string, tier:string}>} rows
 *   Releases for the platform, sorted by build_number DESC (newest first).
 * @param {number} currentBuild - the client's own build_number (integer).
 * @param {string} osVersion - device OS marketing version string (e.g. "13").
 * @returns {{updateType:string, targetBuild:?number, targetVersion:?string, minOsVersion:?string}}
 */
export function decideUpdate(rows, currentBuild, osVersion) {
  const latest = rows[0];

  // Rungs of the ladder this device can actually install. A NULL floor means
  // "installable by everyone"; a floor above the device OS is unreachable.
  const installable = rows.filter((r) => {
    if (r.min_os == null) return true; // NULL floor = installable by everyone
    const cmp = compareVersions(r.min_os, osVersion);
    // A NULL comparison means an unparseable min_os (bad data). Per the
    // versionCompare contract, fall back safely: treat the row as NOT
    // installable rather than risk sending a device to a build it can't run.
    return cmp !== null && cmp <= 0;
  });
  const target = installable[0] || null; // newest installable (rows are desc)
  const targetBuild = target ? target.build_number : null;

  const latestBuild = latest.build_number;

  const requiredRows = rows.filter((r) => r.tier === TIER_REQUIRED);
  const highestReq = requiredRows.length ? requiredRows[0].build_number : null;

  let updateType;
  if (currentBuild >= latestBuild) {
    updateType = UPDATE_TYPE_NONE;
  } else if (highestReq !== null && currentBuild < highestReq) {
    if (targetBuild !== null && targetBuild >= highestReq) {
      // Device can reach a build that carries the required fix — force it.
      updateType = UPDATE_TYPE_FORCED;
    } else {
      // Device can't climb high enough to reach the required fix. Never a store
      // dead-end: soft, dismissable, keep-using notice.
      updateType = UPDATE_TYPE_UNSUPPORTED;
    }
  } else if (targetBuild !== null && targetBuild > currentBuild) {
    updateType = UPDATE_TYPE_OPTIONAL;
  } else {
    updateType = UPDATE_TYPE_NONE;
  }

  return {
    updateType,
    targetBuild,
    targetVersion: target ? target.version : null,
    minOsVersion: latest.min_os ?? null
  };
}
