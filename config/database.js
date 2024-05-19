import { Sequelize } from 'sequelize';
const { private_key } = JSON.parse(process.env.AIVEN_CA_CERT);

const sequelize = new Sequelize(
  process.env.AIVEN_DATABASE_NAME,
  process.env.AIVEN_USERNAME,
  process.env.AIVEN_PASSWORD,
  {
    host: process.env.AIVEN_HOST,
    port: process.env.AIVEN_PORT,
    dialect: 'mysql',
    dialectOptions: {
      ssl: {
        ca: private_key
      }
    },
    pool: { maxConnections: 5, maxIdleTime: 30 },
    language: 'en'
  }
);

export default sequelize;
