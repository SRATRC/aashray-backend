'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('flatdb', 'last_deep_cleaning', {
      type: Sequelize.DATEONLY,
      allowNull: true
    });
    await queryInterface.addColumn('flatdb', 'deep_cleaning_interval', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 90
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('flatdb', 'last_deep_cleaning');
    await queryInterface.removeColumn('flatdb', 'deep_cleaning_interval');
  }
};
