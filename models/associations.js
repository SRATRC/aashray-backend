import CardDb from './card.model.js';
import ShibirDb from './shibir_db.model.js';
import GateRecord from './gate_record.model.js';
import FoodDb from './food_db.model.js';
import GuestFoodDb from './guest_food_db.model.js';
import RoomBooking from './room_booking.model.js';
import RoomBookingTransaction from './room_booking_transaction.model.js';
import RoomDb from './roomdb.model.js';
import ShibirBookingDb from './shibir_booking_db.model.js';
import Departments from './departments.model.js';
import MaintenanceDb from './maintenance_db.model.js';
import TransactionDb from './transaction_db.model.js';
import TravelDb from './travel_db.model.js';
import TravelBookingTransaction from './travel_booking.model.js';
import WifiDb from './wifi.model.js';
import UtsavBooking from './utsav_boking.model.js';
import UtsavGuestBooking from './utsav_guest_booking.js';
import UtsavBookingTransaction from './utsav_booking_transaction.model.js';
import UtsavDb from './utsav_db.model.js';

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
CardDb.hasMany(ShibirBookingDb, {
  foreignKey: 'cardno',
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
CardDb.hasMany(TransactionDb, {
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
UtsavBooking.belongsTo(CardDb, {
  foreignKey: 'id',
  targetKey: 'utsavid'
});
UtsavGuestBooking.belongsTo(CardDb, {
  foreignKey: 'cardno',
  targetKey: 'cardno'
});
UtsavGuestBooking.belongsTo(CardDb, {
  foreignKey: 'id',
  targetKey: 'utsavid'
});
UtsavBookingTransaction.belongsTo(CardDb, {
  foreignKey: 'cardno',
  targetKey: 'cardno'
});

UtsavDb.hasMany(UtsavBooking, {
  foreignKey: 'id',
  sourceKey: 'utsavid',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
UtsavDb.hasMany(UtsavGuestBooking, {
  foreignKey: 'id',
  sourceKey: 'utsavid',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});

export {
  CardDb,
  ShibirDb,
  ShibirBookingDb,
  Departments,
  MaintenanceDb,
  GateRecord,
  FoodDb,
  GuestFoodDb,
  RoomBooking,
  RoomBookingTransaction,
  RoomDb,
  TransactionDb,
  TravelDb,
  TravelBookingTransaction,
  WifiDb,
  UtsavDb,
  UtsavBooking,
  UtsavGuestBooking,
  UtsavBookingTransaction
};
