import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import {
  STATUS_PAYMENT_PENDING,
  STATUS_PAYMENT_COMPLETED,
  STATUS_CANCELLED,
  STATUS_AWAITING_REFUND,
  TYPE_EXPENSE,
  TYPE_REFUND
} from '../config/constants.js';

const UtsavBookingTransaction = sequelize.define(
  'UtsavBookingTransaction',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    cardno: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: 'card_db',
        key: 'cardno'
      }
    },
    bookingid: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: 'utsav_booking',
        key: 'bookingid'
      }
    },
    type: {
      type: DataTypes.STRING,
      allowNull: false,
      values: [TYPE_EXPENSE, TYPE_REFUND]
    },
    amount: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    description: {
      type: DataTypes.STRING,
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM,
      allowNull: false,
      values: [
        STATUS_PAYMENT_PENDING,
        STATUS_PAYMENT_COMPLETED,
        STATUS_CANCELLED,
        STATUS_AWAITING_REFUND
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
    tableName: 'utsav_booking_transaction',
    timestamps: true
  }
);

export default UtsavBookingTransaction;
