'use strict';

/**
 * Adds a machine-readable reason (and optional structured detail) explaining
 * why a booking is in `waiting`, so admins can triage the waitlist by cause and
 * clients can show users an accurate status. Reason is orthogonal to `status`.
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    for (const table of ['room_booking', 'flat_booking']) {
      // Idempotent: skip columns that already exist.
      const cols = await queryInterface.describeTable(table);
      if (!cols.hold_reason) {
        await queryInterface.addColumn(table, 'hold_reason', {
          type: Sequelize.STRING,
          allowNull: true
        });
      }
      if (!cols.hold_reason_meta) {
        await queryInterface.addColumn(table, 'hold_reason_meta', {
          type: Sequelize.JSON,
          allowNull: true
        });
      }
    }
  },

  async down(queryInterface, Sequelize) {
    for (const table of ['room_booking', 'flat_booking']) {
      const cols = await queryInterface.describeTable(table);
      if (cols.hold_reason) await queryInterface.removeColumn(table, 'hold_reason');
      if (cols.hold_reason_meta) await queryInterface.removeColumn(table, 'hold_reason_meta');
    }
  }
};
