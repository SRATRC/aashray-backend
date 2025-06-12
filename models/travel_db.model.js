import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import {
  STATUS_ADMIN_CANCELLED,
  STATUS_CANCELLED,
  STATUS_CONFIRMED,
  STATUS_WAITING,
  STATUS_AWAITING_CONFIRMATION,
  STATUS_PROCEED_FOR_PAYMENT
} from '../config/constants.js';

const TravelDb = sequelize.define(
  'TravelDb',
  {
    bookingid: {
      type: DataTypes.STRING,
      allowNull: false,
      primaryKey: true
    },
    cardno: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: 'card_db',
        key: 'cardno'
      }
    },
    bookedBy: {
      type: DataTypes.STRING,
      allowNull: true,
      references: {
        model: 'card_db',
        key: 'cardno'
      }
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    pickup_point: {
      type: DataTypes.STRING,
      allowNull: false
    },
    drop_point: {
      type: DataTypes.STRING,
      allowNull: false
    },
    type: {
      type: DataTypes.STRING,
      allowNull: false
    },
    luggage: {
      type: DataTypes.STRING,
      allowNull: false
    },
    arrival_time: {
      type: DataTypes.STRING,
      allowNull: true
    },
    leaving_post_adhyayan: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: 0
    },
    total_people: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    comments: {
      type: DataTypes.STRING,
      allowNull: true
    },
    admin_comments: {
      type: DataTypes.STRING,
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM,
      allowNull: true,
      values: [
        STATUS_WAITING,
        STATUS_AWAITING_CONFIRMATION,
        STATUS_CONFIRMED,
        STATUS_CANCELLED,
        STATUS_ADMIN_CANCELLED,
        STATUS_PROCEED_FOR_PAYMENT
      ],
      defaultValue: STATUS_WAITING
    },
    updatedBy: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'USER'
    }
  },
  {
    tableName: 'travel_db',
    timestamps: true
  }
);

export default TravelDb;
