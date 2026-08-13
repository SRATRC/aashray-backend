'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Add scheduledAt column
    const tableInfo = await queryInterface.describeTable('wa_group_jobs');
    if (!tableInfo.scheduledAt) {
      await queryInterface.addColumn('wa_group_jobs', 'scheduledAt', {
        type: Sequelize.DATE,
        allowNull: true
      });
    }

    // 2. Modify action ENUM to support send_poll and fetch_members
    await queryInterface.sequelize.query(`
      ALTER TABLE wa_group_jobs 
      MODIFY COLUMN action ENUM('create_group', 'add_member', 'remove_member', 'send_message', 'send_poll', 'fetch_members') NOT NULL;
    `);
  },

  async down(queryInterface, Sequelize) {
    // 1. Revert action ENUM
    await queryInterface.sequelize.query(`
      ALTER TABLE wa_group_jobs 
      MODIFY COLUMN action ENUM('create_group', 'add_member', 'remove_member', 'send_message') NOT NULL;
    `);

    // 2. Remove scheduledAt column
    await queryInterface.removeColumn('wa_group_jobs', 'scheduledAt');
  }
};
