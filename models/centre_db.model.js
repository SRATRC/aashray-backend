import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const CentreDb = sequelize.define(
  'centre_db',
  {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    }
  },
  {
    tableName: 'centre_db',
    timestamps: true
  }
);

export default CentreDb;
