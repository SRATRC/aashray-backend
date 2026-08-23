'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const tableInfo = await queryInterface.describeTable('custom_form_drafts');
    if (!tableInfo.mobno) {
      await queryInterface.addColumn('custom_form_drafts', 'mobno', {
        type: Sequelize.STRING,
        allowNull: true
      });
    }
  },

  down: async (queryInterface, Sequelize) => {
    const tableInfo = await queryInterface.describeTable('custom_form_drafts');
    if (tableInfo.mobno) {
      await queryInterface.removeColumn('custom_form_drafts', 'mobno');
    }
  }
};
