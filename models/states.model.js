import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import Countries from './countries.model.js';

const States = sequelize.define(
  'States',
  {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true
    },
    country_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: Countries,
        key: 'id'
      }
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    }
  },
  {
    tableName: 'states',
    timestamps: true
  }
);

export default States;
