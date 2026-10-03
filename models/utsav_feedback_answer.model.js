// models/UtsavFeedbackAnswer.js

import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const UtsavFeedbackAnswer = sequelize.define(
    'UtsavFeedbackAnswer',
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },

        feedback_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: {
                model: 'utsav_feedback',
                key: 'id'
            }
        },

        question_id: {
            type: DataTypes.STRING,
            allowNull: false
        },

        question_text: {
            type: DataTypes.TEXT,
            allowNull: false
        },

        question_type: {
            type: DataTypes.ENUM('rating', 'text'),
            allowNull: false
        },

        answer: {
            type: DataTypes.TEXT,
            allowNull: false
        }
    },
    {
        tableName: 'utsav_feedback_answers',
        timestamps: true,
        indexes: [
            {
                fields: ['feedback_id']
            },
            {
                fields: ['question_id']
            }
        ]
    }
);

UtsavFeedbackAnswer.associate = (models) => {
    UtsavFeedbackAnswer.belongsTo(models.UtsavFeedback, {
        foreignKey: 'feedback_id',
        targetKey: 'id',
        as: 'feedback'
    });
};

export default UtsavFeedbackAnswer;