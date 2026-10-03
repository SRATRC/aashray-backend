import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const CoordinatorOtp = sequelize.define(
  'coordinator_login_otp',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },

    mobno: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    otp: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    expires_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },

    verified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },

    attempts: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
  },

  {
    tableName: 'coordinator_login_otp',
    freezeTableName: true,
  }
);

export default CoordinatorOtp;