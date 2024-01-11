import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

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
    description: {
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
    amount: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    additional_info: {
      type: DataTypes.STRING,
      allowNull: true
    }
  },
  {
    tableName: 'utsav_db',
    timestamps: true
  }
);

export default UtsavDb;
