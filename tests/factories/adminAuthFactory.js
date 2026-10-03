import jwt from 'jsonwebtoken';
import { STATUS_ACTIVE } from '../../config/constants.js';
import { AdminRoles, AdminUsers, Roles } from '../../models/associations.js';

/**
 * Creates a staff user holding the given roles and returns the
 * Authorization header the admin routes expect.
 */
export async function createAdminAuth(username, roleNames) {
  const user = await AdminUsers.create({
    username,
    password: 'x', // NOT NULL; never validated by the auth middleware
    status: STATUS_ACTIVE
  });
  for (const name of roleNames) {
    const [role] = await Roles.findOrCreate({
      where: { name },
      defaults: { name, status: STATUS_ACTIVE, updatedBy: 'test' }
    });
    await AdminRoles.create({
      user_id: user.id,
      role_name: role.name,
      status: STATUS_ACTIVE,
      updatedBy: 'test'
    });
  }
  const token = jwt.sign(
    { user: { id: user.id, username: user.username } },
    process.env.SECRET
  );
  return { Authorization: `Bearer ${token}` };
}
