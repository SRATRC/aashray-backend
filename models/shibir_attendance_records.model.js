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
      allowNull: false,
      references: {
        model: 'shibir_db',
        key: 'id'
      }
    },
    bookingid: {
      type: DataTypes.STRING(255),
      allowNull: false,
      references: {
        model: 'shibir_booking_db',
        key: 'bookingid'
      }
    },
    cardno: {
      type: DataTypes.STRING(255),
      allowNull: false,
      references: {
        model: 'card_db',
        key: 'cardno'
      }
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
