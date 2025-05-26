'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Add new enum values including 'admin_cancelled', 'cash_pending', 'cash_completed'
    await queryInterface.sequelize.query(`
      ALTER TABLE utsav_booking
      MODIFY COLUMN status ENUM('confirmed', 'cancelled', 'pending', 'waiting', 'admin cancelled', 'cash pending', 'cash completed') NOT NULL DEFAULT 'pending';
    `);
  },

  async down(queryInterface, Sequelize) {
    // Rollback: remove the newly added enum values
    await queryInterface.sequelize.query(`
      ALTER TABLE utsav_booking
      MODIFY COLUMN status ENUM('confirmed', 'cancelled', 'pending', 'waiting') NOT NULL DEFAULT 'pending';
    `);
  }
};
