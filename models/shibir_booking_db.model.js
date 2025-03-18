import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import {
  STATUS_ADMIN_CANCELLED,
  STATUS_CANCELLED,
  STATUS_CONFIRMED,
  STATUS_PAYMENT_PENDING,
  STATUS_WAITING
} from '../config/constants.js';

const ShibirBookingDb = sequelize.define(
  'ShibirBookingDb',
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
    shibir_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'shibir_db',
        key: 'id'
      }
    },
    status: {
      type: DataTypes.ENUM,
      allowNull: true,
      values: [
        STATUS_WAITING,
        STATUS_CONFIRMED,
        STATUS_CANCELLED,
        STATUS_ADMIN_CANCELLED,
        STATUS_PAYMENT_PENDING
      ],
      defaultValue: STATUS_PAYMENT_PENDING
    },
    updatedBy: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'USER'
    }
  },
  {
    tableName: 'shibir_booking_db',
    timestamps: true
  }
);

export default ShibirBookingDb;
