import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const RoomBookingExemption = sequelize.define(
  'RoomBookingExemption',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false
    },
    cardno: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: 'card_db',
        key: 'cardno'
      }
    },
    is_permanent: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    valid_from: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    valid_to: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    reason: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    updatedBy: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'ADMIN'
    }
  },
  {
    tableName: 'room_booking_exemptions',
    timestamps: true
  }
);

export default RoomBookingExemption;
