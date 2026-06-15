'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const tableInfo = await queryInterface.describeTable('admin_users');
    if (!tableInfo.cardno) {
      await queryInterface.addColumn('admin_users', 'cardno', {
        type: Sequelize.STRING,
        allowNull: true,
        references: {
          model: 'card_db',
          key: 'cardno'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      });
    }
  },

  down: async (queryInterface, Sequelize) => {
    const tableInfo = await queryInterface.describeTable('admin_users');
    if (tableInfo.cardno) {
      await queryInterface.removeColumn('admin_users', 'cardno');
    }
  }
};
