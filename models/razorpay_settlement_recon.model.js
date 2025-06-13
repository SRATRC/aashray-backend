import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const RazorpaySettlementRecon = sequelize.define(
  'RazorpaySettlementRecon',
  {
    payment_id: {
      type: DataTypes.STRING,
      primaryKey: true,
      allowNull: false,
    },
    order_id: {
      type: DataTypes.STRING,
      primaryKey: true,
      allowNull: false,
    },
    amount: {
      type: DataTypes.FLOAT,
      allowNull: false
    },
    fees: {
      type: DataTypes.FLOAT,
      allowNull: false,
    },
    tax: {
      type: DataTypes.FLOAT,
      allowNull: true
    },
    credit_amount: {
      type: DataTypes.FLOAT,
      allowNull: false
    },
    payment_notes: {
      type: DataTypes.STRING,
      allowNull: true
    },
    settlement_id: {
      type: DataTypes.STRING,
      allowNull: false
    },
    settled_at: {
      type: DataTypes.DATE,
      allowNull: false
    },
    settlement_utr: {
      type: DataTypes.STRING,
      allowNull: false
    }
  },
  {
    tableName: 'razorpay_settlement_recon',
    timestamps: true
  }
);

export default RazorpaySettlementRecon ;
