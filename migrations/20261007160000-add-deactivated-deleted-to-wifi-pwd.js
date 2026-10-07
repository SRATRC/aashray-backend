'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE wifi_pwd
      MODIFY COLUMN status ENUM(
        'active',
        'inactive',
        'deactivated',
        'deleted'
      ) NOT NULL DEFAULT 'active';
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE wifi_pwd
      MODIFY COLUMN status ENUM(
        'active',
        'inactive'
      ) NOT NULL DEFAULT 'active';
    `);
  }
};
