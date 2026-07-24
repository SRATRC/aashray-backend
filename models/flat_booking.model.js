import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import {
  ROOM_STATUS_CHECKEDIN,
  ROOM_STATUS_CHECKEDOUT,
  ROOM_STATUS_PENDING_CHECKIN,
  STATUS_ADMIN_CANCELLED,
  STATUS_CANCELLED,
  STATUS_PAYMENT_PENDING,
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
    bookedBy: {
      type: DataTypes.STRING,
      allowNull: true,
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
    status: {
      type: DataTypes.ENUM,
      allowNull: false,
      values: [
        STATUS_WAITING,
        STATUS_PAYMENT_PENDING,
        ROOM_STATUS_PENDING_CHECKIN,
        ROOM_STATUS_CHECKEDIN,
        ROOM_STATUS_CHECKEDOUT,
        STATUS_CANCELLED,
        STATUS_ADMIN_CANCELLED
      ]
    },
    // Why the booking is held (only meaningful while status is `waiting`).
    // Machine-readable code from HOLD_REASON in config/constants.js.
    hold_reason: {
      type: DataTypes.STRING,
      allowNull: true
    },
    // Optional structured detail for the reason, e.g. { usedNights, limit }.
    hold_reason_meta: {
      type: DataTypes.JSON,
      allowNull: true
    }
  },
  {
    tableName: 'flat_booking',
    timestamps: true
  }
);

export default FlatBooking;
