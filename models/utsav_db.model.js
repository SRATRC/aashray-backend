import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import {
  RESEARCH_CENTRE,
  STATUS_CLOSED,
  STATUS_OPEN
} from '../config/constants.js';

const UtsavDb = sequelize.define(
  'UtsavDb',
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
    start_date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    end_date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    month: {
      type: DataTypes.STRING,
      allowNull: false
    },
    total_seats: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    available_seats: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    location: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: RESEARCH_CENTRE
    },
    comments: {
      type: DataTypes.STRING,
      allowNull: true
    },
    whatsapp_link: {
      type: DataTypes.STRING,
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM,
      allowNull: true,
      values: [STATUS_OPEN, STATUS_CLOSED],
      defaultValue: STATUS_OPEN
    },
    registration_deadline: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment:
        'Registration deadline date - users can only see and register for utsavs before or on this date'
    },
    starting_meal: {
      type: DataTypes.JSON,
      allowNull: true
    },
    ending_meal: {
      type: DataTypes.JSON,
      allowNull: true
    }
  },
  {
    tableName: 'utsav_db',
    timestamps: true
  }
);

export default UtsavDb;
