import { AdminUsers, AdminRoles } from '../../models/associations.js';
import { STATUS_ACTIVE, STATUS_INACTIVE } from '../../config/constants.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import ApiError from '../../utils/ApiError.js';
import database from '../../config/database.js';

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

  const { username, password, roles } = req.body;

  const hash = await bcrypt.hash(password, 10);
  const admin = await AdminUsers.create(
    {
      username: username,
      password: hash,
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
  return res.status(201).send({ message: 'successfully created admin' });
};
