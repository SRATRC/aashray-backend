import { MSG_UPDATE_SUCCESSFUL } from '../../config/constants.js';
import { CardDb } from '../../models/associations.js';
import ApiError from '../../utils/ApiError.js';
import bcrypt from 'bcrypt';
import sendMail from '../../utils/sendMail.js';

export const updatePassword = async (req, res) => {
  const current_password = req.body.current_password.trim();
  const new_password = req.body.new_password.trim();

  if (!current_password || !new_password) {
    throw new ApiError(404, 'Please provide all the fields');
  }
  const details = await CardDb.findOne({
    where: { cardno: req.user.cardno },
    attributes: {
      exclude: ['id', 'createdAt', 'updatedAt', 'updatedBy']
    }
  });

  const match = bcrypt.compareSync(current_password, details.password);
  if (!match) {
    throw new ApiError(404, 'incorrect password provided');
  }

  const salt = bcrypt.genSaltSync(10);
  const hash = bcrypt.hashSync(new_password, salt);
  await CardDb.update(
    { password: hash },
    { where: { cardno: req.user.cardno } }
  );

  details.password = '';

  return res
    .status(200)
    .send({ message: MSG_UPDATE_SUCCESSFUL, data: details });
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
      exclude: [
        'id',
        'token',
        'active',
        'status',
        'createdAt',
        'updatedAt',
        'updatedBy'
      ]
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

export function generateTemporaryPassword() {
  // અક્ષરો, નંબરો અને વિશેષ ચિહ્નોનો સેટ
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const passwordLength = 5;
  let temporaryPassword = '';

  // રેન્ડમ પાસવર્ડ જનરેટ કરો
  for (let i = 0; i < passwordLength; i++) {
    const randomIndex = Math.floor(Math.random() * chars.length);
    temporaryPassword += chars[randomIndex];
  }

  return temporaryPassword;
}

export async function forgotPassword(req, res) {
  const { mobno } = req.body;
  const details = await CardDb.findOne({
    where: { mobno: mobno }
  });
  if (!details) {
    throw new ApiError(404, 'user not found');
  }
  let temporaryPassword = generateTemporaryPassword();
  temporaryPassword=temporaryPassword.trim();
  const salt = bcrypt.genSaltSync(10);
  const hash = bcrypt.hashSync(temporaryPassword, salt);

  await CardDb.update({ password: hash }, { where: { mobno: mobno } });
  sendMail({
    email: details.email,
    subject: 'Vitraag Vigyaan Aashray: Temporary Password',
    template: 'forgotPasswordEmail',
    context: {
      password: temporaryPassword,
      name: details.issuedto
    }
  });
  return res.status(200).send({
    message: 'Temporary password sent to your email',
    data: { email: details.email }
  });
}
