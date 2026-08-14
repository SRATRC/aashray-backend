import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import { STATUS_ACTIVE, STATUS_INACTIVE } from '../config/constants.js';

const SatshrutSession = sequelize.define(
  'SatshrutSession',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    session_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      unique: true
    },
    youtube_video_id: {
      type: DataTypes.STRING,
      allowNull: false
    },
    youtube_url: {
      type: DataTypes.STRING(500),
      allowNull: true
    },
    video_start_seconds: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    video_end_seconds: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    // Video 2 segment (optional second video in Phase 1 & 3)
    youtube2_video_id: {
      type: DataTypes.STRING,
      allowNull: true
    },
    youtube2_url: {
      type: DataTypes.STRING(500),
      allowNull: true
    },
    video2_start_seconds: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    video2_end_seconds: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    // Per-session audio overrides (overrides global config if set)
    audio1_youtube_id: {
      type: DataTypes.STRING,
      allowNull: true
    },
    audio1_youtube_url: {
      type: DataTypes.STRING(500),
      allowNull: true
    },
    audio2_youtube_id: {
      type: DataTypes.STRING,
      allowNull: true
    },
    audio2_youtube_url: {
      type: DataTypes.STRING(500),
      allowNull: true
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    notes2: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM,
      values: [STATUS_ACTIVE, STATUS_INACTIVE],
      defaultValue: STATUS_ACTIVE,
      allowNull: false
    },
    created_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'admin_users',
        key: 'id'
      }
    }
  },
  {
    tableName: 'satshrut_sessions',
    timestamps: true
  }
);

export default SatshrutSession;
