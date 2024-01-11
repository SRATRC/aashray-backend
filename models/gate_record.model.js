import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const GateRecord = sequelize.define(
  'GateRecord',
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
    status: {
      type: DataTypes.STRING,
      allowNull: false
    }
  },
  {
    tableName: 'gate_record',
    timestamps: true
  }
);

export default GateRecord;
