'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('flat_booking', 'bookedBy', {
      type: Sequelize.STRING,
      allowNull: true,
      references: {
        model: 'card_db',
        key: 'cardno'
      }
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('flat_booking', 'bookedBy');
  }
};
