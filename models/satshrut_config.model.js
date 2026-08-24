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
    },
    // Continuous rolling 4-week Monday rotation:
    //   [{youtube_id, youtube_url, start_seconds, end_seconds}, …]
    //   Rotates through 4 videos week after week continuously across month boundaries.
    bhakti_videos: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: null
    },
    // Optional offset (0-3) to manually shift the Bhakti sequence forward/backward
    bhakti_offset: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    // 17th Monthly Morning Session Configuration:
    //   { fixed: { intro, pause1, pause2 }, monthly: { "YYYY-MM": { bhakti, clip1, clip2 } } }
    seventeenth_config: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: null
    }
  },
  {
    tableName: 'satshrut_config',
    timestamps: true
  }
);

export default SatshrutConfig;
