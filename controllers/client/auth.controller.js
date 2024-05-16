import { CardDb } from '../../models/associations.js';
import ApiError from '../../utils/ApiError.js';

export const VerifyIdentity = async (req, res) => {
  const { mobno } = req.query;
  const details = await CardDb.findOne({
    where: { mobno: mobno },
    attributes: {
      exclude: ['id', 'createdAt', 'updatedAt', 'updatedBy']
    }
  });
  if (!details) {
    throw new ApiError(404, 'user not found');
  }
  return res.status(200).send({ message: '', data: details });
};
