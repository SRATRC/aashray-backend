import { AdminUsers, AdminRoles, Roles, CardDb } from '../../models/associations.js';
import { STATUS_ACTIVE, STATUS_INACTIVE } from '../../config/constants.js';
import database from '../../config/database.js';
import ApiError from '../../utils/ApiError.js';
import { Sequelize } from 'sequelize';
import { sendWhatsAppMessage } from '../../utils/sendWhatsAppMessage.js';


export const fetchAllAdmins = async (req, res) => {
  const admins = await AdminUsers.findAll({
    order: [
      [Sequelize.literal("status = 'active'"), 'DESC'], // Put active first
      ['username', 'ASC']                              // Then sort alphabetically
    ]
  });

  res.status(200).send({ message: 'fetched admins', data: admins });
};

export const updateAdminRoles = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const { userid, roles } = req.body;

  // await AdminRoles.destroy({
  //   where: {
  //     user_id: userid
  //   },
  //   transaction: t
  // });

  await AdminRoles.update(
    {
      status: STATUS_INACTIVE,
      updatedBy: req.user.username
    },
    { where: { user_id: userid }, transaction: t }
  );

  const admin_roles_data = [];
  for (let i of roles) {
    admin_roles_data.push({
      user_id: userid,
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
  return res.status(200).send({ message: 'updated admin roles' });
};

export const deactivateAdmin = async (req, res) => {
  const username = req.params.username;

  const admin = await AdminUsers.findOne({
    where: { username },
    include: [
      {
        model: CardDb,
        as: 'card',
        attributes: ['issuedto', 'mobno']
      }
    ]
  });

  if (!admin) {
    throw new ApiError(404, 'Admin user not found');
  }

  await admin.update({
    status: STATUS_INACTIVE,
    updatedBy: req.user.username
  });

  // Send WhatsApp notification if linked to a card
  if (admin.card && admin.card.mobno) {
    try {
      const phone = admin.card.mobno;
      const cleanPhone = String(phone).replace(/\D/g, '');
      const formattedPhone = cleanPhone.startsWith('91') ? cleanPhone : `91${cleanPhone}`;

      const components = [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: admin.card.issuedto || 'Mumukshu' },
            { type: 'text', text: username },
            { type: 'text', text: 'deactivated' }
          ]
        }
      ];

      await sendWhatsAppMessage(formattedPhone, 'admin_status_updated', components);
    } catch (waErr) {
      console.error('Error triggering WhatsApp notification for admin deactivation:', waErr.message || waErr);
    }
  }

  return res.status(200).send({ message: 'deactivated admin' });
};

export const activateAdmin = async (req, res) => {
  const username = req.params.username;

  const admin = await AdminUsers.findOne({
    where: { username },
    include: [
      {
        model: CardDb,
        as: 'card',
        attributes: ['issuedto', 'mobno']
      }
    ]
  });

  if (!admin) {
    throw new ApiError(404, 'Admin user not found');
  }

  await admin.update({
    status: STATUS_ACTIVE,
    updatedBy: req.user.username
  });

  // Send WhatsApp notification if linked to a card
  if (admin.card && admin.card.mobno) {
    try {
      const phone = admin.card.mobno;
      const cleanPhone = String(phone).replace(/\D/g, '');
      const formattedPhone = cleanPhone.startsWith('91') ? cleanPhone : `91${cleanPhone}`;

      const components = [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: admin.card.issuedto || 'Mumukshu' },
            { type: 'text', text: username },
            { type: 'text', text: 'activated' }
          ]
        }
      ];

      await sendWhatsAppMessage(formattedPhone, 'admin_status_updated', components);
    } catch (waErr) {
      console.error('Error triggering WhatsApp notification for admin activation:', waErr.message || waErr);
    }
  }

  return res.status(200).send({ message: 'activated admin' });
};

export const createRole = async (req, res) => {
  const all_roles = await Roles.findAll({
    attributes: ['name']
  });
  const all_roles_data = all_roles.map((role) => role.dataValues.name);
  if (all_roles_data.includes(req.params.name))
    throw new ApiError(400, 'name already taken');

  await Roles.create({
    name: req.params.name,
    updatedBy: req.user.username
  });

  return res.status(201).send({ message: 'role created' });
};

export const fetchRoles = async (req, res) => {
  const roles = await Roles.findAll({
    attributes: ['name'],
    where: {
      status: STATUS_ACTIVE
    }
  });
  const role_data = roles.map((role) => role.dataValues.name);
  return res
    .status(200)
    .send({ message: 'fetched all roles', data: role_data });
};

// export const updateRole = async (req, res) => {
//   const role = await Roles.findByPk(req.params.name);
//   if (!role) throw new ApiError(500, 'cannot find the given role');

//   role.name = req.body.role;
//   await role.save();

//   return res.status(200).send({ message: 'role updated' });
// };

export const deleteRole = async (req, res) => {
  const deletedItems = await Roles.destroy({
    where: {
      name: req.params.name
    }
  });

  if (deletedItems == 0)
    throw new ApiError(500, 'error occured while deleting role');

  return res.status(200).send({ message: 'role deleted' });
};
