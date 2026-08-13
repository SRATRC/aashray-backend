import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

// Singleton table — always a single row with id=1
const SatshrutConfig = sequelize.define(
  'SatshrutConfig',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      defaultValue: 1
    },
    // Default meditation audio YouTube video IDs for Phase 2 and Phase 4
    default_audio1_youtube_id: {
      type: DataTypes.STRING,
      allowNull: true
    },
    default_audio2_youtube_id: {
      type: DataTypes.STRING,
      allowNull: true
    },
    // Days of week with no sessions (JS getDay(): 0=Sun, 1=Mon, 4=Thu)
    no_session_days: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [1, 4] // Monday and Thursday
    }
  },
  {
    tableName: 'satshrut_config',
    timestamps: true
  }
);

export default SatshrutConfig;
