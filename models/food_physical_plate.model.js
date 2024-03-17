import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const FoodPhysicalPlate = sequelize.define(
  'FoodPhysicalPlate',
  {
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      primaryKey: true
    },
    type: {
      type: DataTypes.ENUM,
      allowNull: false,
      values: ['breakfast', 'lunch', 'dinner'],
      primaryKey: true
    },
    count: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    updatedBy: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'USER'
    }
  },
  {
    tableName: 'food_physical_plate',
    timestamps: true
  }
);

export default FoodPhysicalPlate;
