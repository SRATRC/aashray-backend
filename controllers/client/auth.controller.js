import { MSG_UPDATE_SUCCESSFUL, WHATSAPP_SUPPORT_NUMBER } from '../../config/constants.js';
import { CardDb, FlatDb } from '../../models/associations.js';
import { attachUserContext } from '../../middleware/Logger.js';
import ApiError from '../../utils/ApiError.js';
import bcrypt from 'bcrypt';
import sendMail from '../../utils/sendMail.js';
import { sendWhatsAppMessage } from '../../utils/sendWhatsAppMessage.js';


export const updatePassword = async (req, res) => {
  attachUserContext(req);
  req.log.info('update_password_start', { cardno: req.user.cardno });

  const current_password = req.body.current_password.trim();
  const new_password = req.body.new_password.trim();

  if (!current_password || !new_password) {
    req.log.warn('update_password_missing_fields', { cardno: req.user.cardno });
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
    req.log.warn('update_password_incorrect_current', { cardno: req.user.cardno });
    throw new ApiError(404, 'incorrect password provided');
  }

  const salt = bcrypt.genSaltSync(10);
  const hash = bcrypt.hashSync(new_password, salt);
  await CardDb.update(
    { password: hash },
    { where: { cardno: req.user.cardno } }
  );
  req.log.info('update_password_success', { cardno: req.user.cardno });

  const phone = details.mobno;
  if (phone) {
    try {
      const cleanPhone = String(phone).replace(/\D/g, '');
      const formattedPhone = cleanPhone.startsWith('91')
        ? cleanPhone
        : `91${cleanPhone}`;

      const components = [
        {
          type: 'body',
          parameters: [
            {
              type: 'text',
              text: details.issuedto || 'Mumukshu'
            }
          ]
        }
      ];

      await sendWhatsAppMessage(formattedPhone, 'password_update_app', components);
    } catch (err) {
      console.error('Error sending WhatsApp message in updatePassword:', err.message || err);
    }
  }

  details.password = '';

  return res
    .status(200)
    .send({ message: MSG_UPDATE_SUCCESSFUL, data: details });
};


export const logout = async (req, res) => {
  const { cardno } = req.query;
  req.log.info('logout_start', { cardno });

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
    req.log.error('logout_failed', { cardno });
    throw new ApiError(500, 'Error while logging out user');
  }

  req.log.info('logout_success', { cardno });
  return res.status(200).send({ message: 'logged out' });
};

export const verifyAndLogin = async (req, res) => {
  const { mobno, token } = req.body;
  req.log.info('login_start', { mobno });

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
    req.log.warn('login_user_not_found', { mobno });
    throw new ApiError(404, 'user not found');
  }

  const { password } = req.body;
  const match = bcrypt.compareSync(password, details.password);

  if (!match) {
    req.log.warn('login_incorrect_password', { mobno });
    throw new ApiError(404, 'Incorrect Password');
  }

  const updated = await CardDb.update(
    { token: token },
    { where: { mobno: mobno } }
  );
  if (!updated) {
    req.log.error('login_token_update_failed', { mobno });
    throw new ApiError(500, 'Error while logging in user');
  }

  const isFlatOwner = await FlatDb.findOne({
    attributes: ['flatno'],
    where: {
      owner: details.cardno
    }
  });
  details.setDataValue('isFlatOwner', !!isFlatOwner);
  details.setDataValue('password', '');

  req.log.info('login_success', { cardno: details.cardno, isFlatOwner: !!isFlatOwner });
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
  req.log.info('forgot_password_start', { mobno });

  const details = await CardDb.findOne({
    where: { mobno: mobno }
  });
  if (!details) {
    req.log.warn('forgot_password_user_not_found', { mobno });
    throw new ApiError(404, 'user not found');
  }
  let temporaryPassword = generateTemporaryPassword();
  temporaryPassword = temporaryPassword.trim();
  const salt = bcrypt.genSaltSync(10);
  const hash = bcrypt.hashSync(temporaryPassword, salt);

  await CardDb.update({ password: hash }, { where: { mobno: mobno } });
  req.log.info('forgot_password_temp_set', { mobno, cardno: details.cardno });

  sendMail({
    email: details.email,
    subject: 'Temporary Password',
    template: 'forgotPasswordEmail',
    context: {
      password: temporaryPassword,
      name: details.issuedto
    }
  });
  req.log.info('forgot_password_email_sent', { mobno, email: details.email });

  const phone = details.mobno;
  if (phone) {
    try {
      const cleanPhone = String(phone).replace(/\D/g, '');
      const formattedPhone = cleanPhone.startsWith('91')
        ? cleanPhone
        : `91${cleanPhone}`;

      const components = [
        {
          type: 'body',
          parameters: [
            {
              type: 'text',
              text: temporaryPassword
            },
            {
              type: 'text',
              text: WHATSAPP_SUPPORT_NUMBER
            }
          ]
        },
        {
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [
            {
              type: 'text',
              text: temporaryPassword
            }
          ]
        }
      ];

      await sendWhatsAppMessage(formattedPhone, 'password_reset_app', components);
    } catch (err) {
      console.error('Error sending WhatsApp message in forgotPassword:', err.message || err);
    }
  }

  return res.status(200).send({
    message: 'Temporary password sent to your email and WhatsApp',
    data: { email: details.email }
  });
}

