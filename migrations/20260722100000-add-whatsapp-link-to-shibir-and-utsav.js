'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const shibirTable = await queryInterface.describeTable('shibir_db');
    if (!shibirTable.whatsapp_link) {
      await queryInterface.addColumn('shibir_db', 'whatsapp_link', {
        type: Sequelize.STRING(255),
        allowNull: true
      });
    }

    const utsavTable = await queryInterface.describeTable('utsav_db');
    if (!utsavTable.whatsapp_link) {
      await queryInterface.addColumn('utsav_db', 'whatsapp_link', {
        type: Sequelize.STRING(255),
        allowNull: true
      });
    }
  },

  async down() {
    // Intentionally a no-op. The whatsapp_link columns are owned by
    // 20260807180000-add-whatsapp-link-to-shibir-and-utsav.js; dropping them
    // here would destroy data that migration still expects to exist.
  }
};
