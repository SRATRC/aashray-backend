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
      primaryKey: true,
      references: {
        model: 'card_db',
        key: 'cardno'
      }
    },
    updatedBy: {
      type: DataTypes.STRING,
      allowNull: false
    },
    last_deep_cleaning: {
      type: DataTypes.DATE,
      allowNull: true
    },
    deep_cleaning_interval: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 90
    },
    deep_cleaning_history: {
      type: DataTypes.JSON,
      allowNull: true
    }
  },
  {
    tableName: 'flatdb',
    timestamps: false
  }
);

export default FlatDb;
