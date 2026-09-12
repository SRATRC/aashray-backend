import { AdminRoles, AdminUsers } from '../models/associations.js';
import { STATUS_ACTIVE, STATUS_INACTIVE, ROLE_UTSAV_READ_ONLY } from '../config/constants.js';
import { attachUserContext } from './Logger.js';
import ApiError from '../utils/ApiError.js';
import CatchAsync from '../utils/CatchAsync.js';
import jwt from 'jsonwebtoken';
import ShortLink from '../models/short_link.model.js';

export const auth = CatchAsync(async (req, res, next) => {
  const header = req.header('Authorization');
  if (!header) throw new ApiError(401, 'Unauthorized');

  const token = header.replace('Bearer ', '');
  const decoded = jwt.verify(token, process.env.SECRET);

  if (decoded && (decoded.type === 'temporary_share_access' || decoded.type === 'utsav_report_share')) {
    // Verify that the shortlink has not been revoked via the toggle endpoint.
    // We look up by the slug embedded in the JWT to check its active status in DB.
    const slug = decoded.slug;
    if (!slug) {
      throw new ApiError(401, 'Access link is invalid or has been revoked');
    }
    const link = await ShortLink.findOne({ where: { slug } });
    if (!link || !link.active) {
      throw new ApiError(401, 'This access link has been revoked');
    }

    const roles = decoded.roles || (decoded.role ? [decoded.role] : [ROLE_UTSAV_READ_ONLY]);

    const scope = decoded.scope || {};
    req.user = {
      id: 0,
      username: decoded.username || 'temporary_share_viewer',
      isShareToken: true,
      shareType: decoded.type,
      resource: decoded.resource || 'general',
      utsavId: decoded.utsavId || scope.utsavId,
      location: decoded.location || scope.location,
      scope: scope
    };
    req.roles = Array.isArray(roles) ? roles : [roles];
    attachUserContext(req);
    return next();
  }

  if (!decoded || !decoded.user) throw new ApiError(401, 'Unauthorized');

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
  attachUserContext(req);
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
