'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Add new enum value 'deleted' to status column
    await queryInterface.sequelize.query(`
      ALTER TABLE shibir_db
      MODIFY COLUMN status ENUM(
        'open',
        'closed',
        'deleted'
      ) NOT NULL DEFAULT 'open';
    `);
  },

  async down(queryInterface, Sequelize) {
    // Rollback: remove 'deleted' from status column
    await queryInterface.sequelize.query(`
      ALTER TABLE adhyayan_db
      MODIFY COLUMN status ENUM(
        'open',
        'closed'
      ) NOT NULL DEFAULT 'open';
    `);
  }
};
