import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import {
  STATUS_OPEN,
  STATUS_CLOSED,
  STATUS_INPROGRESS
} from '../config/constants.js';

const Ticket = sequelize.define(
  'Ticket',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    issued_by: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: 'card_db',
        key: 'cardno'
      }
    },
    service: {
      type: DataTypes.STRING,
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    os: {
      type: DataTypes.ENUM,
      values: ['Android', 'iOS', 'Web', 'Other'],
      allowNull: true
    },
    app_version: {
      type: DataTypes.STRING,
      allowNull: true
    },
    admin_comments: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM,
      values: [STATUS_OPEN, STATUS_INPROGRESS, 'resolved', STATUS_CLOSED],
      defaultValue: STATUS_OPEN,
      allowNull: false
    },
    updatedBy: {
      type: DataTypes.STRING,
      allowNull: true
    }
  },
  {
    tableName: 'tickets',
    timestamps: true
  }
);

export default Ticket;
