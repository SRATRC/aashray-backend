// __mocks__/models.js
import sequelize from '../../config/database.js';

const RoomDb = sequelize.define('RoomDb', {});
const CardDb = sequelize.define('CardDb', {});
const FlatDb = sequelize.define('FlatDb', {});
const FlatBooking = sequelize.define('FlatBooking', {});
const ShibirDb = sequelize.define('ShibirDb', {});
const ShibirBookingDb = sequelize.define('ShibirBookingDb', {});
const ShibirBookingTransaction = sequelize.define('ShibirBookingTransaction', {});
const Departments = sequelize.define('Departments', {});
const MaintenanceDb = sequelize.define('MaintenanceDb', {});

export {
  RoomDb,
  CardDb,
  FlatDb,
  FlatBooking,
  ShibirDb,
  ShibirBookingDb,
  ShibirBookingTransaction,
  Departments,
  MaintenanceDb,
};
