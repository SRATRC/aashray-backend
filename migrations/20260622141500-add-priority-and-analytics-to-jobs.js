'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tableInfo = await queryInterface.describeTable('wa_group_jobs');

    // 1. Add priority column (ENUM: high, normal, low)
    if (!tableInfo.priority) {
      await queryInterface.addColumn('wa_group_jobs', 'priority', {
        type: Sequelize.ENUM('high', 'normal', 'low'),
        defaultValue: 'normal',
        allowNull: false
      });
    }

    // 2. Add msgId column (VARCHAR)
    if (!tableInfo.msgId) {
      await queryInterface.addColumn('wa_group_jobs', 'msgId', {
        type: Sequelize.STRING(255),
        allowNull: true
      });
    }

    // 3. Add deliveredCount column (INTEGER)
    if (!tableInfo.deliveredCount) {
      await queryInterface.addColumn('wa_group_jobs', 'deliveredCount', {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false
      });
    }

    // 4. Add readCount column (INTEGER)
    if (!tableInfo.readCount) {
      await queryInterface.addColumn('wa_group_jobs', 'readCount', {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false
      });
    }

    // 5. Add receipts column (JSON)
    if (!tableInfo.receipts) {
      await queryInterface.addColumn('wa_group_jobs', 'receipts', {
        type: Sequelize.JSON,
        allowNull: true
      });
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('wa_group_jobs', 'priority');
    await queryInterface.removeColumn('wa_group_jobs', 'msgId');
    await queryInterface.removeColumn('wa_group_jobs', 'deliveredCount');
    await queryInterface.removeColumn('wa_group_jobs', 'readCount');
    await queryInterface.removeColumn('wa_group_jobs', 'receipts');
  }
};
