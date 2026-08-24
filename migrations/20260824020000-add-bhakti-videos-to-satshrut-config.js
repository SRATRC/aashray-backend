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
        'played on Mondays in weekly rotation (Week 1 → index 0, Week 2 → index 1, … 5th Monday wraps to index 0)'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('satshrut_config', 'bhakti_videos');
  }
};
