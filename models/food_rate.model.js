import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const FoodRate = sequelize.define(
  'FoodRate',
  {
    mealtype: {
      type: DataTypes.STRING,
      allowNull: false
    },
    rate: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    updatedBy: {
      type: DataTypes.STRING,
      allowNull: false
    }
  },
  {
    tableName: 'foodrate',
    timestamps: true
  }
);

export default FoodRate;
