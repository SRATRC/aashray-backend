import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const GuestDb = sequelize.define(
  'GuestDb',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    cardno: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: 'card_db',
        key: 'cardno'
      }
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    type: {
      type: DataTypes.STRING,
      allowNull: false
    },
    mobno: {
      type: DataTypes.STRING,
      allowNull: true
    },
    gender: {
      type: DataTypes.ENUM,
      allowNull: false,
      values: ['M', 'F']
    },
    updatedBy: {
      type: DataTypes.STRING,
      allowNull: false
    }
  },
  {
    tableName: 'guest_db',
    timestamps: true
  }
);

export default GuestDb;
