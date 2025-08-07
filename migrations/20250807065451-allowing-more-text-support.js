'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.changeColumn('support_tickets', 'issue', {
      type: Sequelize.TEXT,
      allowNull: false
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.changeColumn('support_tickets', 'issue', {
      type: Sequelize.STRING,
      allowNull: false
    });
  }
};
