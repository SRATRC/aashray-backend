import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const FoodDb = sequelize.define(
  'FoodDb',
  {
    cardno: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: 'card_db',
        key: 'cardno'
      }
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    breakfast: {
      type: DataTypes.BOOLEAN,
      allowNull: false
    },
    breakfast_plate_issued: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: 0
    },
    lunch: {
      type: DataTypes.BOOLEAN,
      allowNull: false
    },
    lunch_plate_issued: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: 0
    },
    dinner: {
      type: DataTypes.BOOLEAN,
      allowNull: false
    },
    dinner_plate_issued: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: 0
    },
    hightea: {
      type: DataTypes.ENUM,
      allowNull: false,
      defaultValue: 'NONE',
      values: ['TEA', 'COFFEE', 'NONE']
    },
    spicy: {
      type: DataTypes.BOOLEAN,
      allowNull: false
    },
    updatedBy: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'USER'
    }
  },
  {
    tableName: 'food_db',
    timestamps: true
  }
);

export default FoodDb;
