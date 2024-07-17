import { Sequelize } from 'sequelize';
const { private_key } =
  process.env.NODE_ENV == 'pord' && JSON.parse(process.env.DB_CERT);

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USERNAME,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: 'mysql',
    dialectOptions: process.env.NODE_ENV == 'pord' && {
      ssl: {
        ca: private_key
      }
    },
    pool: { maxConnections: 5, maxIdleTime: 30 },
    language: 'en'
  }
);

export default sequelize;
