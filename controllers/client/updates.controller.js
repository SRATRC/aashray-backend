import {
  MSG_FETCH_SUCCESSFUL,
  TIER_REQUIRED,
  HEADER_PLATFORM,
  HEADER_APP_BUILD,
  HEADER_OS_VERSION
} from '../../config/constants.js';
import { Updates } from '../../models/associations.js';
import { compareVersions } from '../../utils/versionCompare.js';
import { decideUpdate } from '../../helpers/appUpdate.helper.js';
import ApiError from '../../utils/ApiError.js';

// See docs/version-os-compatibility.md for the full contract.
export const checkForUpdates = async (req, res) => {
  // Platform comes from the header, falling back to the legacy ?os= query param.
  const platform = (req.headers[HEADER_PLATFORM] || req.query.os || '')
    .toString()
    .toLowerCase();

  req.log.info('check_for_updates_start', { platform });

  if (!platform || !['android', 'ios'].includes(platform)) {
    req.log.warn('check_for_updates_invalid_os', { platform });
    throw new ApiError(400, 'Invalid operating system specified');
  }

  // All releases for this platform, newest build first.
  const rows = await Updates.findAll({
    where: { os: platform },
    order: [
      ['build_number', 'DESC'],
      ['createdAt', 'DESC']
    ]
  });

  if (rows.length === 0) {
    req.log.warn('check_for_updates_not_found', { platform });
    throw new ApiError(404, 'No version information found');
  }

  const latest = rows[0];

  // Legacy fields — always present, unchanged semantics.
  const data = {
    latestVersion: latest.version,
    mandatory: latest.tier === TIER_REQUIRED,
    releaseNotes: latest.releaseNotes
  };

  // Parse the compatibility headers. If either is missing/unparseable we make
  // no decision and return the legacy response (never force blindly).
  const currentBuild = parseBuild(req.headers[HEADER_APP_BUILD]);
  const osVersion = (req.headers[HEADER_OS_VERSION] || '').toString().trim();
  const osParseable =
    osVersion !== '' && compareVersions(osVersion, '0') !== null;

  if (currentBuild === null || !osParseable) {
    req.log.info('check_for_updates_legacy', {
      platform,
      latestVersion: latest.version,
      mandatory: data.mandatory
    });
    return res.status(200).send({ message: MSG_FETCH_SUCCESSFUL, data });
  }

  // OS-ladder decision (pure logic in helpers/appUpdate.helper.js).
  const decision = decideUpdate(rows, currentBuild, osVersion);
  Object.assign(data, decision);

  req.log.info('check_for_updates_success', {
    platform,
    currentBuild,
    osVersion,
    latestBuild: latest.build_number,
    targetBuild: decision.targetBuild,
    updateType: decision.updateType
  });

  return res.status(200).send({ message: MSG_FETCH_SUCCESSFUL, data });
};

// Parses the x-app-build header into a non-negative integer, or null.
function parseBuild(value) {
  if (value === undefined || value === null) return null;
  const str = value.toString().trim();
  if (!/^\d+$/.test(str)) return null;
  return parseInt(str, 10);
}
