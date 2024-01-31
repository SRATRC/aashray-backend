import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const Roles = sequelize.define(
  'Roles',
  {
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      primaryKey: true
    }
  },
  {
    tableName: 'roles',
    timestamps: true
  }
);

export default Roles;
