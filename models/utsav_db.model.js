import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import { STATUS_CLOSED, STATUS_OPEN } from '../config/constants.js';

const UtsavDb = sequelize.define(
  'UtsavDb',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    start_date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    end_date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    month: {
      type: DataTypes.STRING,
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM,
      allowNull: true,
      values: [STATUS_OPEN, STATUS_CLOSED],
      defaultValue: STATUS_OPEN
    }
  },
  {
    tableName: 'utsav_db',
    timestamps: true
  }
);

export default UtsavDb;
