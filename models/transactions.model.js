import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import {
  STATUS_PAYMENT_PENDING,
  STATUS_PAYMENT_COMPLETED,
  STATUS_CASH_PENDING,
  STATUS_CASH_COMPLETED,
  STATUS_CANCELLED,
  STATUS_ADMIN_CANCELLED,
  STATUS_CREDITED
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
    razorpay_payment_id: {
      type: DataTypes.STRING,
      allowNull: true
    },
    razorpay_fee: {
      type: DataTypes.FLOAT,
      allowNull: false
    },
    razorpay_tax: {
      type: DataTypes.FLOAT,
      allowNull: false
    },
    razorpay_credit_amt: {
      type: DataTypes.FLOAT,
      allowNull: false
    },
    payment_method: {
      type: DataTypes.STRING,
      allowNull: false
    },
    razorpay_settlement_id: {
      type: DataTypes.STRING,
      allowNull: true
    },
    razorpay_settled_at: {
      type: DataTypes.STRING,
      allowNull: true
    },
    settlement_utr: {
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
        STATUS_CASH_PENDING,
        STATUS_CASH_COMPLETED,
        STATUS_CANCELLED,
        STATUS_ADMIN_CANCELLED,
        STATUS_CREDITED
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
