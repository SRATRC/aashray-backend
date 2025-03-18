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
      allowNull: true
    },
    idType: {
      type: DataTypes.STRING,
      allowNull: true
    },
    idNo: {
      type: DataTypes.STRING,
      allowNull: true
    },
    address: {
      type: DataTypes.STRING,
      allowNull: true
    },
    country: {
      type: DataTypes.STRING,
      allowNull: true
    },
    state: {
      type: DataTypes.STRING,
      allowNull: true
    },
    city: {
      type: DataTypes.STRING,
      allowNull: true
    },
    pin: {
      type: DataTypes.STRING,
      allowNull: true
    },
    center: {
      type: DataTypes.STRING,
      allowNull: true
    },
    pfp: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    token: {
      type: DataTypes.TEXT,
      allowNull: true
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
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue:
        '$2b$10$kyNWZgMVhB0/YIEwJaKhP.JwugrOTUojN.8jPpwS6Tc1O7Wi2yadC'
    },
    credits: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      defaultValue: 0
    }
  },
  {
    tableName: 'card_db',
    timestamps: true
  }
);

export default CardDb;
