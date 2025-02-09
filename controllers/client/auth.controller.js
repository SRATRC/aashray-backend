import { MSG_UPDATE_SUCCESSFUL } from '../../config/constants.js';
import { CardDb } from '../../models/associations.js';
import ApiError from '../../utils/ApiError.js';
import bcrypt from 'bcrypt';

export const verifyMobno = async (req, res) => {
  const mobno = req.query.mobno;

  const details = await CardDb.findOne({
    where: {
      mobno: mobno
    },
    attributes: {
      exclude: ['id', 'createdAt', 'updatedAt', 'updatedBy']
    }
  });

  if (!details) {
    throw new ApiError(404, 'user not found');
  }

  return res.status(200).send({ message: '', data: details });
};

export const updatePassword = async (req, res) => {
  const mobno = req.body.mobno;
  const password = req.body.password;
  const newPassword = req.body.newpassword;

  if (!mobno || !password || !newPassword) {
    throw new ApiError(404, 'Please provide all the fields');
  }
  const details = await CardDb.findOne({
    where: { mobno: mobno },
    attributes: {
      exclude: ['id', 'createdAt', 'updatedAt', 'updatedBy']
    }
  });

  const match = bcrypt.compareSync(password, details.password);
  if (!match) {
    throw new ApiError(404, 'user not found'); //login
  }

  const salt = bcrypt.genSaltSync(10);
  const hash = bcrypt.hashSync(newPassword, salt);
  const result = await CardDb.update(
    { password: hash },
    { where: { mobno: mobno } }
  );

  details.password = '';

  return res
    .status(200)
    .send({ message: MSG_UPDATE_SUCCESSFUL, data: details });
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

export const verifyAndLogin = async (req, res) => {
  const { mobno, password, token } = req.body;

  const details = await CardDb.findOne({
    where: {
      mobno: mobno
    },
    attributes: {
      exclude: ['id', 'createdAt', 'updatedAt', 'updatedBy']
    }
  });

  if (!details) {
    throw new ApiError(404, 'user not found');
  }

  const match = bcrypt.compareSync(password, details.password);

  if (!match) {
    throw new ApiError(404, 'Incorrect Password');
  }

  const updated = await CardDb.update(
    { token: token },
    { where: { mobno: mobno } }
  );
  if (!updated) {
    throw new ApiError(500, 'Error while logging in user');
  }
  details.password = '';
  return res.status(200).send({ message: 'logged in', data: details });
};
