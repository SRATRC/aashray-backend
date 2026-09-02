'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('satshrut_config', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        allowNull: false,
        defaultValue: 1
      },
      default_audio1_youtube_id: {
        type: Sequelize.STRING,
        allowNull: true
      },
      default_audio2_youtube_id: {
        type: Sequelize.STRING,
        allowNull: true
      },
      no_session_days: {
        type: Sequelize.JSON,
        allowNull: false,
        defaultValue: [1, 4]
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
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('satshrut_config');
  }
};
