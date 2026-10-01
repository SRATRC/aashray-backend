'use strict';

// Speeds up room allocation (findRoom):
//  - roomdb(roomtype, gender, roomstatus): the candidate scan filters on these
//    three columns; without an index every room row is scanned (and, before the
//    locking rewrite, locked).
//  - room_booking(checkin, checkout): the overlap predicate
//    (checkout > :in AND checkin < :out) had no usable index besides roomno.
//  - room_booking(roomno, checkout): narrows the per-room locking overlap read.
// Idempotent: each index is only created / dropped when needed.

const INDEXES = [
  {
    table: 'roomdb',
    name: 'idx_roomdb_type_gender_status',
    fields: ['roomtype', 'gender', 'roomstatus']
  },
  {
    table: 'room_booking',
    name: 'idx_room_booking_checkin_checkout',
    fields: ['checkin', 'checkout']
  },
  // Per-room overlap re-read under lock (findRoom): with (roomno, checkout) the
  // locking read only touches this room's bookings that end after the requested
  // check-in, instead of locking the room's entire booking history.
  {
    table: 'room_booking',
    name: 'idx_room_booking_roomno_checkout',
    fields: ['roomno', 'checkout']
  }
];

const hasIndex = async (queryInterface, table, name) => {
  const existing = await queryInterface.showIndex(table);
  return existing.some((i) => i.name === name);
};

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    for (const { table, name, fields } of INDEXES) {
      if (!(await hasIndex(queryInterface, table, name))) {
        await queryInterface.addIndex(table, fields, { name });
      }
    }
  },

  async down(queryInterface) {
    for (const { table, name } of INDEXES) {
      if (await hasIndex(queryInterface, table, name)) {
        await queryInterface.removeIndex(table, name);
      }
    }
  }
};
