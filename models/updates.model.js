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
    // Monotonic, store-aligned build (Android versionCode / iOS build number).
    // Primary comparison key for the OS-ladder decision.
    build_number: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    // OS floor required to install this build, as a marketing version string
    // ("13", "16.0"). NULL = no floor / installable by everyone.
    min_os: {
      type: DataTypes.STRING,
      allowNull: true
    },
    // Severity of this release. 'required' forces eligible devices; 'optional'
    // is a soft prompt. Source of truth for the decision (supersedes `mandatory`).
    tier: {
      type: DataTypes.ENUM('optional', 'required'),
      allowNull: false,
      defaultValue: 'optional'
    },
    // Deprecated: retained for legacy clients. Derived from `tier`.
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
