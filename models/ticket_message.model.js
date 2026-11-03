import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const TicketMessage = sequelize.define(
  'TicketMessage',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    ticket_id: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: 'tickets',
        key: 'id'
      }
    },
    sender_id: {
      type: DataTypes.STRING,
      allowNull: false
    },
    sender_type: {
      type: DataTypes.ENUM,
      values: ['user', 'admin'],
      allowNull: false
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false
    }
  },
  {
    tableName: 'ticket_messages',
    timestamps: true
  }
);

export default TicketMessage;
