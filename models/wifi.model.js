import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const WifiPwd = sequelize.define(
  'WifiPwd',
  {
    pwd_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true
    },
    cardno: {
      type: DataTypes.STRING,
      allowNull: true,
      references: {
        model: 'card_db',
        key: 'cardno'
      }
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false
    },
    roombookingid: {
      type: DataTypes.STRING,
      allowNull: true,
      references: {
        model: 'room_booking',
        key: 'bookingid'
      }
    },
    status: {
      type: DataTypes.ENUM,
      allowNull: false,
      values: ['active', 'inactive'],
      defaultValue: 'active'
    },
    updatedBy: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'ADMIN'
    }
  },
  {
    tableName: 'wifi_pwd',
    timestamps: true
  }
);

export default WifiPwd;
