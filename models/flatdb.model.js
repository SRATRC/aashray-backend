import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const FlatDb = sequelize.define(
  'FlatDb',
  {
    flatno: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    owner: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: 'card_db',
        key: 'cardno'
      }
    },
    updatedBy: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'ADMIN'
    }
  },
  {
    tableName: 'flatdb',
    timestamps: false
  }
);

export default FlatDb;
