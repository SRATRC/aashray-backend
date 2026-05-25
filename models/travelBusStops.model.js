import { DataTypes } from 'sequelize';
import database from '../config/database.js';

const TravelBusStops = database.define(
  'TravelBusStops',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },

    bus_group_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },

    stop_name: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    stop_order: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    timing: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  },
  {
    tableName: 'travel_bus_stops',
  }
);

export default TravelBusStops;