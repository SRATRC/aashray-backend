import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import { STATUS_ONPREM, STATUS_OFFPREM } from '../config/constants.js';

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
      type: DataTypes.ENUM,
      allowNull: false,
      values: [STATUS_ONPREM, STATUS_OFFPREM]
    }
  },
  {
    tableName: 'gate_record',
    timestamps: true
  }
);

export default GateRecord;
