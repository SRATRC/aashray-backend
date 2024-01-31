import jwt from 'jsonwebtoken';
import ApiError from '../utils/ApiError.js';
import CatchAsync from '../utils/CatchAsync.js';
import AdminUsers from '../models/admin_users.model.js';

export const auth = CatchAsync(async (req, res, next) => {
  const header = req.header('Authorization');
  if (!header) throw new ApiError(401, 'Unauthorized');

  const token = header.replace('Bearer ', '');
  const decoded = jwt.verify(token, process.env.SECRET);

  const user = await AdminUsers.findOne({
    username: decoded.user.username,
    status: 'active'
  });
  if (!user) throw new ApiError(401, 'Unauthorized');

  req.user = decoded.user;
  req.roles = decoded.roles;
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
