import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const ShibirAttendanceDb = sequelize.define(
  'ShibirAttendanceDb',
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

    days: {
      type: DataTypes.INTEGER,
      allowNull: false
    },

    session_1: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    session_1_attendance: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },

    session_2: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    session_2_attendance: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },

    session_3: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    session_3_attendance: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },

    session_4: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    session_4_attendance: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },

    session_5: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    session_5_attendance: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },

    session_6: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    session_6_attendance: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },

    updatedBy: {
      type: DataTypes.STRING(255),
      allowNull: true
    }
  },
  {
    tableName: 'shibir_attendance_db',
    timestamps: true
  }
);

export default ShibirAttendanceDb;
