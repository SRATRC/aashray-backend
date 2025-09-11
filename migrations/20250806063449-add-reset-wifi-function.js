'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.query(`
      ALTER TABLE permanent_wifi_codes
      MODIFY COLUMN status ENUM('pending', 'approved', 'rejected', 'reset') NOT NULL;
    `);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.query(`
      ALTER TABLE permanent_wifi_codes
      MODIFY COLUMN status ENUM('pending', 'approved', 'rejected') NOT NULL;
    `);
  }
};
