import {
  MSG_UPDATE_SUCCESSFUL,
  WHATSAPP_SUPPORT_NUMBER,
  STATUS_MUMUKSHU,
  STATUS_SEVA_KUTIR,
  STATUS_GUEST
} from '../../config/constants.js';
import {
  CardDb,
  FlatDb,
  GuestRelationship,
  Departments
} from '../../models/associations.js';
import database from '../../config/database.js';
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
  const details = await CardDb.findOne({
    where: { cardno: req.user.cardno },
    attributes: {
      exclude: ['id', 'createdAt', 'updatedAt', 'updatedBy']
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
  req.log.info('check_mobile_start', { mobno });

  if (!mobno || String(mobno).trim().length !== 10) {
    throw new ApiError(400, 'A valid 10-digit phone number is required');
  }

  const existing = await CardDb.findOne({
    where: { mobno },
    attributes: ['id', 'issuedto', 'res_status']
  });

  return res.status(200).send({
    exists: !!existing,
    name: existing ? existing.issuedto : null,
    res_status: existing ? existing.res_status : null
  });
}

export async function register(req, res) {
  const {
    issuedto,
    mobno,
    gender,
    password,
    res_status,
    department,
    ref_mobno,
    guest_type,
    dob,
    center
  } = req.body;

  const resStatusToUse = res_status || STATUS_MUMUKSHU;

  req.log.info('register_start', { mobno, res_status: resStatusToUse });

  // ── Basic required field validation ──────────────────────────────────────
  if (!issuedto || !issuedto.trim()) {
    throw new ApiError(400, 'Full name is required');
  }
  if (!mobno || String(mobno).trim().length !== 10) {
    throw new ApiError(400, 'A valid 10-digit phone number is required');
  }
  if (!gender || !['M', 'F'].includes(gender)) {
    throw new ApiError(400, 'Gender must be M or F');
  }
  if (!password || !password.trim()) {
    throw new ApiError(400, 'Password is required');
  }
  if (!dob) {
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
  if (!center || !center.trim()) {
    throw new ApiError(400, 'Centre is required');
  }
  const validStatuses = [
    STATUS_MUMUKSHU,
    'PR',
    STATUS_SEVA_KUTIR,
    STATUS_GUEST
  ];
  if (!resStatusToUse || !validStatuses.includes(resStatusToUse)) {
    throw new ApiError(400, 'Invalid residential status');
  }

  // ── Conditional validation ────────────────────────────────────────────────
  let refMumukshuCardno = null;

  if (resStatusToUse === STATUS_SEVA_KUTIR) {
    if (!department || !department.trim()) {
      throw new ApiError(
        400,
        'Department is required for Seva Kutir registration'
      );
    }
    const dept = await Departments.findOne({
      where: { dept_name: department }
    });
    if (!dept) {
      throw new ApiError(400, 'Invalid department selected');
    }
  }

  if (resStatusToUse === STATUS_GUEST) {
    if (!ref_mobno || String(ref_mobno).trim().length !== 10) {
      throw new ApiError(
        400,
        'A valid 10-digit reference Mumukshu phone number is required'
      );
    }
    if (
      !guest_type ||
      !['family', 'friend', 'driver', 'vip'].includes(guest_type)
    ) {
      throw new ApiError(
        400,
        'Guest type must be family, friend, driver, or vip'
      );
    }
    const refMumukshu = await CardDb.findOne({
      where: { mobno: ref_mobno, res_status: STATUS_MUMUKSHU },
      attributes: ['cardno']
    });
    if (!refMumukshu) {
      throw new ApiError(
        404,
        'Reference phone number does not belong to a registered Mumukshu'
      );
    }
    refMumukshuCardno = refMumukshu.cardno;
  }

  // ── Uniqueness check ──────────────────────────────────────────────────────
  const existing = await CardDb.findOne({
    where: { mobno },
    attributes: ['id']
  });
  if (existing) {
    throw new ApiError(409, 'An account with this phone number already exists');
  }

  // ── Generate cardno (MAX(id)+1, zero-padded to 10 digits) ─────────────────
  const maxId = await CardDb.max('id');
  const cardno = String((maxId || 0) + 1).padStart(10, '0');

  // ── Hash password ─────────────────────────────────────────────────────────
  const salt = bcrypt.genSaltSync(10);
  const hashedPassword = bcrypt.hashSync(password.trim(), salt);

  // ── Create records in a transaction ──────────────────────────────────────
  const t = await database.transaction();
  try {
    const newCard = await CardDb.create(
      {
        cardno,
        issuedto: issuedto.trim(),
        gender,
        dob,
        mobno,
        center: center.trim(),
        res_status: resStatusToUse,
        status: 'offprem',
        active: true,
        password: hashedPassword,
        updatedBy: 'USER',
        ...(resStatusToUse === STATUS_SEVA_KUTIR && { department })
      },
      { transaction: t }
    );

    if (resStatusToUse === STATUS_GUEST) {
      await GuestRelationship.create(
        {
          cardno: refMumukshuCardno,
          guest: cardno,
          type: guest_type,
          updatedBy: cardno
        },
        { transaction: t }
      );
    }

    await t.commit();

    req.log.info('register_success', { cardno, res_status: resStatusToUse });

    // Return same shape as verifyAndLogin so setUser() works on the app
    newCard.setDataValue('password', '');
    newCard.setDataValue('isFlatOwner', false);

    return res
      .status(201)
      .send({ message: 'Account created successfully', data: newCard });
  } catch (err) {
    await t.rollback();
    req.log.error('register_failed', { mobno, err: err.message });
    throw err;
  }
}
