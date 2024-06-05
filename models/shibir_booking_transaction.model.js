import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import {
  STATUS_PAYMENT_PENDING,
  STATUS_PAYMENT_COMPLETED,
  STATUS_CANCELLED,
  STATUS_AWAITING_REFUND,
  TYPE_EXPENSE,
  TYPE_REFUND,
  STATUS_ADMIN_CANCELLED
} from '../config/constants.js';

const ShibirBookingTransaction = sequelize.define(
  'ShibirBookingTransaction',
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
        model: 'shibir_booking_db',
        key: 'bookingid'
      }
    },
    type: {
      type: DataTypes.ENUM,
      allowNull: false,
      values: [TYPE_EXPENSE, TYPE_REFUND]
    },
    amount: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    discount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    upi_ref: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'NA'
    },
    description: {
      type: DataTypes.STRING,
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM,
      allowNull: false,
      values: [
        STATUS_PAYMENT_PENDING,
        STATUS_PAYMENT_COMPLETED,
        STATUS_CANCELLED,
        STATUS_AWAITING_REFUND,
        STATUS_ADMIN_CANCELLED
      ]
    },
    updatedBy: {
      type: DataTypes.STRING,
      allowNull: false
    }
  },
  {
    tableName: 'shibir_booking_transaction',
    timestamps: true
  }
);

export default ShibirBookingTransaction;
