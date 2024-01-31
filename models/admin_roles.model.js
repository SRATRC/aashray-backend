import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

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
    }
  },
  {
    tableName: 'admin_roles',
    timestamps: true
  }
);

export default AdminRoles;
