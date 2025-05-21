import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const RazorpayWebhook = sequelize.define(
  'RazorpayWebhook',
  {
    order_id: {
      type: DataTypes.STRING,
      allowNull: false,
      primaryKey: true
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
