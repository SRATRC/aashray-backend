import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

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
      values: ['ac', 'nac']
    },
    gender: {
      type: DataTypes.ENUM,
      allowNull: false,
      values: ['M', 'F', 'SCM', 'SCF']
    },
    type: {
      type: DataTypes.ENUM,
      allowNull: false,
      values: ['room', 'flat']
    },
    roomstatus: {
      type: DataTypes.ENUM,
      allowNull: false,
      values: ['available', 'blocked']
    }
  },
  {
    tableName: 'roomdb',
    timestamps: false
  }
);

export default RoomDb;
