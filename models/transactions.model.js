import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import {
  STATUS_PAYMENT_PENDING,
  STATUS_PAYMENT_COMPLETED,
  STATUS_CASH_PENDING,
  STATUS_CASH_COMPLETED,
  STATUS_CANCELLED,
  STATUS_ADMIN_CANCELLED,
  STATUS_CREDITED,
  STATUS_PAYMENT_CAPTURED,
  STATUS_PAYMENT_AUTHORIZED,
  STATUS_PAYMENT_FAILED
} from '../config/constants.js';

const Transactions = sequelize.define(
  'Transactions',
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
      allowNull: false
    },
    category: {
      type: DataTypes.STRING,
      allowNull: false
    },
    amount: {
      type: DataTypes.DECIMAL,
      allowNull: false
    },
    discount: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      defaultValue: 0
    },
    razorpay_order_id: {
      type: DataTypes.STRING,
      allowNull: true
    },
    description: {
      type: DataTypes.STRING,
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM,
      allowNull: false,
      values: [
        // TODO: remove cash completed and payment completed status
        STATUS_PAYMENT_PENDING,
        STATUS_PAYMENT_COMPLETED,
        STATUS_CASH_PENDING,
        STATUS_CASH_COMPLETED,
        STATUS_CANCELLED,
        STATUS_ADMIN_CANCELLED,
        STATUS_CREDITED,
        STATUS_PAYMENT_AUTHORIZED,
        STATUS_PAYMENT_CAPTURED,
        STATUS_PAYMENT_FAILED
      ]
    },
    updatedBy: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'USER'
    }
  },
  {
    tableName: 'transactions',
    timestamps: true
  }
);

export default Transactions;
