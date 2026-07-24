'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('flatdb', 'last_deep_cleaning', {
      type: Sequelize.DATE,
      allowNull: true
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('flatdb', 'last_deep_cleaning', {
      type: Sequelize.DATEONLY,
      allowNull: true
    });
  }
};
