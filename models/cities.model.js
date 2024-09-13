import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import States from './states.model.js';

const Cities = sequelize.define(
  'Cities',
  {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true
    },
    state_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: States,
        key: 'id'
      }
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    }
  },
  {
    tableName: 'cities',
    timestamps: true
  }
);

export default Cities;
