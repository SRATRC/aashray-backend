import { Sequelize } from 'sequelize';
import fs from 'fs';

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
        ca: fs.readFileSync('/home/ubuntu/app/config/aiven_ca.pem')
      }
    },
    pool: { maxConnections: 5, maxIdleTime: 30 },
    language: 'en'
  }
);

export default sequelize;
