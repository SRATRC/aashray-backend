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
    payment_id: {
      type: DataTypes.STRING,
      allowNull: false,
      index: true
    },
    order_id: {
      type: DataTypes.STRING,
      allowNull: false
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false
    },

    json: {
      type: DataTypes.JSON,
      allowNull: false
    }
  },
  {
    tableName: 'razorpay_webhook',
    timestamps: true,
    indexes: [
      {
        fields: ['payment_id']
      }
    ]
  }
);

export default RazorpayWebhook;
