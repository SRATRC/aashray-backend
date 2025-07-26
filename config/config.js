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
    dialect: 'mysql',
    pool: {
      max: 5,
      min: 2,
      acquire: 60000, // Maximum time (ms) to try getting connection before throwing error
      idle: 30000, // Maximum time (ms) a connection can be idle before being released
      evict: 1000, // Time interval (ms) to run eviction to free idle connections
      handleDisconnects: true // Automatically handle disconnects
    }
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
    pool: {
      max: 10,
      min: 2,
      acquire: 60000,
      idle: 30000,
      evict: 1000,
      handleDisconnects: true
    },
    language: 'en'
  },
  prod: {
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: 'mysql',
    pool: {
      max: 25,
      min: 5,
      acquire: 60000,
      idle: 30000,
      evict: 1000,
      handleDisconnects: true
    }
  }
};

export default config;
