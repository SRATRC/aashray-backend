'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const tableInfo = await queryInterface.describeTable('custom_form_responses');
    if (!tableInfo.email) {
      await queryInterface.addColumn('custom_form_responses', 'email', {
        type: Sequelize.STRING,
        allowNull: true
      });
    }
  },

  down: async (queryInterface, Sequelize) => {
    const tableInfo = await queryInterface.describeTable('custom_form_responses');
    if (tableInfo.email) {
      await queryInterface.removeColumn('custom_form_responses', 'email');
    }
  }
};
