import CardDb from './card.model.js';
import GateRecord from './gate_record.model.js';
import FoodDb from './food_db.model.js';
import FoodPhysicalPlate from './food_physical_plate.model.js';
import FlatDb from './flatdb.model.js';
import FlatBooking from './flat_booking.model.js';
import RoomBooking from './room_booking.model.js';
import RoomDb from './roomdb.model.js';
import ShibirDb from './shibir_db.model.js';
import ShibirBookingDb from './shibir_booking_db.model.js';
import Departments from './departments.model.js';
import MaintenanceDb from './maintenance_db.model.js';
import TravelDb from './travel_db.model.js';
import WifiDb from './wifi.model.js';
import UtsavBooking from './utsav_boking.model.js';
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
import GuestRelationship from './guest_relationship.model.js';

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
CardDb.hasMany(FoodDb, {
  foreignKey: 'bookedBy',
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
CardDb.hasMany(ShibirBookingDb, {
  foreignKey: 'bookedBy',
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
CardDb.hasMany(RoomBooking, {
  foreignKey: 'bookedBy',
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
CardDb.hasOne(UtsavBooking, {
  foreignKey: 'cardno',
  sourceKey: 'cardno',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
CardDb.hasOne(UtsavBooking, {
  foreignKey: 'bookedBy',
  sourceKey: 'cardno',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
CardDb.hasMany(TravelDb, {
  foreignKey: 'cardno',
  sourceKey: 'cardno',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
CardDb.hasMany(TravelDb, {
  foreignKey: 'bookedBy',
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
CardDb.hasMany(GuestRelationship, {
  foreignKey: 'cardno',
  sourceKey: 'cardno',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
CardDb.hasMany(GuestRelationship, {
  foreignKey: 'guest',
  sourceKey: 'cardno',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});

// Transactions
Transactions.belongsTo(CardDb, {
  foreignKey: 'cardno',
  targetKey: 'cardno'
});

// Food
FoodDb.belongsTo(CardDb, {
  foreignKey: 'cardno',
  targetKey: 'cardno'
});
FoodDb.belongsTo(CardDb, {
  foreignKey: 'bookedBy',
  targetKey: 'cardno'
});

// Room
RoomDb.hasMany(RoomBooking, {
  foreignKey: 'roomno',
  sourceKey: 'roomno',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
RoomBooking.belongsTo(RoomDb, {
  foreignKey: 'roomno',
  targetKey: 'roomno'
});
RoomBooking.belongsTo(CardDb, {
  foreignKey: 'cardno',
  targetKey: 'cardno'
});
RoomBooking.belongsTo(CardDb, {
  foreignKey: 'bookedBy',
  targetKey: 'cardno'
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
ShibirBookingDb.belongsTo(CardDb, {
  foreignKey: 'bookedBy',
  targetKey: 'cardno'
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
TravelDb.belongsTo(CardDb, {
  foreignKey: 'cardno',
  targetKey: 'cardno'
});
TravelDb.belongsTo(CardDb, {
  foreignKey: 'bookedBy',
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
UtsavBooking.belongsTo(CardDb, {
  foreignKey: 'bookedBy',
  targetKey: 'cardno'
});
UtsavBooking.belongsTo(UtsavDb, {
  foreignKey: 'utsavid',
  targetKey: 'id'
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
GuestRelationship.belongsTo(CardDb, {
  foreignKey: 'cardno',
  targetKey: 'cardno'
});
GuestRelationship.belongsTo(CardDb, {
  foreignKey: 'guest',
  targetKey: 'cardno'
});

export {
  CardDb,
  Transactions,
  ShibirDb,
  ShibirBookingDb,
  Departments,
  MaintenanceDb,
  GateRecord,
  FoodDb,
  FoodPhysicalPlate,
  RoomBooking,
  RoomDb,
  FlatDb,
  FlatBooking,
  TravelDb,
  WifiDb,
  UtsavDb,
  UtsavBooking,
  UtsavPackagesDb,
  AdminRoles,
  AdminUsers,
  Roles,
  Menu,
  Cities,
  States,
  Countries,
  GuestDb,
  GuestRelationship
};
