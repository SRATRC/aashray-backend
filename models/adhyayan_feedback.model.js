import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const AdhyayanFeedback = sequelize.define(
  'AdhyayanFeedback',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    shibir_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'shibir_db',
        key: 'id'
      }
    },
    cardno: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: 'card_db',
        key: 'cardno'
      }
    },
    swadhay_karta_rating: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1,
        max: 5
      },
      comment: 'Rating for Swadhay Karta session (1-5 scale)'
    },
    personal_interaction_rating: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1,
        max: 5
      },
      comment: 'Rating for personal interaction with swadhay karta (1-5 scale)'
    },
    swadhay_karta_suggestions: {
      type: DataTypes.TEXT,
      allowNull: true,
      validate: {
        len: [0, 1000]
      },
      comment: 'Suggestions for swadhay karta to improve skills/activity'
    },
    raj_adhyayan_interest: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      comment: 'Interest in attending Raj Adhyayan in future (true/false)'
    },
    future_topics: {
      type: DataTypes.TEXT,
      allowNull: true,
      validate: {
        len: [0, 1000]
      },
      comment: 'Topics for future Raj Adhyayan sessions'
    },
    loved_most: {
      type: DataTypes.TEXT,
      allowNull: true,
      validate: {
        len: [0, 1000]
      },
      comment: 'What they loved most about this Raj Adhyayan'
    },
    improvement_suggestions: {
      type: DataTypes.TEXT,
      allowNull: true,
      validate: {
        len: [0, 1000]
      },
      comment: 'Other scope of improvement suggestions'
    },
    food_rating: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1,
        max: 5
      },
      comment: 'Rating for food at bhojanalay (1-5 scale)'
    },
    stay_rating: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1,
        max: 5
      },
      comment: 'Rating for stay at Research Centre (1-5 scale)'
    },
    submitted_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    updatedBy: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'USER'
    }
  },
  {
    tableName: 'adhyayan_feedback',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['shibir_id', 'cardno'],
        name: 'unique_feedback_per_user_per_adhyayan'
      },
      {
        fields: ['shibir_id']
      },
      {
        fields: ['cardno']
      },
      {
        fields: ['submitted_at']
      }
    ]
  }
);

export default AdhyayanFeedback;
