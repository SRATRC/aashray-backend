import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const BlockDates = sequelize.define(
  'BlockDates',
  {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true
    },
    checkin: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    checkout: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    comments: {
      type: DataTypes.STRING,
      allowNull: false
    }
  },
  {
    tableName: 'blockdates',
    timestamps: true
  }
);

export default BlockDates;
