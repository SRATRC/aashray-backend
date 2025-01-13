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
    packageid: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'utsav_packages_db',
        key: 'id'
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
    status: {
      type: DataTypes.ENUM,
      allowNull: false,
      values: [STATUS_CONFIRMED, STATUS_CANCELLED, STATUS_WAITING]
    },
    updatedBy: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'USER'
    }
  },
  {
    tableName: 'utsav_guest_booking',
    timestamps: true
  }
);

export default UtsavGuestBooking;
