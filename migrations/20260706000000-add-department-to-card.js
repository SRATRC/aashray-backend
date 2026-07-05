'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tableInfo = await queryInterface.describeTable('card_db');
    if (!tableInfo.department) {
      // Disable strict mode for this session to avoid '0000-00-00' date issues
      await queryInterface.sequelize.query("SET SESSION sql_mode = ''");
      await queryInterface.addColumn('card_db', 'department', {
        type: Sequelize.STRING,
        allowNull: true,
        defaultValue: null
      });
    }
  },

  async down(queryInterface) {
    const tableInfo = await queryInterface.describeTable('card_db');
    if (tableInfo.department) {
      await queryInterface.removeColumn('card_db', 'department');
    }
  }
};
