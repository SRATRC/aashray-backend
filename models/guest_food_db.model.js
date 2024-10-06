import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const GuestFoodDb = sequelize.define(
  'GuestFoodDb',
  {
    bookingid: {
      type: DataTypes.STRING,
      allowNull: false,
      primaryKey: true
    },
    cardno: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: 'card_db',
        key: 'cardno'
      }
    },
    guest: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'guest_db',
        key: 'id'
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
      type: DataTypes.ENUM,
      allowNull: false,
      values: ['TEA', 'COFFEE', 'NONE']
    },
    spicy: {
      type: DataTypes.BOOLEAN,
      allowNull: false
    },
    updatedBy: {
      type: DataTypes.STRING,
      allowNull: false
    }
  },
  {
    tableName: 'guest_food_db',
    timestamps: true
  }
);

export default GuestFoodDb;
