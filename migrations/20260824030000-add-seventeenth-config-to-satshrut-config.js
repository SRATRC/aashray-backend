'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('satshrut_config', 'seventeenth_config', {
      type: Sequelize.JSON,
      allowNull: true,
      defaultValue: null,
      comment:
        'Configuration for 17th monthly morning session: ' +
        '{ fixed: { intro_youtube_url, intro_youtube_id, pause1_youtube_url, pause1_youtube_id, pause2_youtube_url, pause2_youtube_id }, ' +
        'monthly: { "YYYY-MM": { bhakti_youtube_url, bhakti_youtube_id, clip1_youtube_url, clip1_youtube_id, clip2_youtube_url, clip2_youtube_id } } }'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('satshrut_config', 'seventeenth_config');
  }
};
