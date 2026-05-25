import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const TravelBusGroup = sequelize.define(
  'travel_bus_group',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },

    event_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },

    bus_name: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    pickup_point: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    drop_point: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    coordinator_bookingid: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    capacity: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    createdBy: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  },
  {
    tableName: 'travel_bus_group',
    timestamps: true,
  }
);

export default TravelBusGroup;