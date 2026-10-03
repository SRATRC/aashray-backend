import {
  UPDATE_TYPE_NONE,
  UPDATE_TYPE_OPTIONAL,
  UPDATE_TYPE_FORCED,
  UPDATE_TYPE_UNSUPPORTED
} from '../config/constants.js';
import { compareVersions } from '../utils/versionCompare.js';

/**
 * The OS-ladder forced-update decision. Pure function — no DB, no I/O.
 *
 * Given every release row for a platform and the client's app version + device
 * OS, decides none / optional / forced / unsupported, and which release the
 * device should be sent to (always one it can install).
 *
 * @param {Array<{version:string, min_os:?string, mandatory:boolean, releaseNotes:?string}>} rows
 *   Releases for the platform, in any order.
 * @param {string} currentVersion - the client's app version ("1.1.59").
 * @param {string} osVersion - iOS version ("16.4") or Android API level ("26").
 * @returns {{updateType:string, targetVersion:?string, targetReleaseNotes:?string, minOsVersion:?string}}
 */
export function decideUpdate(rows, currentVersion, osVersion) {
  // Newest first. Rows are edited by hand, so order by version, not createdAt.
  const releases = rows
    .filter((r) => compareVersions(r.version, '0') !== null)
    .sort((a, b) => compareVersions(b.version, a.version));
  const latest = releases[0];
  const isBelow = (version) => compareVersions(currentVersion, version) < 0;

  // Releases this device can actually install. An unparseable min_os (bad
  // data) counts as NOT installable, so we never force onto a build it can't run.
  const target = releases.find((r) => {
    if (r.min_os == null) return true;
    const cmp = compareVersions(r.min_os, osVersion);
    return cmp !== null && cmp <= 0;
  });

  // The newest mandatory release overall, and the newest one this device can
  // reach (at or below its target). A later mandatory release that raised
  // min_os must not cancel an earlier one the device can still install.
  const floor = releases.find((r) => r.mandatory);
  const reachableFloor =
    target &&
    releases.find(
      (r) => r.mandatory && compareVersions(r.version, target.version) <= 0
    );

  let updateType = UPDATE_TYPE_NONE;
  if (reachableFloor && isBelow(reachableFloor.version)) {
    updateType = UPDATE_TYPE_FORCED;
  } else if (floor && isBelow(floor.version)) {
    // Required build exists but this OS can't install it. Never a store
    // dead-end: a dismissable keep-using notice.
    updateType = UPDATE_TYPE_UNSUPPORTED;
  } else if (target && isBelow(target.version)) {
    updateType = UPDATE_TYPE_OPTIONAL;
  }

  return {
    updateType,
    targetVersion: target ? target.version : null,
    // Notes for the build we send them to; legacy releaseNotes stays as is.
    targetReleaseNotes: target ? target.releaseNotes : null,
    minOsVersion: latest?.min_os ?? null
  };
}
