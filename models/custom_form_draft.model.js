import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const CustomFormDraft = sequelize.define(
    'custom_form_drafts',
    {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true
        },
        form_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        email: {
            type: DataTypes.STRING,
            allowNull: false
        },
        cardno: {
            type: DataTypes.STRING,
            allowNull: true
        },
        mobno: {
            type: DataTypes.STRING,
            allowNull: true
        },
        responses: {
            type: DataTypes.JSON,
            allowNull: false
        }
    },
    {
        timestamps: true,
        indexes: [
            {
                unique: true,
                fields: ['form_id', 'email']
            }
        ]
    }
);

export default CustomFormDraft;
