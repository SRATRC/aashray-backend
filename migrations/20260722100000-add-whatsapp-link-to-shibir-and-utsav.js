'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('shibir_db', 'whatsapp_link', {
      type: Sequelize.STRING(255),
      allowNull: true
    });
    await queryInterface.addColumn('utsav_db', 'whatsapp_link', {
      type: Sequelize.STRING(255),
      allowNull: true
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('shibir_db', 'whatsapp_link');
    await queryInterface.removeColumn('utsav_db', 'whatsapp_link');
  }
};
