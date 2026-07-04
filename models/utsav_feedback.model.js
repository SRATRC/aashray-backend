// models/UtsavFeedback.js

import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const UtsavFeedback = sequelize.define(
  'UtsavFeedback',
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

    utsav_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'utsav_db',
        key: 'id'
      }
    }
  },
  {
    tableName: 'utsav_feedback',
    timestamps: true,
    indexes: [
      {
        fields: ['utsav_id']
      },
      {
        fields: ['cardno']
      },
      {
        unique: true,
        fields: ['utsav_id', 'cardno'],
        name: 'unique_feedback_per_user_per_utsav'
      }
    ]
  }
);

UtsavFeedback.associate = (models) => {
  UtsavFeedback.belongsTo(models.UtsavDb, {
    foreignKey: 'utsav_id',
    targetKey: 'id'
  });

  UtsavFeedback.belongsTo(models.CardDb, {
    foreignKey: 'cardno',
    targetKey: 'cardno'
  });

  UtsavFeedback.hasMany(models.UtsavFeedbackAnswer, {
    foreignKey: 'feedback_id',
    sourceKey: 'id',
    as: 'answers',
    onDelete: 'CASCADE'
  });
};

export default UtsavFeedback;