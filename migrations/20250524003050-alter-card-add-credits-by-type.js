'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.removeColumn('card_db', 'credits');

    await queryInterface.addColumn('card_db', 'credits', {
      type: Sequelize.JSON,
      allowNull: true
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.removeColumn('card_db', 'credits');

    await queryInterface.addColumn('card_db', 'credits', {
      type: Sequelize.DECIMAL,
      allowNull: false,
      defaultValue: 0
    });
  }
};
