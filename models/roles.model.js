import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import { STATUS_ACTIVE, STATUS_INACTIVE } from '../config/constants.js';

const Roles = sequelize.define(
  'Roles',
  {
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      primaryKey: true
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
      defaultValue: 'ADMIN'
    }
  },
  {
    tableName: 'roles',
    timestamps: true
  }
);

export default Roles;
