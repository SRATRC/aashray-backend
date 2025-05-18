import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const RazorpaySettlement = sequelize.define(
  'Settlement',
  {
    id: {
      type: DataTypes.STRING,
      primaryKey: true,
      allowNull: false,
    },
    amount: {
      type: DataTypes.FLOAT,
      allowNull: false
    },
    status: {
      type: DataTypes.STRING,
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
    utr: {
      type: DataTypes.STRING,
      allowNull: true
    },
    cerated_at: {
      type: DataTypes.DATE,
      allowNull: false,
    }
  },
  {
    tableName: 'razorpay_settlement',
    timestamps: true
  }
);

export default RazorpaySettlement ;
