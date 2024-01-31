import { AdminUsers, AdminRoles } from '../../models/associations.js';
import APIError from '../../utils/ApiError.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import ApiError from '../../utils/ApiError.js';

export const login = async (req, res) => {
  const { username, password } = req.body;
  const admin = await AdminUsers.findOne({
    where: { username: username, status: 'active' }
  });

  if (!admin) {
    throw new APIError(404, 'Invalid Username');
  }

  const result = await bcrypt.compare(password, admin.password);
  if (result) {
    const roles = await AdminRoles.findAll({
      attributes: ['role_name'],
      where: { user_id: admin.id }
    });
    const admin_roles = roles.map((role) => role.dataValues.role_name);

    const token = jwt.sign(
      { user: admin.dataValues, roles: admin_roles },
      process.env.SECRET
    );
    return res.status(200).send({ token: token });
  } else {
    throw new APIError(401, 'Incorrect password');
  }
};

export const createAdmin = async (req, res) => {
  const { username, password, roles } = req.body;

  const hash = await bcrypt.hash(password, 10);
  const admin = await AdminUsers.create({
    username: username,
    password: hash
  });

  if (!admin)
    throw new ApiError(500, 'Unexpected error occured while creating admin');

  const admin_roles_data = [];
  for (let i of roles) {
    admin_roles_data.push({ user_id: admin.dataValues.id, role_name: i });
  }

  const admin_roles = await AdminRoles.bulkCreate(admin_roles_data);
  if (admin_roles.length == 0)
    throw new ApiError(500, 'Unexpected error occured while creating admin');

  return res.status(200).send({ message: 'successfully created admin' });
};
