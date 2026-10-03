import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const ShibirSession = sequelize.define(
  'ShibirSession',
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    shibir_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'shibir_db',
        key: 'id'
      }
    },
    session_number: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    type: {
      type: DataTypes.ENUM('regular', 'MV'),
      allowNull: false,
      defaultValue: 'regular'
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    start_time: {
      type: DataTypes.TIME,
      allowNull: true
    },
    updatedBy: {
      type: DataTypes.STRING(255),
      allowNull: true
    }
  },
  {
    tableName: 'shibir_sessions',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['shibir_id', 'session_number']
      }
    ]
  }
);

export default ShibirSession;
