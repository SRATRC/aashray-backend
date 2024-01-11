import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import {
  STATUS_PAYMENT_PENDING,
  STATUS_PAYMENT_COMPLETED,
  STATUS_CANCELLED,
  STATUS_AWAITING_REFUND
} from '../config/constants.js';

const RoomBookingTransaction = sequelize.define(
  'RoomBookingTransaction',
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
        model: 'room_booking',
        key: 'bookingid'
      }
    },
    type: {
      type: DataTypes.STRING,
      allowNull: false,
      values: ['expense', 'refund']
    },
    amount: {
      type: DataTypes.INTEGER,
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
    }
  },
  {
    tableName: 'room_booking_transaction',
    timestamps: true
  }
);

export default RoomBookingTransaction;
