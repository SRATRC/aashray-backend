import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import {
  STATUS_CONFIRMED,
  STATUS_CANCELLED,
  STATUS_WAITING
} from '../config/constants.js';

const UtsavGuestBooking = sequelize.define(
  'UtsavGuestBooking',
  {
    bookingid: {
      type: DataTypes.STRING,
      allowNull: false,
      primaryKey: true
    },
    utsavid: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'utsav_db',
        key: 'id'
      }
    },
    cardno: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: 'card_db',
        key: 'cardno'
      }
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    gender: {
      type: DataTypes.ENUM,
      allowNull: false,
      values: ['M', 'F']
    },
    age: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    mobno: {
      type: DataTypes.BIGINT,
      allowNull: false
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM,
      allowNull: false,
      values: [STATUS_CONFIRMED, STATUS_CANCELLED, STATUS_WAITING]
    }
  },
  {
    tableName: 'utsav_guest_booking',
    timestamps: true
  }
);

export default UtsavGuestBooking;
