import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

// Last-seen device facts, captured from the compatibility headers on normal
// traffic. Lets us size how many users a release would orphan before shipping.
// See docs/version-os-compatibility.md.
const DeviceTelemetry = sequelize.define(
  'device_telemetry',
  {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true
    },
    cardno: {
      type: DataTypes.STRING,
      allowNull: true
    },
    platform: {
      type: DataTypes.ENUM('android', 'ios'),
      allowNull: false
    },
    app_build: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    os_version: {
      type: DataTypes.STRING,
      allowNull: true
    }
  },
  {
    tableName: 'device_telemetry',
    timestamps: true,
    indexes: [
      // One row per (user, platform); upserted on each seen request.
      { unique: true, fields: ['cardno', 'platform'] },
      { fields: ['platform', 'os_version'] }
    ]
  }
);

export default DeviceTelemetry;
