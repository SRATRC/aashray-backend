import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const SupportTickets = sequelize.define(
  'SupportTickets',
  {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
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
    issue: {
      type: DataTypes.TEXT,
      allowNull: false
    }
  },
  {
    tableName: 'support_tickets',
    timestamps: true
  }
);

export default SupportTickets;
