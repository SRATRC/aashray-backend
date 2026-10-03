'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tableInfo = await queryInterface.describeTable('card_db');
    if (!tableInfo.department) {
      // Disable strict mode for this session to avoid '0000-00-00' date issues,
      // then put it back so later migrations on this connection stay strict.
      const [[{ mode }]] = await queryInterface.sequelize.query(
        'SELECT @@SESSION.sql_mode AS mode'
      );
      await queryInterface.sequelize.query("SET SESSION sql_mode = ''");
      try {
        await queryInterface.addColumn('card_db', 'department', {
          type: Sequelize.STRING,
          allowNull: true,
          defaultValue: null
        });
      } finally {
        await queryInterface.sequelize.query('SET SESSION sql_mode = :mode', {
          replacements: { mode }
        });
      }
    }
  },

  async down(queryInterface) {
    const tableInfo = await queryInterface.describeTable('card_db');
    if (tableInfo.department) {
      await queryInterface.removeColumn('card_db', 'department');
    }
  }
};
