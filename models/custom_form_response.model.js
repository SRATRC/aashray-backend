import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const CustomFormResponse = sequelize.define(
    'custom_form_responses',
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
        cardno: {
            type: DataTypes.STRING,
            allowNull: true
        },
        responses: {
            type: DataTypes.JSON,
            allowNull: false
        },
        submittedAt: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW
        }
    },
    {
        timestamps: true
    }
);

export default CustomFormResponse;
