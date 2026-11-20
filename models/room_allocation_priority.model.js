import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const RoomAllocationPriority = sequelize.define(
  'RoomAllocationPriority',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false
    },
    month: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Month (1-12), NULL for global default'
    },
    priority_order: {
      type: DataTypes.STRING(255),
      allowNull: false,
      defaultValue: 'OAG_1st,OAG_2nd,NAG_1st,NAG_2nd'
    },
    updatedBy: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'ADMIN'
    }
  },
  {
    tableName: 'room_allocation_priorities',
    timestamps: true
  }
);

export default RoomAllocationPriority;
