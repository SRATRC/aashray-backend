'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const tableInfo = await queryInterface.describeTable('custom_forms');
    if (!tableInfo.event_ids) {
      await queryInterface.addColumn('custom_forms', 'event_ids', {
        type: Sequelize.JSON,
        allowNull: true
      });
    }
    if (!tableInfo.secondary_depts) {
      await queryInterface.addColumn('custom_forms', 'secondary_depts', {
        type: Sequelize.JSON,
        allowNull: true
      });
    }
  },

  down: async (queryInterface, Sequelize) => {
    const tableInfo = await queryInterface.describeTable('custom_forms');
    if (tableInfo.event_ids) {
      await queryInterface.removeColumn('custom_forms', 'event_ids');
    }
    if (tableInfo.secondary_depts) {
      await queryInterface.removeColumn('custom_forms', 'secondary_depts');
    }
  }
};
