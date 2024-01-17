import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

/* DEPRECATED TABLE */

const TransactionDb = sequelize.define(
  'TransactionDb',
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
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    type: {
      type: DataTypes.STRING,
      allowNull: false,
      values: ['expense', 'refund']
    },
    detail: {
      type: DataTypes.STRING,
      allowNull: false
    },
    amount: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM,
      allowNull: true,
      values: [
        'payment pending',
        'payment completed',
        'partially paid',
        'waiting',
        'admin canceled'
      ],
      defaultValue: 'payment pending'
    }
  },
  {
    tableName: 'transaction_db',
    timestamps: true
  }
);

export default TransactionDb;
