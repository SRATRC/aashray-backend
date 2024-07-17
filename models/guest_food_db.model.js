import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const GuestFoodDb = sequelize.define(
  'GuestFoodDb',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    bookingid: {
      type: DataTypes.STRING,
      allowNull: false
    },
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
    guest_count: {
      type: DataTypes.INTEGER,
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
