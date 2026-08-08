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

  async down(queryInterface, Sequelize) {
    const shibirTable = await queryInterface.describeTable('shibir_db');
    if (shibirTable.whatsapp_link) {
      await queryInterface.removeColumn('shibir_db', 'whatsapp_link');
    }

    const utsavTable = await queryInterface.describeTable('utsav_db');
    if (utsavTable.whatsapp_link) {
      await queryInterface.removeColumn('utsav_db', 'whatsapp_link');
    }
  }
};
