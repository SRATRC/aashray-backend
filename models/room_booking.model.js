import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

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
    roomno: {
      type: DataTypes.STRING,
      allowNull: true,
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
      values: ['ac', 'nac']
    },
    status: {
      type: DataTypes.ENUM,
      allowNull: false,
      values: [
        'checkedout',
        'cancelled',
        'waiting',
        'checkedin',
        'pending checkin'
      ]
    },
    gender: {
      type: DataTypes.ENUM,
      allowNull: false,
      values: ['M', 'F', 'SCM', 'SCF']
    }
  },
  {
    tableName: 'room_booking',
    timestamps: true
  }
);

export default RoomBooking;
