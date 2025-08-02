// This file is used ONLY by Sequelize CLI for migrations and seeders
// The actual application uses config/database.js for connection pooling
import dotenv from 'dotenv';
dotenv.config({ path: `.env.${process.env.NODE_ENV || 'dev'}` });

const { private_key } =
  process.env.NODE_ENV === 'qa' && JSON.parse(process.env.DB_CERT || '{}');

const config = {
  dev: {
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: 'mysql'
  },
  test: {
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: 'mysql'
  },
  qa: {
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: 'mysql',
    dialectOptions: {
      decimalNumbers: true,
      ssl: process.env.NODE_ENV === 'qa' && {
        ca: private_key
      }
    },

    language: 'en'
  },
  prod: {
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: 'mysql'
  }
};

export default config;
