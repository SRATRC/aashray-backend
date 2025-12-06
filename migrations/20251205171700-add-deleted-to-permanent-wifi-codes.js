'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Add new enum value 'deleted' to status column
    await queryInterface.sequelize.query(`
      ALTER TABLE permanent_wifi_codes
      MODIFY COLUMN status ENUM(
        'pending',
        'approved',
        'rejected',
        'reset',
        'deleted'
      ) NOT NULL DEFAULT 'pending';
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE permanent_wifi_codes
      MODIFY COLUMN status ENUM(
        'pending',
        'approved',
        'rejected',
        'reset'
      ) NOT NULL DEFAULT 'pending';
    `);
  }
};
