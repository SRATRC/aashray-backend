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
    lunch: {
      type: DataTypes.BOOLEAN,
      allowNull: false
    },
    dinner: {
      type: DataTypes.BOOLEAN,
      allowNull: false
    },
    hightea: {
      type: DataTypes.BOOLEAN,
      allowNull: false
    },
    spicy: {
      type: DataTypes.BOOLEAN,
      allowNull: false
    },
    plateissued: {
      type: DataTypes.BOOLEAN,
      allowNull: false
    }
  },
  {
    tableName: 'food_db',
    timestamps: true
  }
);

export default FoodDb;
