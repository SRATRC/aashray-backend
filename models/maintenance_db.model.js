import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import { STATUS_CLOSED, STATUS_OPEN } from '../config/constants.js';

const MaintenanceDb = sequelize.define(
  'MaintenanceDb',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    requested_by: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: 'card_db',
        key: 'cardno'
      }
    },
    department: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: 'departments',
        key: 'dept_name'
      }
    },
    work_detail: {
      type: DataTypes.STRING,
      allowNull: false
    },
    area_of_work: {
      type: DataTypes.STRING,
      allowNull: true
    },
    comments: {
      type: DataTypes.STRING,
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM,
      allowNull: false,
      values: [STATUS_OPEN, STATUS_CLOSED],
      defaultValue: STATUS_OPEN
    },
    finished_at: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    updatedBy: {
      type: DataTypes.STRING,
      allowNull: false
    }
  },
  {
    tableName: 'maintenance_db',
    timestamps: true
  }
);

export default MaintenanceDb;
