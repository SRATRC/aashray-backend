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

const RoomBooking = sequelize.define(
  'RoomBooking',
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
    bookedBy: {
      type: DataTypes.STRING,
      allowNull: true,
      references: {
        model: 'card_db',
        key: 'cardno'
      }
    },
    roomno: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: 'roomdb',
        key: 'roomno'
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
    roomtype: {
      type: DataTypes.ENUM,
      allowNull: false,
      values: ['ac', 'nac', 'NA']
    },
    status: {
      type: DataTypes.ENUM,
      allowNull: false,
      values: [
        STATUS_WAITING,
        ROOM_STATUS_PENDING_CHECKIN,
        ROOM_STATUS_CHECKEDIN,
        ROOM_STATUS_CHECKEDOUT,
        STATUS_CANCELLED,
        STATUS_ADMIN_CANCELLED
      ]
    },
    gender: {
      type: DataTypes.ENUM,
      allowNull: false,
      values: ['M', 'F', 'SCM', 'SCF', 'NA']
    },
    updatedBy: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'USER'
    }
  },
  {
    tableName: 'room_booking',
    timestamps: true
  }
);

export default RoomBooking;
