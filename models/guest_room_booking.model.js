import { DataTypes } from 'sequelize';
import {
  ROOM_STATUS_CHECKEDIN,
  ROOM_STATUS_CHECKEDOUT,
  ROOM_STATUS_PENDING_CHECKIN,
  STATUS_ADMIN_CANCELLED,
  STATUS_CANCELLED,
  STATUS_WAITING
} from '../config/constants.js';
import sequelize from '../config/database.js';

const GuestRoomBooking = sequelize.define(
  'GuestRoomBooking',
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
    guest: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'guest_db',
        key: 'id'
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
        ROOM_STATUS_CHECKEDIN,
        STATUS_CANCELLED,
        STATUS_ADMIN_CANCELLED,
        STATUS_WAITING,
        ROOM_STATUS_CHECKEDOUT,
        ROOM_STATUS_PENDING_CHECKIN
      ]
    },
    gender: {
      type: DataTypes.ENUM,
      allowNull: false,
      values: ['M', 'F', 'SCM', 'SCF']
    },
    updatedBy: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'USER'
    }
  },
  {
    tableName: 'guest_room_booking',
    timestamps: true
  }
);

export default GuestRoomBooking;
