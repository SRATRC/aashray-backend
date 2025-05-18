import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const RazorpayWebhook = sequelize.define(
  'RazorpayWebhook',
  {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true
    },
    json: {
      type: DataTypes.JSON,
      allowNull: false
    }
  },
  {
    tableName: 'razorpay_webhook',
    timestamps: true
  }
);

export default RazorpayWebhook;
