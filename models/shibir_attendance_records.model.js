import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const ShibirAttendanceRecord = sequelize.define(
  'ShibirAttendanceRecord',
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    shibir_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    bookingid: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    cardno: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    session_number: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    attended: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    updatedBy: {
      type: DataTypes.STRING(255),
      allowNull: true
    }
  },
  {
    tableName: 'shibir_attendance_records',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['bookingid', 'session_number']
      }
    ]
  }
);

export default ShibirAttendanceRecord;
