import '../config/environment.js';
import sequelize from '../config/database.js';
import logger from '../config/logger.js';
import { } from '../models/associations.js';
import CardFactory from '../tests/factories/cardFactory.js';
import ShibirFactory from '../tests/factories/shibirFactory.js';

const setup = async () => {
  logger.info('Authenticating DB...');
  await sequelize.authenticate();
  logger.info('Synching models...');
  await sequelize.sync({force: true});
  logger.info('Seeding DB...');
  await seed();
};

async function seed() {
  // create mumukshus
  await CardFactory.create("Mumukshu_1");
  await CardFactory.create("Mumukshu_2");

  // create guest
  await CardFactory.createGuest("Guest_1");
  await CardFactory.createGuest("Guest_2");

  // create shibir
  await ShibirFactory.create();
}

export default setup;