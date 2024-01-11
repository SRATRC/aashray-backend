import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const TravelDb = sequelize.define(
  'TravelDb',
  {
    bookingid: {
      type: DataTypes.STRING,
      allowNull: false,
      primaryKey: true
    },
    cardno: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: 'card_db',
        key: 'cardno'
      }
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    pickup_point: {
      type: DataTypes.STRING,
      allowNull: false
    },
    drop_point: {
      type: DataTypes.STRING,
      allowNull: false
    },
    luggage: {
      type: DataTypes.STRING,
      allowNull: false
    },
    comments: {
      type: DataTypes.STRING,
      allowNull: true
    },
    admin_comments: {
      type: DataTypes.STRING,
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM,
      allowNull: true,
      values: ['waiting', 'confirmed', 'cancelled', 'admin canceled'],
      defaultValue: 'waiting'
    }
  },
  {
    tableName: 'travel_db',
    timestamps: true
  }
);

export default TravelDb;
