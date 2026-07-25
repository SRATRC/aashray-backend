import { AdminUsers, AdminRoles, Roles, CardDb } from '../../models/associations.js';
import { STATUS_ACTIVE, STATUS_INACTIVE } from '../../config/constants.js';
import database from '../../config/database.js';
import ApiError from '../../utils/ApiError.js';
import { Sequelize } from 'sequelize';
import { sendWhatsAppMessage } from '../../utils/sendWhatsAppMessage.js';
import { formatWhatsAppPhone } from '../../utils/phoneFormatter.js';


export const fetchAllAdmins = async (req, res) => {
  const admins = await AdminUsers.findAll({
    include: [
      {
        model: AdminRoles,
        where: { status: STATUS_ACTIVE },
        required: false
      }
    ],
    order: [
      [Sequelize.literal("`AdminUsers`.`status` = 'active'"), 'DESC'], // Put active first
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
        attributes: ['issuedto', 'mobno', 'country']
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
      const formattedPhone = formatWhatsAppPhone(phone, admin.card.country);

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
        attributes: ['issuedto', 'mobno', 'country']
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
      const formattedPhone = formatWhatsAppPhone(phone, admin.card.country);

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

export const deleteAdmin = async (req, res) => {
  const username = req.params.username;

  const admin = await AdminUsers.findOne({
    where: { username }
  });

  if (!admin) {
    throw new ApiError(404, 'Admin user not found');
  }

  if (admin.username === req.user.username) {
    throw new ApiError(400, 'You cannot delete yourself.');
  }

  await admin.destroy();

  return res.status(200).send({ message: 'Admin user deleted successfully' });
};

export const bulkDeactivateAdmins = async (req, res) => {
  const { usernames } = req.body;
  if (!usernames || !Array.isArray(usernames) || usernames.length === 0) {
    throw new ApiError(400, 'Invalid usernames array');
  }

  const t = await database.transaction();
  req.transaction = t;

  try {
    // Check if superadmin is trying to deactivate themselves
    if (usernames.includes(req.user.username)) {
      throw new ApiError(400, 'You cannot deactivate yourself.');
    }

    // Update users status
    await AdminUsers.update(
      {
        status: STATUS_INACTIVE,
        updatedBy: req.user.username
      },
      {
        where: { username: usernames },
        transaction: t
      }
    );

    await t.commit();

    // Trigger WhatsApp notification for each deactivated admin asynchronously
    for (const username of usernames) {
      AdminUsers.findOne({
        where: { username },
        include: [{ model: CardDb, as: 'card', attributes: ['issuedto', 'mobno', 'country'] }]
      }).then(admin => {
        if (admin && admin.card && admin.card.mobno) {
          const phone = admin.card.mobno;
          const formattedPhone = formatWhatsAppPhone(phone, admin.card.country);
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
          sendWhatsAppMessage(formattedPhone, 'admin_status_updated', components).catch(err => {
            console.error(`Error sending WA notification for bulk deactivate of ${username}:`, err.message || err);
          });
        }
      }).catch(err => {
        console.error(`Error fetching user details for WA notification of ${username}:`, err.message || err);
      });
    }

    return res.status(200).send({ message: 'Successfully deactivated selected administrators' });
  } catch (error) {
    await t.rollback();
    throw error;
  }
};

export const bulkAssignRoles = async (req, res) => {
  const { userids, roles } = req.body;
  if (!userids || !Array.isArray(userids) || userids.length === 0) {
    throw new ApiError(400, 'Invalid userids array');
  }
  if (!roles || !Array.isArray(roles) || roles.length === 0) {
    throw new ApiError(400, 'Invalid roles array');
  }

  const t = await database.transaction();
  req.transaction = t;

  try {
    for (const userid of userids) {
      // Fetch active roles
      const currentRoles = await AdminRoles.findAll({
        where: { user_id: userid, status: STATUS_ACTIVE },
        transaction: t
      });
      const currentRoleNames = currentRoles.map(r => r.role_name);

      // Append new roles and remove duplicates
      const updatedRoles = [...new Set([...currentRoleNames, ...roles])];

      // Mark all current roles as inactive
      await AdminRoles.update(
        {
          status: STATUS_INACTIVE,
          updatedBy: req.user.username
        },
        {
          where: { user_id: userid },
          transaction: t
        }
      );

      // Bulk create new set of roles
      const admin_roles_data = updatedRoles.map(role => ({
        user_id: userid,
        role_name: role,
        updatedBy: req.user.username
      }));

      await AdminRoles.bulkCreate(admin_roles_data, { transaction: t });
    }

    await t.commit();
    return res.status(200).send({ message: 'Successfully updated roles for selected administrators' });
  } catch (error) {
    await t.rollback();
    throw error;
  }
};

