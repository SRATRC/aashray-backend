import { MSG_FETCH_SUCCESSFUL } from '../../config/constants.js';
import { Updates } from '../../models/associations.js';
import ApiError from '../../utils/ApiError.js';

export const checkForUpdates = async (req, res) => {
  const { os } = req.query;

  if (!os || !['android', 'ios'].includes(os.toLowerCase())) {
    throw new ApiError(400, 'Invalid operating system specified');
  }

  const latestUpdate = await Updates.findOne({
    where: { os: os.toLowerCase() },
    order: [['createdAt', 'DESC']]
  });

  if (!latestUpdate) {
    throw new ApiError(404, 'No version information found');
  }

  return res.status(200).send({
    message: MSG_FETCH_SUCCESSFUL,
    data: {
      latestVersion: latestUpdate.version,
      mandatory: latestUpdate.mandatory,
      releaseNotes: latestUpdate.releaseNotes
    }
  });
};
