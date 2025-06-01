'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('utsav_db', 'location', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: 'Research Centre'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('utsav_db', 'location');
  }
};
