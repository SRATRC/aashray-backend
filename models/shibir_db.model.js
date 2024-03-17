import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

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
    start_date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    end_date: {
      type: DataTypes.DATEONLY,
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
    comments: {
      type: DataTypes.STRING,
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM,
      allowNull: true,
      values: ['open', 'closed'],
      defaultValue: 'open'
    },
    updatedBy: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'ADMIN'
    }
  },
  {
    tableName: 'shibir_db',
    timestamps: true
  }
);

export default ShibirDb;
