// This is the main database configuration used by the running application
// Pool settings here control the actual connection behavior
import { Sequelize } from 'sequelize';
const { private_key } =
  process.env.NODE_ENV == 'qa' && JSON.parse(process.env.DB_CERT);

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USERNAME,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: 'mysql',
    dialectOptions: {
      decimalNumbers: true,
      ssl: process.env.NODE_ENV == 'qa' && {
        ca: private_key
      }
    },
    pool: {
      max: 25,
      min: 2,
      acquire: 60000, // Maximum time (ms) to try getting connection before throwing error
      idle: 30000, // Maximum time (ms) a connection can be idle before being released
      evict: 1000, // Time interval (ms) to run eviction to free idle connections
      handleDisconnects: true // Automatically handle disconnects
    },
    language: 'en'
  }
);

export default sequelize;
