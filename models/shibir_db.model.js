import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import {
  RESEARCH_CENTRE,
  STATUS_CLOSED,
  STATUS_OPEN,
  STATUS_DELETED
} from '../config/constants.js';

const ShibirDb = sequelize.define(
  'ShibirDb',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    speaker: {
      type: DataTypes.STRING,
      allowNull: false
    },
    month: {
      type: DataTypes.STRING,
      allowNull: false
    },
    start_date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    end_date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    location: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: RESEARCH_CENTRE
    },
    total_seats: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    available_seats: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    food_allowed: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: 0
    },
    amount: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    comments: {
      type: DataTypes.STRING,
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM,
      allowNull: true,
      values: [STATUS_OPEN, STATUS_CLOSED, STATUS_DELETED],
      defaultValue: STATUS_OPEN
    }, 
    updatedBy: {
      type: DataTypes.STRING,
      allowNull: false
    },
    whatsapp_group_jid: {
      type: DataTypes.STRING(255),
      allowNull: true
    }
  },
  {
    tableName: 'shibir_db',
    timestamps: true
  }
);

export default ShibirDb;
