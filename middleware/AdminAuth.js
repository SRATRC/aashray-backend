import { AdminRoles, AdminUsers } from '../models/associations.js';
import { STATUS_ACTIVE, STATUS_INACTIVE, ROLE_UTSAV_READ_ONLY, ROLE_KIOSK_ADMIN } from '../config/constants.js';
import { attachUserContext } from './Logger.js';
import ApiError from '../utils/ApiError.js';
import CatchAsync from '../utils/CatchAsync.js';
import jwt from 'jsonwebtoken';
import ShortLink from '../models/short_link.model.js';

const KIOSK_ROUTES = [
  ['GET', /^\/stay\/kiosk\/bookings\/[^/]+$/],
  ['POST', /^\/stay\/kiosk\/wifi\/generate[-_]temp[-_]code$/],
  ['GET', /^\/stay\/kiosk\/wifi\/fetch[-_]temp[-_]codes\/[^/]+$/],
  ['PUT', /^\/stay\/(flat_)?check(in|out)\/[^/]+$/]
];

const isKioskRoute = (req) => {
  const adminPath = (req.baseUrl + req.path).replace(/^\/api\/v1\/admin/, '');
  return KIOSK_ROUTES.some(([method, re]) => req.method === method && re.test(adminPath));
};

export const auth = CatchAsync(async (req, res, next) => {
  const header = req.header('Authorization');
  if (!header) throw new ApiError(401, 'Unauthorized', 'No token');

  const token = header.replace('Bearer ', '');
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.SECRET);
  } catch (err) {
    throw new ApiError(401, 'Unauthorized', 'Invalid or expired token');
  }

  if (decoded && (decoded.type === 'temporary_share_access' || decoded.type === 'utsav_report_share')) {
    // Verify that the shortlink has not been revoked via the toggle endpoint.
    // Backward-compatibility: if slug is embedded, verify active status in DB.
    const slug = decoded.slug;
    if (slug) {
      const link = await ShortLink.findOne({ where: { slug } });
      if (!link || !link.active) {
        throw new ApiError(401, 'This access link has been revoked');
      }
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

  if (!decoded || !decoded.user) throw new ApiError(401, 'Unauthorized', 'Invalid token');

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

  if (admin_roles.length > 0 && admin_roles.every((r) => r === ROLE_KIOSK_ADMIN)) {
    if (!isKioskRoute(req)) {
      throw new ApiError(403, 'Forbidden', 'Kiosk accounts cannot use this endpoint');
    }
    req.kioskRoute = true;
  }
  next();
});

export const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (req.kioskRoute) return next();
    const userRoles = req.roles || [];

    const isAuthorized = roles.some((role) => userRoles.includes(role));
    if (isAuthorized) {
      next();
    } else {
      throw new ApiError(401, 'Unauthorized');
    }
  };
};
