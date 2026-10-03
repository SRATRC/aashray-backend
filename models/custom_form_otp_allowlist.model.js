import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const CustomFormOtpAllowlist = sequelize.define(
    'custom_form_otp_allowlist',
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
        mobno: {
            type: DataTypes.STRING,
            allowNull: true
        },
        cardno: {
            type: DataTypes.STRING,
            allowNull: true
        },
        department: {
            type: DataTypes.STRING,
            allowNull: true
        },
        status: {
            type: DataTypes.ENUM('active', 'inactive'),
            allowNull: false,
            defaultValue: 'active'
        }
    },
    {
        tableName: 'custom_form_otp_allowlist',
        timestamps: true,
        indexes: [
            {
                fields: ['form_id']
            }
        ]
    }
);

export default CustomFormOtpAllowlist;
