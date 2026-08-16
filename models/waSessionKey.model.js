import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

// One row per Baileys signal key. Keeping every key in a single JSON column made
// each key rotation rewrite the whole store, which is what filled the binlog volume.
const WaSessionKey = sequelize.define(
  'WaSessionKey',
  {
    session_id: {
      type: DataTypes.STRING(255),
      allowNull: false,
      primaryKey: true
    },
    key_name: {
      type: DataTypes.STRING(255),
      allowNull: false,
      primaryKey: true
    },
    value: {
      type: DataTypes.JSON,
      allowNull: false
    }
  },
  {
    tableName: 'wa_session_keys',
    timestamps: true
  }
);

export default WaSessionKey;
