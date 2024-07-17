import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import {
  STATUS_ONPREM,
  STATUS_OFFPREM,
  STATUS_RESIDENT,
  STATUS_MUMUKSHU,
  STATUS_SEVA_KUTIR,
  STATUS_GUEST
} from '../config/constants.js';

const CardDb = sequelize.define(
  'CardDb',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    cardno: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
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
      unique: true,
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
      values: [STATUS_ONPREM, STATUS_OFFPREM]
    },
    res_status: {
      type: DataTypes.ENUM,
      allowNull: false,
      values: [
        STATUS_MUMUKSHU,
        STATUS_RESIDENT,
        STATUS_SEVA_KUTIR,
        STATUS_GUEST
      ]
    },
    updatedBy: {
      type: DataTypes.STRING,
      allowNull: false
    }
  },
  {
    tableName: 'card_db',
    timestamps: true
  }
);

export default CardDb;
