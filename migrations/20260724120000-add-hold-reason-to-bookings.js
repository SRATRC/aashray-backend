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
      await queryInterface.addColumn(table, 'hold_reason', {
        type: Sequelize.STRING,
        allowNull: true
      });
      await queryInterface.addColumn(table, 'hold_reason_meta', {
        type: Sequelize.JSON,
        allowNull: true
      });
    }
  },

  async down(queryInterface, Sequelize) {
    for (const table of ['room_booking', 'flat_booking']) {
      await queryInterface.removeColumn(table, 'hold_reason');
      await queryInterface.removeColumn(table, 'hold_reason_meta');
    }
  }
};
