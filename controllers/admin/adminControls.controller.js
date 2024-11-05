import { AdminUsers, AdminRoles, Roles } from '../../models/associations.js';
import { STATUS_ACTIVE, STATUS_INACTIVE } from '../../config/constants.js';
import database from '../../config/database.js';
import ApiError from '../../utils/ApiError.js';

export const fetchAllAdmins = async (req, res) => {
  const admins = await AdminUsers.findAll();
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
  const updatedItems = await AdminUsers.update(
    {
      status: STATUS_INACTIVE,
      updatedBy: req.user.username
    },
    {
      where: {
        username: req.params.username
      }
    }
  );

  if (updatedItems == 0)
    throw new ApiError(500, 'error occured while deactivating admin account');

  return res.status(200).send({ message: 'deactivated admin' });
};

export const activateAdmin = async (req, res) => {
  const updatedItems = await AdminUsers.update(
    {
      status: STATUS_ACTIVE,
      updatedBy: req.user.username
    },
    {
      where: {
        username: req.params.username
      }
    }
  );

  if (updatedItems == 0)
    throw new ApiError(500, 'error occured while activating admin account');

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
