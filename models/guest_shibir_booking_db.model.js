import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import {
  STATUS_ADMIN_CANCELLED,
  STATUS_CANCELLED,
  STATUS_CONFIRMED,
  STATUS_PAYMENT_PENDING,
  STATUS_WAITING
} from '../config/constants.js';

const ShibirGuestBookingDb = sequelize.define(
  'ShibirGuestBookingDb',
  {
    bookingid: {
      type: DataTypes.STRING,
      allowNull: false,
      primaryKey: true
    },
    shibir_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'shibir_db',
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
    tableName: 'guest_shibir_booking',
    timestamps: true
  }
);

export default ShibirGuestBookingDb;
