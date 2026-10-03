'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // The app's startup sync may have created it before migrations ran.
    const tables = await queryInterface.showAllTables();
    if (tables.includes('device_telemetry')) return;
    await queryInterface.createTable('device_telemetry', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false
      },

      cardno: {
        type: Sequelize.STRING,
        allowNull: true
      },

      platform: {
        type: Sequelize.ENUM('android', 'ios'),
        allowNull: false
      },

      app_version: {
        type: Sequelize.STRING,
        allowNull: true
      },

      os_version: {
        type: Sequelize.STRING,
        allowNull: true
      },

      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },

      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal(
          'CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
        )
      }
    });

    // One row per (user, platform); upserted on each seen request.
    await queryInterface.addIndex('device_telemetry', ['cardno', 'platform'], {
      unique: true,
      name: 'device_telemetry_cardno_platform_unique'
    });
    // Supports orphan-sizing queries: active devices per platform by OS version.
    await queryInterface.addIndex('device_telemetry', [
      'platform',
      'os_version'
    ]);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('device_telemetry');
  }
};
