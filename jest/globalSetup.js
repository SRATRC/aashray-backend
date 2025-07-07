import '../config/environment.js';
import sequelize from '../config/database.js';
import logger from '../config/logger.js';
import { } from '../models/associations.js';

const SEEDER_PATH = '../seeders/*.js';

const setup = async () => {
  logger.info('Authenticating DB...');
  await sequelize.authenticate();
  logger.info('Synching models...');
  await sequelize.sync();
};

export default setup;