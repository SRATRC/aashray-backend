import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import {
  STATUS_PENDING,
  STATUS_APPROVED,
  STATUS_REJECTED,
  STATUS_RESET,
  STATUS_DELETED
} from '../config/constants.js';

const PermanentWifiCodes = sequelize.define('permanent_wifi_codes', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
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
  code: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'The actual permanent WiFi code assigned by admin'
  },
  status: {
    type: DataTypes.ENUM,
    allowNull: false,
    values: [
      STATUS_PENDING,
      STATUS_APPROVED,
      STATUS_REJECTED,
      STATUS_RESET,
      STATUS_DELETED
    ],
    defaultValue: STATUS_PENDING
  },
  requested_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  reviewed_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  reviewed_by: {
    type: DataTypes.STRING,
    allowNull: true
  },
  admin_comments: {
    type: DataTypes.TEXT,
    allowNull: true
  }
});

export default PermanentWifiCodes;
