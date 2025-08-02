import '../config/environment.js';
import sequelize from '../config/database.js';
import logger from '../config/logger.js';

const teardown = async () => {
  logger.info('Closing DB...');  
  await sequelize.close();
}

export default teardown;