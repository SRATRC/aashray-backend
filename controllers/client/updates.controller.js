import {
  MSG_FETCH_SUCCESSFUL,
  HEADER_PLATFORM,
  HEADER_APP_VERSION,
  HEADER_OS_VERSION
} from '../../config/constants.js';
import { Updates } from '../../models/associations.js';
import { compareVersions } from '../../utils/versionCompare.js';
import { decideUpdate } from '../../helpers/appUpdate.helper.js';
import ApiError from '../../utils/ApiError.js';

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

  // All releases for this platform; old clients keep getting the newest row.
  const rows = await Updates.findAll({
    where: { os: platform },
    order: [['createdAt', 'DESC']]
  });

  if (rows.length === 0) {
    req.log.warn('check_for_updates_not_found', { platform });
    throw new ApiError(404, 'No version information found');
  }

  const latest = rows[0];

  // Legacy fields — always present, unchanged semantics.
  const data = {
    latestVersion: latest.version,
    mandatory: latest.mandatory,
    releaseNotes: latest.releaseNotes
  };

  // Parse the compatibility headers. If either is missing/unparseable we make
  // no decision and return the legacy response (never force blindly).
  const currentVersion = (req.headers[HEADER_APP_VERSION] || '')
    .toString()
    .trim();
  const osVersion = (req.headers[HEADER_OS_VERSION] || '').toString().trim();

  if (
    compareVersions(currentVersion, '0') === null ||
    compareVersions(osVersion, '0') === null
  ) {
    req.log.info('check_for_updates_legacy', {
      platform,
      latestVersion: latest.version,
      mandatory: data.mandatory
    });
    return res.status(200).send({ message: MSG_FETCH_SUCCESSFUL, data });
  }

  const decision = decideUpdate(rows, currentVersion, osVersion);
  Object.assign(data, decision);

  req.log.info('check_for_updates_success', {
    platform,
    currentVersion,
    osVersion,
    targetVersion: decision.targetVersion,
    updateType: decision.updateType
  });

  return res.status(200).send({ message: MSG_FETCH_SUCCESSFUL, data });
};
