import {
  MSG_UPDATE_SUCCESSFUL,
  WHATSAPP_SUPPORT_NUMBER,
  STATUS_MUMUKSHU,
  STATUS_SEVA_KUTIR,
  STATUS_GUEST,
  STATUS_OFFPREM,
  STATUS_PR,
  GUEST_TYPES
} from '../../config/constants.js';
import {
  CardDb,
  FlatDb,
  GuestRelationship,
  Departments
} from '../../models/associations.js';
import database from '../../config/database.js';
import { createCardIds } from '../helper.js';
import { attachUserContext } from '../../middleware/Logger.js';
import ApiError from '../../utils/ApiError.js';
import bcrypt from 'bcrypt';
import sendMail from '../../utils/sendMail.js';
import { sendWhatsAppMessage } from '../../utils/sendWhatsAppMessage.js';
import { formatWhatsAppPhone } from '../../utils/phoneFormatter.js';
import moment from 'moment';

export const updatePassword = async (req, res) => {
  attachUserContext(req);
  req.log.info('update_password_start', { cardno: req.user.cardno });

  const current_password = req.body.current_password.trim();
  const new_password = req.body.new_password.trim();

  if (!current_password || !new_password) {
    req.log.warn('update_password_missing_fields', { cardno: req.user.cardno });
    throw new ApiError(404, 'Please provide all the fields');
  }
  const details = await CardDb.scope('withPassword').findOne({
    where: { cardno: req.user.cardno },
    attributes: {
      exclude: ['id', 'token', 'createdAt', 'updatedAt', 'updatedBy']
    }
  });

  const match = bcrypt.compareSync(current_password, details.password);
  if (!match) {
    req.log.warn('update_password_incorrect_current', {
      cardno: req.user.cardno
    });
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
      const formattedPhone = formatWhatsAppPhone(phone, details.country);

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

      await sendWhatsAppMessage(
        formattedPhone,
        'password_update_app',
        components
      );
    } catch (err) {
      console.error(
        'Error sending WhatsApp message in updatePassword:',
        err.message || err
      );
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

  const details = await CardDb.scope('withPassword').findOne({
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
  // Sign-up and password change store the trimmed password, so accept it
  // trimmed here too. The raw value still works for older passwords.
  const match =
    bcrypt.compareSync(password, details.password) ||
    bcrypt.compareSync(String(password).trim(), details.password);

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

  req.log.info('login_success', {
    cardno: details.cardno,
    isFlatOwner: !!isFlatOwner
  });
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
      const formattedPhone = formatWhatsAppPhone(phone, details.country);

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

      await sendWhatsAppMessage(
        formattedPhone,
        'password_reset_app',
        components
      );
    } catch (err) {
      console.error(
        'Error sending WhatsApp message in forgotPassword:',
        err.message || err
      );
    }
  }

  return res.status(200).send({
    message: 'Temporary password sent to your email and WhatsApp',
    data: { email: details.email }
  });
}

export async function checkMobile(req, res) {
  const { mobno } = req.params;
  req.log.info('check_mobile_start');

  if (!/^\d{10}$/.test(String(mobno ?? '').trim())) {
    throw new ApiError(400, 'A valid 10-digit phone number is required');
  }

  // Public route: it only says whether the number is taken. No name, no
  // member type, so it cannot be used to look people up.
  const existing = await CardDb.findOne({
    where: { mobno },
    attributes: ['id']
  });

  return res.status(200).send({ exists: !!existing });
}

export async function register(req, res) {
  // Public route: only a Mumukshu can sign up here. res_status, department,
  // ref_mobno and guest_type in the body are ignored. Staff make other member
  // types through the staff create-card route.
  const { issuedto, mobno, gender, password, dob, center, token } = req.body;

  const resStatusToUse = STATUS_MUMUKSHU;

  req.log.info('register_start', { res_status: resStatusToUse });

  // ── Basic required field validation (types first, so bad input is a 400) ──
  const isText = (v) => typeof v === 'string' && v.trim().length > 0;
  if (!isText(issuedto)) {
    throw new ApiError(400, 'Full name is required');
  }
  if (typeof mobno !== 'string' || !/^\d{10}$/.test(mobno.trim())) {
    throw new ApiError(400, 'A valid 10-digit phone number is required');
  }
  if (!gender || !['M', 'F'].includes(gender)) {
    throw new ApiError(400, 'Gender must be M or F');
  }
  if (!isText(password)) {
    throw new ApiError(400, 'Password is required');
  }
  if (typeof dob !== 'string' || !dob) {
    throw new ApiError(400, 'Date of birth is required');
  }
  const dobMoment = moment(dob, 'YYYY-MM-DD', true);
  if (!dobMoment.isValid()) {
    throw new ApiError(400, 'Invalid date of birth format');
  }
  if (dobMoment.isAfter(moment(), 'day')) {
    throw new ApiError(400, 'Date of birth cannot be in the future');
  }
  if (dobMoment.isBefore('1900-01-01')) {
    throw new ApiError(400, 'Please select a valid date of birth');
  }
  if (!isText(center)) {
    throw new ApiError(400, 'Centre is required');
  }
  if (token !== undefined && token !== null && typeof token !== 'string') {
    throw new ApiError(400, 'Invalid push token');
  }

  // ── Uniqueness check ──────────────────────────────────────────────────────
  const existing = await CardDb.findOne({
    where: { mobno },
    attributes: ['id']
  });
  if (existing) {
    throw new ApiError(409, 'An account with this phone number already exists');
  }

  // ── Hash password ─────────────────────────────────────────────────────────
  const salt = bcrypt.genSaltSync(10);
  const hashedPassword = bcrypt.hashSync(password.trim(), salt);

  // ── Create records in a transaction ──────────────────────────────────────
  const t = await database.transaction();
  try {
    // Random 10-digit number, same as guest cards made at booking. It is
    // checked against all cards; the unique key on cardno stops a clash.
    const [cardno] = await createCardIds(1);
    const newCard = await CardDb.create(
      {
        cardno,
        issuedto: issuedto.trim(),
        gender,
        dob,
        mobno,
        center: center.trim(),
        res_status: resStatusToUse,
        status: STATUS_OFFPREM,
        active: true,
        password: hashedPassword,
        ...(token && { token }),
        updatedBy: 'USER'
      },
      { transaction: t }
    );

    await t.commit();

    req.log.info('register_success', { cardno, res_status: resStatusToUse });

    // Same shape as verifyAndLogin so setUser() works on the app. The
    // password and the push address stay on the server.
    const { password: _pw, token: _tk, ...cardData } = newCard.get({
      plain: true
    });

    return res.status(201).send({
      message: 'Account created successfully',
      data: { ...cardData, isFlatOwner: false }
    });
  } catch (err) {
    await t.rollback();
    req.log.error('register_failed', { err: err.message });
    if (err.name === 'SequelizeUniqueConstraintError') {
      const field = err.errors?.[0]?.path;
      if (field === 'mobno') {
        throw new ApiError(
          409,
          'An account with this phone number already exists'
        );
      }
      throw new ApiError(409, 'Could not create the account. Please try again.');
    }
    throw err;
  }
}
