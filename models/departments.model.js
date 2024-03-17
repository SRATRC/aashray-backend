import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const Departments = sequelize.define(
  'Departments',
  {
    dept_name: {
      type: DataTypes.STRING,
      allowNull: false,
      primaryKey: true
    },
    dept_head: {
      type: DataTypes.STRING,
      allowNull: false
    },
    dept_email: {
      type: DataTypes.STRING,
      allowNull: false
    },
    updatedBy: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'ADMIN'
    }
  },
  {
    tableName: 'departments',
    timestamps: true
  }
);

export default Departments;
