'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('flatdb', 'deep_cleaning_history', {
      type: Sequelize.JSON,
      allowNull: true
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('flatdb', 'deep_cleaning_history');
  }
};
