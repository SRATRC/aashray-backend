import { CardDb } from '../../models/associations.js';
import ApiError from '../../utils/ApiError.js';

export const verifyMobno = async (req, res) => {
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

export const login = async (req, res) => {
  const { cardno, token } = req.body;
  const updated = await CardDb.update(
    { token: token },
    { where: { cardno: cardno } }
  );
  if (!updated) {
    throw new ApiError(500, 'Error while logging in user');
  }
  return res.status(200).send({ message: 'logged in' });
};

export const logout = async (req, res) => {
  const { cardno } = req.query;
  const updated = await CardDb.update(
    {
      token: null
    },
    {
      where: {
        cardno: cardno
      }
    }
  );
  if (!updated) {
    throw new ApiError(500, 'Error while logging out user');
  }

  return res.status(200).send({ message: 'logged out' });
};
