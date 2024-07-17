import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const Menu = sequelize.define(
  'Menu',
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      allowNull: false,
      primaryKey: true
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      unique: true
    },
    breakfast: {
      type: DataTypes.STRING,
      allowNull: false
    },
    lunch: {
      type: DataTypes.STRING,
      allowNull: false
    },
    dinner: {
      type: DataTypes.STRING,
      allowNull: false
    },
    updatedBy: {
      type: DataTypes.STRING,
      allowNull: false
    }
  },
  {
    tableName: 'menu',
    timestamps: true
  }
);

export default Menu;
