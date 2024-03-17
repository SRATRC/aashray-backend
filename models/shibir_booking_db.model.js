import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const ShibirBookingDb = sequelize.define(
  'ShibirBookingDb',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    shibir_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'shibir_db',
        key: 'id'
      }
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
      allowNull: true,
      values: ['waiting', 'confirmed', 'cancelled', 'admin canceled'],
      defaultValue: 'confirmed'
    },
    updatedBy: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'USER'
    }
  },
  {
    tableName: 'shibir_booking_db',
    timestamps: true
  }
);

export default ShibirBookingDb;
