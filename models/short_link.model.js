import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const ShortLink = sequelize.define(
    'short_links',
    {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true
        },

        slug: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true
        },

        target_url: {
            type: DataTypes.TEXT,
            allowNull: false
        },

        type: {
            type: DataTypes.ENUM(
                'accounts',
                'room',
                'card',
                'office',
                'food',
                'adhyayan',
                'travel',
                'utsav',
                'avt',
                'wifi'
            ),
            allowNull: false,
            defaultValue: 'wifi'
        },

        active: {
            type: DataTypes.BOOLEAN,
            defaultValue: true
        },

        click_count: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },

        createdBy: {
            type: DataTypes.STRING,
            allowNull: true
        }
    },
    {
        timestamps: true
    }
);

export default ShortLink;