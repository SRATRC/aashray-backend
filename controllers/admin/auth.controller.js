import { AdminUsers, AdminRoles, CardDb } from '../../models/associations.js';
import { STATUS_ACTIVE, STATUS_INACTIVE } from '../../config/constants.js';
import { attachUserContext } from '../../middleware/Logger.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import ApiError from '../../utils/ApiError.js';
import database from '../../config/database.js';
import { sendWhatsAppMessage } from '../../utils/sendWhatsAppMessage.js';
import { formatWhatsAppPhone } from '../../utils/phoneFormatter.js';

export const login = async (req, res) => {
  const { username } = req.body;
  req.log.info('admin_login_start', { username });

  const admin = await AdminUsers.findOne({
    where: { username: username }
  });

  if (!admin) {
    req.log.warn('admin_login_user_not_found', { username });
    throw new ApiError(404, 'Invalid Username');
  }

  if (admin.dataValues.status === STATUS_INACTIVE) {
    req.log.warn('admin_login_account_deactivated', { username });
    throw new ApiError(401, 'Account Deactivated');
  }

  const roles = await AdminRoles.findAll({
    attributes: ['role_name'],
    where: { user_id: admin.dataValues.id, status: STATUS_ACTIVE }
  });
  const admin_roles = roles.map((role) => role.dataValues.role_name);

  const result = await bcrypt.compare(req.body.password, admin.password);
  if (result) {
    const token = jwt.sign(
      {
        user: {
          id: admin.dataValues.id,
          username: admin.dataValues.username,
          password: admin.dataValues.password,
          status: admin.dataValues.status
        }
      },
      process.env.SECRET
    );
    req.log.info('admin_login_success', { username, roles: admin_roles });
    return res.status(200).send({ token: token, roles: admin_roles, username: admin.dataValues.username });
  } else {
    req.log.warn('admin_login_incorrect_password', { username });
    throw new ApiError(401, 'Incorrect password');
  }
};

export const createAdmin = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const { username, password, roles, cardno } = req.body;
  req.log.info('create_admin_start', { username, roles });

  const hash = await bcrypt.hash(req.body.password, 10);
  const admin = await AdminUsers.create(
    {
      username: username,
      password: hash,
      cardno: cardno || null,
      updatedBy: req.user.username
    },
    { transaction: t }
  );

  if (!admin)
    throw new ApiError(500, 'Unexpected error occured while creating admin');

  const admin_roles_data = [];
  for (let i of roles) {
    admin_roles_data.push({
      user_id: admin.dataValues.id,
      role_name: i,
      updatedBy: req.user.username
    });
  }

  const admin_roles = await AdminRoles.bulkCreate(admin_roles_data, {
    transaction: t
  });
  if (admin_roles.length == 0)
    throw new ApiError(500, 'Unexpected error occured while creating admin');

  await t.commit();

  req.log.info('create_admin_success', { username, adminId: admin.dataValues.id, roles });

  // Send WhatsApp notification if cardno is linked
  if (cardno) {
    try {
      const cardEntry = await CardDb.findOne({ where: { cardno } });
      const phone = cardEntry ? cardEntry.mobno : null;
      if (phone) {
        const formattedPhone = formatWhatsAppPhone(phone, cardEntry ? cardEntry.country : null);

        const components = [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: cardEntry.issuedto || 'Mumukshu' }
            ]
          }
        ];

        await sendWhatsAppMessage(formattedPhone, 'admin_account_created', components);
      }
    } catch (waErr) {
      console.error('Error triggering WhatsApp notification for admin creation:', waErr.message || waErr);
    }
  }

  return res.status(201).send({ message: 'successfully created admin' });
};

export const resetPassword = async (req, res) => {
  const { username, newPassword } = req.body;
  req.log.info('reset_password_start', { username });

  if (!username || !newPassword) {
    req.log.warn('reset_password_missing_fields', { username });
    return res.status(400).json({ message: 'Username and new password are required' });
  }

  if (newPassword.length < 8) {
    req.log.warn('reset_password_too_short', { username });
    return res.status(400).json({ message: 'Password must be at least 8 characters long' });
  }

  try {
    const user = await AdminUsers.findOne({
      where: { username },
      include: [
        {
          model: CardDb,
          as: 'card',
          attributes: ['issuedto', 'mobno', 'country']
        }
      ]
    });
    if (!user) {
      req.log.warn('reset_password_user_not_found', { username });
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.dataValues.status === STATUS_INACTIVE) {
      req.log.warn('reset_password_account_deactivated', { username });
      return res.status(403).json({ message: 'Account is deactivated' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await user.update({ password: hashedPassword });

    req.log.info('reset_password_success', { username });

    // Send WhatsApp notification if linked to a card
    if (user.card && user.card.mobno) {
      try {
        const phone = user.card.mobno;
        const formattedPhone = formatWhatsAppPhone(phone, user.card ? user.card.country : null);

        const components = [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: user.card.issuedto || 'Mumukshu' },
              { type: 'text', text: username }
            ]
          }
        ];

        await sendWhatsAppMessage(formattedPhone, 'admin_password_reset_notice', components);
      } catch (waErr) {
        console.error('Error triggering WhatsApp notification for admin password reset:', waErr.message || waErr);
      }
    }

    res.status(200).json({ message: 'Password successfully reset' });
  } catch (err) {
    req.log.error('reset_password_error', { username, error: err.message });
    res.status(500).json({ message: 'Internal server error' });
  }
};
