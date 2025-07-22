import '../config/environment.js';
import sequelize from '../config/database.js';
import logger from '../config/logger.js';
import { CardDb, RoomDb, ShibirDb } from '../models/associations.js';
import CardFactory from '../tests/factories/cardFactory.js';
import ShibirFactory from '../tests/factories/shibirFactory.js';
import RoomFactory from '../tests/factories/roomFactory.js';

const setup = async () => {
  logger.info('Authenticating DB...');
  await sequelize.authenticate();
  logger.info('Synching models...');
  await sequelize.sync();
  logger.info('Truncating DB...');
  await truncate();
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

  // create room
  await RoomFactory.createRoomFor1DayVisit();
  await RoomFactory.create();
}

async function truncate() {
  await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');

  await CardDb.truncate();
  await ShibirDb.truncate();
  await RoomDb.truncate();

  await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
}

export default setup;
