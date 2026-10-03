import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const WaSession = sequelize.define(
  'WaSession',
  {
    id: {
      type: DataTypes.STRING(255),
      allowNull: false,
      primaryKey: true
    },
    creds: {
      type: DataTypes.JSON,
      allowNull: true
    },
    keys: {
      type: DataTypes.JSON,
      allowNull: true
    }
  },
  {
    tableName: 'wa_sessions',
    timestamps: true
  }
);

export default WaSession;
