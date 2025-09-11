import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const Updates = sequelize.define(
  'updates',
  {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true
    },
    os: {
      type: DataTypes.ENUM('android', 'ios'),
      allowNull: false
    },
    version: {
      type: DataTypes.STRING,
      allowNull: false
    },
    mandatory: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    releaseNotes: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  },
  {
    tableName: 'updates',
    timestamps: true
  }
);

export default Updates;
