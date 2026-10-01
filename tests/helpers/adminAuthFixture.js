import jwt from 'jsonwebtoken';
import { AdminUsers, AdminRoles, Roles } from '../../models/associations.js';
import { STATUS_ACTIVE, ROLE_ROOM_ADMIN } from '../../config/constants.js';

// Shared admin-auth test fixture: truncates Roles/AdminUsers/AdminRoles, creates
// a room-admin user, and returns a signed-JWT auth header ready for
// `.set(ADMIN_AUTH)` on a supertest request. Used by admin controller tests
// that need a valid authenticated admin (the admin routes require auth).
export async function createAdminAuth(sequelize, username = 'test_room_admin') {
  await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
  await AdminRoles.truncate();
  await AdminUsers.truncate();
  await Roles.truncate();
  await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');

  const role = await Roles.create({
    name: ROLE_ROOM_ADMIN,
    status: STATUS_ACTIVE,
    updatedBy: 'test'
  });
  const adminUser = await AdminUsers.create({
    username,
    password: 'x', // NOT NULL; never validated by the auth middleware
    status: STATUS_ACTIVE
  });
  await AdminRoles.create({
    user_id: adminUser.id,
    role_name: role.name,
    status: STATUS_ACTIVE,
    updatedBy: 'test'
  });
  const token = jwt.sign(
    { user: { id: adminUser.id, username: adminUser.username } },
    process.env.SECRET
  );
  return { Authorization: `Bearer ${token}` };
}
