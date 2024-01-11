import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import {
  STATUS_CONFIRMED,
  STATUS_CANCELLED,
  STATUS_WAITING
} from '../config/constants.js';

const UtsavBooking = sequelize.define(
  'UtsavBooking',
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
    status: {
      type: DataTypes.ENUM,
      allowNull: true,
      values: [STATUS_CONFIRMED, STATUS_CANCELLED, STATUS_WAITING]
    }
  },
  {
    tableName: 'utsav_booking',
    timestamps: true
  }
);

export default UtsavBooking;
