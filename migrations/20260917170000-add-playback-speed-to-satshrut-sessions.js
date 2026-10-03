'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tableInfo = await queryInterface.describeTable('satshrut_sessions');

    if (!tableInfo.playback_speed) {
      await queryInterface.addColumn('satshrut_sessions', 'playback_speed', {
        type: Sequelize.DECIMAL(3, 2),
        allowNull: false,
        defaultValue: 1.00
      });
    }

    if (!tableInfo.video2_playback_speed) {
      await queryInterface.addColumn('satshrut_sessions', 'video2_playback_speed', {
        type: Sequelize.DECIMAL(3, 2),
        allowNull: true,
        defaultValue: null
      });
    }
  },

  async down(queryInterface) {
    const tableInfo = await queryInterface.describeTable('satshrut_sessions');

    if (tableInfo.video2_playback_speed) {
      await queryInterface.removeColumn('satshrut_sessions', 'video2_playback_speed');
    }

    if (tableInfo.playback_speed) {
      await queryInterface.removeColumn('satshrut_sessions', 'playback_speed');
    }
  }
};
