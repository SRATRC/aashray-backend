'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Add new enum value 'checkedin' to status column
    await queryInterface.sequelize.query(`
      ALTER TABLE utsav_booking
      MODIFY COLUMN status ENUM(
        'confirmed',
        'cancelled',
        'pending',
        'waiting',
        'admin cancelled',
        'cash pending',
        'cash completed',
        'checkedin'
      ) NOT NULL DEFAULT 'pending';
    `);
  },

  async down(queryInterface, Sequelize) {
    // Rollback: remove 'checkedin' status
    await queryInterface.sequelize.query(`
      ALTER TABLE utsav_booking
      MODIFY COLUMN status ENUM(
        'confirmed',
        'cancelled',
        'pending',
        'waiting',
        'admin cancelled',
        'cash pending',
        'cash completed'
      ) NOT NULL DEFAULT 'pending';
    `);
  }
};
