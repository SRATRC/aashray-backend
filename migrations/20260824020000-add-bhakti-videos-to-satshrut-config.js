'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('satshrut_config', 'bhakti_videos', {
      type: Sequelize.JSON,
      allowNull: true,
      defaultValue: null,
      comment:
        'Array of 4 Bhakti video objects [{youtube_id, youtube_url, start_seconds, end_seconds}] ' +
        'played on Mondays in continuous rolling 4-week rotation across month boundaries.'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('satshrut_config', 'bhakti_videos');
  }
};
