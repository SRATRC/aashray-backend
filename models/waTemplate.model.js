import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const WaTemplate = sequelize.define(
  'WaTemplate',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    text: {
      type: DataTypes.TEXT,
      allowNull: false
    }
  },
  {
    tableName: 'wa_templates',
    timestamps: true
  }
);

export default WaTemplate;
