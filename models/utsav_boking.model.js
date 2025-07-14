import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import {
  STATUS_CONFIRMED,
  STATUS_CANCELLED,
  STATUS_PAYMENT_PENDING,
  STATUS_WAITING,
  STATUS_ADMIN_CANCELLED,
  STATUS_CASH_COMPLETED,
  STATUS_CASH_PENDING,
  ROOM_STATUS_CHECKEDIN
} from '../config/constants.js';

const UtsavBooking = sequelize.define(
  'UtsavBooking',
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
    bookedBy: {
      type: DataTypes.STRING,
      allowNull: true,
      references: {
        model: 'card_db',
        key: 'cardno'
      }
    },
    utsavid: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'utsav_db',
        key: 'id'
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
    arrival: {
      type: DataTypes.STRING,
      allowNull: false
    },
    carno: {
      type: DataTypes.STRING,
      allowNull: true
    },
    volunteer: {
      type: DataTypes.STRING,
      allowNull: true
    },
    other: {
      type: DataTypes.STRING,
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM,
      allowNull: true,
      values: [
        STATUS_CONFIRMED,
        STATUS_CANCELLED,
        STATUS_PAYMENT_PENDING,
        STATUS_WAITING,
        STATUS_ADMIN_CANCELLED,
        STATUS_CASH_COMPLETED,
        STATUS_CASH_PENDING,
        ROOM_STATUS_CHECKEDIN
      ]
    },
    updatedBy: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'USER'
    }
  },
  {
    tableName: 'utsav_booking',
    timestamps: true
  }
);

export default UtsavBooking;
