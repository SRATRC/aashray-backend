import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import { ROOM_BLOCKED, ROOM_STATUS_AVAILABLE } from '../config/constants.js';

const RoomDb = sequelize.define(
  'RoomDb',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    roomno: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    roomtype: {
      type: DataTypes.ENUM,
      allowNull: false,
      values: ['ac', 'nac', 'NA']
    },
    gender: {
      type: DataTypes.ENUM,
      allowNull: false,
      values: ['M', 'F', 'SCM', 'SCF', 'NA']
    },
    roomstatus: {
      type: DataTypes.ENUM,
      allowNull: false,
      values: [ROOM_STATUS_AVAILABLE, ROOM_BLOCKED]
    },
    updatedBy: {
      type: DataTypes.STRING,
      allowNull: false
    }
  },
  {
    tableName: 'roomdb',
    timestamps: false
  }
);

export default RoomDb;
