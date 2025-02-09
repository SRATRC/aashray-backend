import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import {
  ROOM_STATUS_CHECKEDIN,
  ROOM_STATUS_CHECKEDOUT,
  ROOM_STATUS_PENDING_CHECKIN,
  STATUS_ADMIN_CANCELLED,
  STATUS_CANCELLED,
  STATUS_WAITING
} from '../config/constants.js';

const FlatBooking = sequelize.define(
  'FlatBooking',
  {
    bookingid: {
      type: DataTypes.STRING,
      allowNull: false,
      primaryKey: true
    },
    cardno: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: 'card_db',
        key: 'cardno'
      }
    },
    flatno: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'flatdb',
        key: 'flatno'
      }
    },
    checkin: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    checkout: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    nights: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    updatedBy: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'USER'
    },
    guest :{
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'guest_db',
        key: 'id'
      }
    },
    status: {
      type: DataTypes.ENUM,
      allowNull: false,
      values: [
        ROOM_STATUS_CHECKEDIN,
        STATUS_CANCELLED,
        STATUS_ADMIN_CANCELLED,
        STATUS_WAITING,
        ROOM_STATUS_CHECKEDOUT,
        ROOM_STATUS_PENDING_CHECKIN
      ]
    },
  },
  {
    tableName: 'flat_booking',
    timestamps: true
  }
);

export default FlatBooking;
