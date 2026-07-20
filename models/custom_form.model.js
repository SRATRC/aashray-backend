import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const CustomForm = sequelize.define(
    'custom_forms',
    {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true
        },
        title: {
            type: DataTypes.STRING,
            allowNull: false
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        dept_name: {
            type: DataTypes.STRING,
            allowNull: false
        },
        slug: {
            type: DataTypes.STRING,
            allowNull: true,
            unique: true
        },
        fields: {
            type: DataTypes.JSON,
            allowNull: false
        },
        status: {
            type: DataTypes.ENUM('active', 'inactive'),
            allowNull: false,
            defaultValue: 'active'
        },
        createdBy: {
            type: DataTypes.STRING,
            allowNull: true
        },
        isPublic: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true
        },
        limitOneResponse: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false
        },
        allowEdit: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false
        },
        showProgressBar: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true
        },
        confirmationMessage: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        showSubmitAnother: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true
        }
    },
    {
        timestamps: true
    }
);

export default CustomForm;
