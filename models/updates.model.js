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
    // Lowest OS that can install this release. iOS: version ("16.4").
    // Android: API level ("26"), same unit as minSdkVersion.
    // NULL = installable by everyone.
    min_os: {
      type: DataTypes.STRING,
      allowNull: true
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
