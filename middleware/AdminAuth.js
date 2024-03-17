import { AdminRoles, AdminUsers } from '../models/associations.js';
import { STATUS_ACTIVE, STATUS_INACTIVE } from '../config/constants.js';
import jwt from 'jsonwebtoken';
import ApiError from '../utils/ApiError.js';
import CatchAsync from '../utils/CatchAsync.js';

export const auth = CatchAsync(async (req, res, next) => {
  const header = req.header('Authorization');
  if (!header) throw new ApiError(401, 'Unauthorized');

  const token = header.replace('Bearer ', '');
  const decoded = jwt.verify(token, process.env.SECRET);

  const user = await AdminUsers.findOne({
    where: {
      id: decoded.user.id,
      username: decoded.user.username
    }
  });
  if (!user) throw new ApiError(401, 'Unauthorized');
  if (user.dataValues.status === STATUS_INACTIVE)
    throw new ApiError(401, 'Account Deactivated');

  const roles = await AdminRoles.findAll({
    attributes: ['role_name'],
    where: { user_id: decoded.user.id, status: STATUS_ACTIVE }
  });
  const admin_roles = roles.map((role) => role.dataValues.role_name);

  req.user = decoded.user;
  req.roles = admin_roles;
  next();
});

export const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    const userRoles = req.roles || [];
    const isAuthorized = roles.some((role) => userRoles.includes(role));
    if (isAuthorized) {
      next();
    } else {
      throw new ApiError(401, 'Unauthorized');
    }
  };
};
