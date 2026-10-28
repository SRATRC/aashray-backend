'use strict';

// One allocation-priority rule per month, and one global default (month NULL).
// A plain UNIQUE(month) would let many NULL rows through (MySQL treats NULLs as
// distinct), so a stored generated column maps NULL -> 0 and carries the
// unique index. Months are 1-12, so 0 never collides with a real month.
// Idempotent; existing duplicates are collapsed first (the oldest row per month is kept: the readers use findOne with no order,
// which returns the lowest id).

const TABLE = 'room_allocation_priorities';
const COLUMN = 'month_key';
const INDEX = 'uq_room_allocation_priorities_month';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const cols = await queryInterface.describeTable(TABLE);
    if (!cols[COLUMN]) {
      await queryInterface.sequelize.query(
        `ALTER TABLE ${TABLE} ADD COLUMN ${COLUMN} INT GENERATED ALWAYS AS (IFNULL(month, 0)) STORED`
      );
    }
    await queryInterface.sequelize.query(`
      DELETE p FROM ${TABLE} p
      JOIN ${TABLE} newer
        ON IFNULL(newer.month, 0) = IFNULL(p.month, 0) AND newer.id < p.id
    `);
    const indexes = await queryInterface.showIndex(TABLE);
    if (!indexes.some((i) => i.name === INDEX)) {
      await queryInterface.addIndex(TABLE, [COLUMN], { name: INDEX, unique: true });
    }
  },

  async down(queryInterface) {
    const indexes = await queryInterface.showIndex(TABLE);
    if (indexes.some((i) => i.name === INDEX)) {
      await queryInterface.removeIndex(TABLE, INDEX);
    }
    const cols = await queryInterface.describeTable(TABLE);
    if (cols[COLUMN]) await queryInterface.removeColumn(TABLE, COLUMN);
  }
};
