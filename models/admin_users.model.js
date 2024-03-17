import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import { STATUS_ACTIVE, STATUS_INACTIVE } from '../config/constants.js';

const AdminUsers = sequelize.define(
  'AdminUsers',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    username: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: false
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM,
      allowNull: true,
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
    tableName: 'admin_users',
    timestamps: true
  }
);

export default AdminUsers;
