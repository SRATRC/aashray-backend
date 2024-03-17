import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import { STATUS_ACTIVE, STATUS_INACTIVE } from '../config/constants.js';

const BlockDates = sequelize.define(
  'BlockDates',
  {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true
    },
    checkin: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    checkout: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    comments: {
      type: DataTypes.STRING,
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM,
      allowNull: false,
      values: [STATUS_ACTIVE, STATUS_INACTIVE],
      defaultValue: STATUS_ACTIVE
    },
    updatedBy: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'ADMIN'
    }
  },
  {
    tableName: 'blockdates',
    timestamps: true
  }
);

export default BlockDates;
