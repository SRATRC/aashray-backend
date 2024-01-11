import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const CardDb = sequelize.define(
  'CardDb',
  {
    cardno: {
      type: DataTypes.STRING,
      allowNull: false,
      primaryKey: true
    },
    issuedto: {
      type: DataTypes.STRING,
      allowNull: false
    },
    gender: {
      type: DataTypes.ENUM,
      allowNull: false,
      values: ['M', 'F']
    },
    dob: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    mobno: {
      type: DataTypes.BIGINT,
      allowNull: false
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false
    },
    idType: {
      type: DataTypes.STRING,
      allowNull: false
    },
    idNo: {
      type: DataTypes.STRING,
      allowNull: false
    },
    address: {
      type: DataTypes.STRING,
      allowNull: false
    },
    city: {
      type: DataTypes.STRING,
      allowNull: false
    },
    state: {
      type: DataTypes.STRING,
      allowNull: false
    },
    pin: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    centre: {
      type: DataTypes.STRING,
      allowNull: false
    },
    active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    status: {
      type: DataTypes.ENUM,
      allowNull: false,
      values: ['onprem', 'offprem']
    },
    res_status: {
      type: DataTypes.ENUM,
      allowNull: false,
      values: ['MUMUKSHU', 'PR']
    }
  },
  {
    tableName: 'card_db',
    timestamps: true
  }
);

export default CardDb;
