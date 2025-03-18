import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const GuestRelationship = sequelize.define(
  'GuestRelationship',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    cardno: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: 'card_db',
        key: 'cardno'
      }
    },
    guest: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: 'card_db',
        key: 'cardno'
      }
    },
    type: {
      type: DataTypes.STRING,
      allowNull: false
    },
    updatedBy: {
      type: DataTypes.STRING,
      allowNull: false
    }
  },
  {
    tableName: 'guest_relationship',
    timestamps: true
  }
);

export default GuestRelationship;
