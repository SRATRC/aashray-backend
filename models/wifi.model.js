import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import { STATUS_ACTIVE, STATUS_INACTIVE } from '../config/constants.js';

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
      values: [STATUS_ACTIVE, STATUS_INACTIVE],
      defaultValue: STATUS_ACTIVE
    },
    updatedBy: {
      type: DataTypes.STRING,
      allowNull: false
    }
  },
  {
    tableName: 'wifi_pwd',
    timestamps: true
  }
);

export default WifiPwd;
