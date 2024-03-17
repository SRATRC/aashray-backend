import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import { STATUS_ACTIVE, STATUS_INACTIVE } from '../config/constants.js';

const AdminRoles = sequelize.define(
  'AdminRoles',
  {
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      references: {
        model: 'admin_users',
        key: 'id'
      }
    },
    role_name: {
      type: DataTypes.STRING,
      allowNull: false,
      primaryKey: true,
      references: {
        model: 'roles',
        key: 'name'
      }
    },
    status: {
      type: DataTypes.ENUM,
      allowNull: false,
      values: [STATUS_ACTIVE, STATUS_INACTIVE],
      defaultValue: STATUS_ACTIVE
    },
    updatedBy: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'SUPER ADMIN'
    }
  },
  {
    tableName: 'admin_roles',
    timestamps: true
  }
);

export default AdminRoles;
