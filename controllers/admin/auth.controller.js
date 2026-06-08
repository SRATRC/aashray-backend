import { AdminUsers, AdminRoles, CardDb } from '../../models/associations.js';
import { STATUS_ACTIVE, STATUS_INACTIVE } from '../../config/constants.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import ApiError from '../../utils/ApiError.js';
import database from '../../config/database.js';
import { sendWhatsAppMessage } from '../../utils/sendWhatsAppMessage.js';

export const login = async (req, res) => {
  const { username, password } = req.body;
  const admin = await AdminUsers.findOne({
    where: { username: username }
  });
  if (admin.dataValues.status === STATUS_INACTIVE)
    throw new ApiError(401, 'Account Deactivated');

  if (!admin) {
    throw new ApiError(404, 'Invalid Username');
  }
  
  const roles = await AdminRoles.findAll({
    attributes: ['role_name'],
    where: { user_id: admin.dataValues.id, status: STATUS_ACTIVE }
  });
  const admin_roles = roles.map((role) => role.dataValues.role_name);

  const result = await bcrypt.compare(password, admin.password);
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
    return res.status(200).send({ token: token, roles: admin_roles });
  } else {
    throw new ApiError(401, 'Incorrect password');
  }
};

export const createAdmin = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const { username, password, roles, cardno } = req.body;

  const hash = await bcrypt.hash(password, 10);
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

  // Send WhatsApp notification if cardno is linked
  if (cardno) {
    try {
      const cardEntry = await CardDb.findOne({ where: { cardno } });
      const phone = cardEntry ? cardEntry.mobno : null;
      if (phone) {
        const cleanPhone = String(phone).replace(/\D/g, '');
        const formattedPhone = cleanPhone.startsWith('91') ? cleanPhone : `91${cleanPhone}`;

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

  if (!username || !newPassword) {
    return res.status(400).json({ message: 'Username and new password are required' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters long' });
  }

  try {
    const user = await AdminUsers.findOne({
      where: { username },
      include: [
        {
          model: CardDb,
          as: 'card',
          attributes: ['issuedto', 'mobno']
        }
      ]
    });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.dataValues.status === STATUS_INACTIVE) {
      return res.status(403).json({ message: 'Account is deactivated' });
    }
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await user.update({ password: hashedPassword });

    // Send WhatsApp notification if linked to a card
    if (user.card && user.card.mobno) {
      try {
        const phone = user.card.mobno;
        const cleanPhone = String(phone).replace(/\D/g, '');
        const formattedPhone = cleanPhone.startsWith('91') ? cleanPhone : `91${cleanPhone}`;

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
    console.error('Error resetting password:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
};
