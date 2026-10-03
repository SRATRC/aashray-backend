import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const TravelBusPassengers = sequelize.define(
  'travel_bus_passengers',
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

    bookingid: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    boarded: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },

    boarded_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: 'travel_bus_passengers',
    timestamps: true,
  }
);

export default TravelBusPassengers;