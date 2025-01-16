import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

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
    }
  },
  {
    tableName: 'flat_booking',
    timestamps: true
  }
);

export default FlatBooking;
