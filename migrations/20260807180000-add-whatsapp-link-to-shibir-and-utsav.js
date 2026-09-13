'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    for (const table of ['shibir_db', 'utsav_db']) {
      const tableInfo = await queryInterface.describeTable(table);
      if (!tableInfo.whatsapp_link) {
        await queryInterface.addColumn(table, 'whatsapp_link', {
          type: Sequelize.STRING,
          allowNull: true
        });
      }
    }
  },

  async down(queryInterface, Sequelize) {
    for (const table of ['shibir_db', 'utsav_db']) {
      const tableInfo = await queryInterface.describeTable(table);
      if (tableInfo.whatsapp_link) {
        await queryInterface.removeColumn(table, 'whatsapp_link');
      }
    }
  }
};

