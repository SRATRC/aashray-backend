import { Sequelize } from 'sequelize';

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USERNAME,
  process.env.DB_PASSWORD,
  {
    host: 'localhost',
    dialect: 'mysql',
    pool: {
      max: 30,
      min: 5,
      acquire: 30000,
      idle: 10000
    }
  }
);

export default sequelize;
