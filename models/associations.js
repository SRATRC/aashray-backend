import CardDb from './card.model.js';
import GateRecord from './gate_record.model.js';
import FoodDb from './food_db.model.js';
import GuestFoodDb from './guest_food_db.model.js';
import GuestFoodTransactionDb from './guest_food_transaction.model.js';
import FoodPhysicalPlate from './food_physical_plate.model.js';
import FlatDb from './flatdb.model.js';
import FlatBooking from './flat_booking.model.js';
import RoomBooking from './room_booking.model.js';
import RoomBookingTransaction from './room_booking_transaction.model.js';
import RoomDb from './roomdb.model.js';
import ShibirDb from './shibir_db.model.js';
import ShibirBookingDb from './shibir_booking_db.model.js';
import ShibirBookingTransaction from './shibir_booking_transaction.model.js';
import Departments from './departments.model.js';
import MaintenanceDb from './maintenance_db.model.js';
import TravelDb from './travel_db.model.js';
import TravelBookingTransaction from './travel_booking_transaction.model.js';
import WifiDb from './wifi.model.js';
import UtsavBooking from './utsav_boking.model.js';
import UtsavGuestBooking from './utsav_guest_booking.js';
import UtsavBookingTransaction from './utsav_booking_transaction.model.js';
import UtsavGuestBookingTransaction from './utsav_guest_booking_transaction.model.js';
import UtsavDb from './utsav_db.model.js';
import UtsavPackagesDb from './utsav_packages.model.js';
import AdminUsers from './admin_users.model.js';
import AdminRoles from './admin_roles.model.js';
import Roles from './roles.model.js';
import Menu from './menu.model.js';
import Transactions from './transactions.model.js';
import Countries from './countries.model.js';
import States from './states.model.js';
import Cities from './cities.model.js';
import GuestDb from './guest_db.model.js';

// CardDb
CardDb.hasMany(GateRecord, {
  foreignKey: 'cardno',
  sourceKey: 'cardno',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
CardDb.hasMany(FoodDb, {
  foreignKey: 'cardno',
  sourceKey: 'cardno',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
CardDb.hasMany(GuestFoodDb, {
  foreignKey: 'cardno',
  sourceKey: 'cardno',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
CardDb.hasMany(GuestFoodTransactionDb, {
  foreignKey: 'cardno',
  sourceKey: 'cardno',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
CardDb.hasMany(ShibirBookingDb, {
  foreignKey: 'cardno',
  sourceKey: 'cardno',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
CardDb.hasMany(ShibirBookingTransaction, {
  foreignKey: 'cardno',
  sourceKey: 'cardno',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
CardDb.hasMany(FlatBooking, {
  foreignKey: 'cardno',
  sourceKey: 'cardno',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
CardDb.hasMany(FlatDb, {
  foreignKey: 'owner',
  sourceKey: 'cardno',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
CardDb.hasMany(RoomBooking, {
  foreignKey: 'cardno',
  sourceKey: 'cardno',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
CardDb.hasMany(MaintenanceDb, {
  foreignKey: 'requested_by',
  sourceKey: 'cardno',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
CardDb.hasMany(RoomBookingTransaction, {
  foreignKey: 'cardno',
  sourceKey: 'cardno',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
CardDb.hasMany(TravelBookingTransaction, {
  foreignKey: 'cardno',
  sourceKey: 'cardno',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
CardDb.hasOne(UtsavBooking, {
  foreignKey: 'cardno',
  sourceKey: 'cardno',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
CardDb.hasMany(UtsavGuestBooking, {
  foreignKey: 'cardno',
  sourceKey: 'cardno',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
CardDb.hasMany(UtsavBookingTransaction, {
  foreignKey: 'cardno',
  sourceKey: 'cardno',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
CardDb.hasMany(UtsavGuestBookingTransaction, {
  foreignKey: 'cardno',
  sourceKey: 'cardno',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
CardDb.hasMany(Transactions, {
  foreignKey: 'cardno',
  sourceKey: 'cardno',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
CardDb.hasMany(GuestDb, {
  foreignKey: 'cardno',
  sourceKey: 'cardno',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});

// Transactions
Transactions.belongsTo(CardDb, {
  foreignKey: 'cardno',
  targetKey: 'cardno'
});

// Room Transaction
RoomBookingTransaction.belongsTo(RoomBooking, {
  foreignKey: 'bookingid',
  targetKey: 'bookingid'
});
RoomBookingTransaction.belongsTo(CardDb, {
  foreignKey: 'cardno',
  targetKey: 'cardno'
});

// Food
FoodDb.belongsTo(CardDb, {
  foreignKey: 'cardno',
  targetKey: 'cardno'
});
GuestFoodDb.belongsTo(CardDb, {
  foreignKey: 'cardno',
  targetKey: 'cardno'
});
// GuestFoodDb.hasMany(GuestFoodTransactionDb, {
//   foreignKey: 'bookingid',
//   sourceKey: 'bookingid',
//   onDelete: 'CASCADE',
//   onUpdate: 'CASCADE'
// });
// GuestFoodTransactionDb.belongsTo(GuestFoodDb, {
//   foreignKey: 'bookingid',
//   targetKey: 'bookingid'
// });
GuestFoodTransactionDb.belongsTo(CardDb, {
  foreignKey: 'cardno',
  targetKey: 'cardno'
});
// Room
RoomDb.hasMany(RoomBooking, {
  foreignKey: 'roomno',
  sourceKey: 'roomno',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
RoomBooking.belongsTo(CardDb, {
  foreignKey: 'cardno',
  targetKey: 'cardno'
});
RoomBooking.hasMany(RoomBookingTransaction, {
  foreignKey: 'bookingid',
  sourceKey: 'bookingid',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
RoomBooking.belongsTo(RoomDb, {
  foreignKey: 'roomno',
  targetKey: 'roomno'
});

// Flat
FlatDb.belongsTo(CardDb, {
  foreignKey: 'owner',
  targetKey: 'cardno'
});
FlatBooking.belongsTo(CardDb, {
  foreignKey: 'cardno',
  targetKey: 'cardno'
});
FlatDb.hasMany(FlatBooking, {
  foreignKey: 'flatno',
  targetKey: 'flatno',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
FlatBooking.belongsTo(FlatDb, {
  foreignKey: 'flatno',
  targetKey: 'flatno'
});

// Shibir
ShibirDb.hasMany(ShibirBookingDb, {
  foreignKey: 'shibir_id',
  sourceKey: 'id',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
ShibirBookingDb.belongsTo(ShibirDb, {
  foreignKey: 'shibir_id',
  targetKey: 'id'
});
ShibirBookingDb.belongsTo(CardDb, {
  foreignKey: 'cardno',
  targetKey: 'cardno'
});
ShibirBookingDb.hasMany(ShibirBookingTransaction, {
  foreignKey: 'bookingid',
  sourceKey: 'bookingid',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
ShibirBookingTransaction.belongsTo(CardDb, {
  foreignKey: 'cardno',
  targetKey: 'cardno'
});
ShibirBookingTransaction.belongsTo(ShibirBookingDb, {
  foreignKey: 'bookingid',
  targetKey: 'bookingid'
});

// Maintenance
Departments.hasMany(MaintenanceDb, {
  foreignKey: 'department',
  sourceKey: 'dept_name',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
MaintenanceDb.belongsTo(Departments, {
  foreignKey: 'department',
  targetKey: 'dept_name'
});
MaintenanceDb.belongsTo(CardDb, {
  foreignKey: 'requested_by',
  targetKey: 'cardno'
});

// Gate
GateRecord.belongsTo(CardDb, {
  foreignKey: 'cardno',
  targetKey: 'cardno'
});

// Travel
TravelDb.hasMany(TravelBookingTransaction, {
  foreignKey: 'bookingid',
  sourceKey: 'bookingid',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
TravelDb.belongsTo(CardDb, {
  foreignKey: 'cardno',
  targetKey: 'cardno'
});

// Travel Transaction
TravelBookingTransaction.belongsTo(TravelDb, {
  foreignKey: 'bookingid',
  targetKey: 'bookingid'
});
TravelBookingTransaction.belongsTo(CardDb, {
  foreignKey: 'cardno',
  targetKey: 'cardno'
});

// Wifi
WifiDb.belongsTo(CardDb, {
  foreignKey: 'cardno',
  targetKey: 'cardno'
});

// Utsav
UtsavBooking.belongsTo(CardDb, {
  foreignKey: 'cardno',
  targetKey: 'cardno'
});
UtsavBooking.belongsTo(UtsavDb, {
  foreignKey: 'utsavid',
  targetKey: 'id'
});
UtsavGuestBooking.belongsTo(CardDb, {
  foreignKey: 'cardno',
  targetKey: 'cardno'
});
UtsavGuestBooking.belongsTo(UtsavDb, {
  foreignKey: 'utsavid',
  targetKey: 'id'
});
UtsavBookingTransaction.belongsTo(CardDb, {
  foreignKey: 'cardno',
  targetKey: 'cardno'
});
UtsavBooking.hasMany(UtsavBookingTransaction, {
  foreignKey: 'bookingid',
  sourceKey: 'bookingid',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
UtsavBookingTransaction.belongsTo(UtsavBooking, {
  foreignKey: 'bookingid',
  targetKey: 'bookingid'
});
UtsavGuestBookingTransaction.belongsTo(CardDb, {
  foreignKey: 'cardno',
  targetKey: 'cardno'
});
UtsavGuestBooking.hasMany(UtsavGuestBookingTransaction, {
  foreignKey: 'bookingid',
  sourceKey: 'bookingid',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
UtsavGuestBookingTransaction.belongsTo(UtsavGuestBooking, {
  foreignKey: 'bookingid',
  targetKey: 'bookingid'
});
UtsavDb.hasMany(UtsavBooking, {
  foreignKey: 'utsavid',
  sourceKey: 'id',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
UtsavBooking.belongsTo(UtsavDb, {
  foreignKey: 'utsavid',
  targetKey: 'id'
});
UtsavBooking.belongsTo(UtsavPackagesDb, {
  foreignKey: 'packageid',
  targetKey: 'id'
});
UtsavDb.hasMany(UtsavGuestBooking, {
  foreignKey: 'utsavid',
  sourceKey: 'id',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
UtsavGuestBooking.belongsTo(UtsavDb, {
  foreignKey: 'utsavid',
  targetKey: 'id'
});
UtsavGuestBooking.belongsTo(UtsavPackagesDb, {
  foreignKey: 'packageid',
  targetKey: 'id'
});
UtsavDb.hasMany(UtsavPackagesDb, {
  foreignKey: 'utsavid',
  sourceKey: 'id',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
UtsavPackagesDb.belongsTo(UtsavDb, {
  foreignKey: 'utsavid',
  targetKey: 'id'
});
UtsavPackagesDb.hasMany(UtsavBooking, {
  foreignKey: 'packageid',
  sourceKey: 'id',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
UtsavPackagesDb.hasMany(UtsavGuestBooking, {
  foreignKey: 'packageid',
  sourceKey: 'id',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});

// Admin Roles
AdminUsers.hasMany(AdminRoles, {
  foreignKey: 'user_id',
  sourceKey: 'id',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
AdminUsers.hasMany(Menu, {
  foreignKey: 'updatedBy',
  sourceKey: 'username',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
AdminRoles.belongsTo(AdminUsers, {
  foreignKey: 'user_id',
  targetKey: 'id'
});
AdminRoles.belongsTo(Roles, {
  foreignKey: 'role_name',
  targetKey: 'name'
});
Roles.hasMany(AdminRoles, {
  foreignKey: 'role_name',
  sourceKey: 'name',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});

// Menu
Menu.belongsTo(AdminUsers, {
  foreignKey: 'updatedBy',
  targetKey: 'username'
});

// Countries - States - Cities
Countries.hasMany(States, {
  foreignKey: 'country_id',
  sourceKey: 'id',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
States.hasMany(Cities, {
  foreignKey: 'state_id',
  sourceKey: 'id',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
States.belongsTo(Countries, {
  foreignKey: 'country_id',
  targetKey: 'id'
});
Cities.belongsTo(States, {
  foreignKey: 'state_id',
  targetKey: 'id'
});

// Guest
GuestDb.belongsTo(CardDb, {
  foreignKey: 'cardno',
  targetKey: 'cardno'
});
GuestFoodDb.belongsTo(GuestDb, {
  foreignKey: 'guest',
  targetKey: 'id'
});
GuestDb.hasMany(GuestFoodDb, {
  foreignKey: 'guest',
  sourceKey: 'id',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});

export {
  CardDb,
  ShibirDb,
  ShibirBookingDb,
  ShibirBookingTransaction,
  Departments,
  MaintenanceDb,
  GateRecord,
  FoodDb,
  GuestFoodDb,
  GuestFoodTransactionDb,
  FoodPhysicalPlate,
  RoomBooking,
  RoomBookingTransaction,
  RoomDb,
  FlatDb,
  FlatBooking,
  TravelDb,
  TravelBookingTransaction,
  WifiDb,
  UtsavDb,
  UtsavBooking,
  UtsavGuestBooking,
  UtsavBookingTransaction,
  UtsavGuestBookingTransaction,
  UtsavPackagesDb,
  AdminRoles,
  AdminUsers,
  Roles,
  Menu,
  Cities,
  States,
  Countries,
  GuestDb
};
