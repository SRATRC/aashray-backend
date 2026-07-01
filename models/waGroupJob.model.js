import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const WaGroupJob = sequelize.define(
  'WaGroupJob',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false
    },
    action: {
      type: DataTypes.ENUM('create_group', 'add_member', 'remove_member', 'send_message', 'send_poll', 'fetch_members', 'update_group_settings'),
      allowNull: false
    },
    phone: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    groupJid: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM('pending', 'processing', 'success', 'failed'),
      defaultValue: 'pending',
      allowNull: false
    },
    attempts: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: false
    },
    error: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    payload: {
      type: DataTypes.JSON,
      allowNull: true
    },
    scheduledAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    priority: {
      type: DataTypes.ENUM('high', 'normal', 'low'),
      defaultValue: 'normal',
      allowNull: false
    },
    msgId: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    deliveredCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: false
    },
    readCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: false
    },
    receipts: {
      type: DataTypes.JSON,
      allowNull: true
    }
  },
  {
    tableName: 'wa_group_jobs',
    timestamps: true
  }
);

export default WaGroupJob;
