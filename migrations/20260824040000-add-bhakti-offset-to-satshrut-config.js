'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('satshrut_config', 'bhakti_offset', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
      comment: 'Offset (0–3) to shift the Monday Bhakti 4-video rotation forward or backward'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('satshrut_config', 'bhakti_offset');
  }
};
