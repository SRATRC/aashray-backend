import { MSG_FETCH_SUCCESSFUL } from '../../config/constants.js';
import { Updates } from '../../models/associations.js';
import ApiError from '../../utils/ApiError.js';

export const checkForUpdates = async (req, res) => {
  const { os } = req.query;
  req.log.info('check_for_updates_start', { os });

  if (!os || !['android', 'ios'].includes(os.toLowerCase())) {
    req.log.warn('check_for_updates_invalid_os', { os });
    throw new ApiError(400, 'Invalid operating system specified');
  }

  const latestUpdate = await Updates.findOne({
    where: { os: os.toLowerCase() },
    order: [['createdAt', 'DESC']]
  });

  if (!latestUpdate) {
    req.log.warn('check_for_updates_not_found', { os });
    throw new ApiError(404, 'No version information found');
  }

  req.log.info('check_for_updates_success', { os, version: latestUpdate.version, mandatory: latestUpdate.mandatory });
  return res.status(200).send({
    message: MSG_FETCH_SUCCESSFUL,
    data: {
      latestVersion: latestUpdate.version,
      mandatory: latestUpdate.mandatory,
      releaseNotes: latestUpdate.releaseNotes
    }
  });
};
