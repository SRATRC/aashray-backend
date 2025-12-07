'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('permanent_wifi_codes', 'username', {
      type: Sequelize.STRING,
      allowNull: false,
      unique: true,
      defaultValue: '', // Default for existing records to avoid errors
      comment: 'The username of the user for that device'
    });

    await queryInterface.addColumn('permanent_wifi_codes', 'ssid', {
      type: Sequelize.STRING,
      allowNull: true,
      comment: 'The SSID of the WiFi network'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('permanent_wifi_codes', 'ssid');
    await queryInterface.removeColumn('permanent_wifi_codes', 'username');
  }
};
