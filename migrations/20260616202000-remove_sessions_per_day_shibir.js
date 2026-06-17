'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tableDescription = await queryInterface.describeTable('shibir_db');
    if (tableDescription.sessions_per_day) {
      await queryInterface.removeColumn('shibir_db', 'sessions_per_day');
    }
  },

  async down(queryInterface, Sequelize) {
    const tableDescription = await queryInterface.describeTable('shibir_db');
    if (!tableDescription.sessions_per_day) {
      await queryInterface.addColumn('shibir_db', 'sessions_per_day', {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 3
      });
    }
  }
};
