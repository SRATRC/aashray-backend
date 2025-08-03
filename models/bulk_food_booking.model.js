import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const BulkFoodBooking = sequelize.define(
  'BulkFoodBooking',
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
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    guestCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    breakfast: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    lunch: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    dinner: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    breakfast_plate_issued: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    lunch_plate_issued: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    dinner_plate_issued: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    department: {
      type: DataTypes.STRING,
      allowNull: false,
      values: [
        'RC', 
        'SREC', 
        'SRMC',
        'Smilestones',
        'Sanisa',
        'Events-Guest',
        'Personal'
      ],
    },
    updatedBy: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'USER'
    }
  },
  {
    tableName: 'bulk_food_booking',
    timestamps: true
  }
);

export default BulkFoodBooking;
