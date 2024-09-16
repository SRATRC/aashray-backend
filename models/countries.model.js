import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const Countries = sequelize.define(
  'Countries',
  {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    }
  },
  {
    tableName: 'countries',
    timestamps: true
  }
);

export default Countries;
