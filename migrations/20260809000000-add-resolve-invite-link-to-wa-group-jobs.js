'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE wa_group_jobs
      MODIFY COLUMN action ENUM(
        'create_group',
        'add_member',
        'remove_member',
        'send_message',
        'send_poll',
        'fetch_members',
        'update_group_settings',
        'resolve_invite_link'
      ) NOT NULL;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE wa_group_jobs
      MODIFY COLUMN action ENUM(
        'create_group',
        'add_member',
        'remove_member',
        'send_message',
        'send_poll',
        'fetch_members',
        'update_group_settings'
      ) NOT NULL;
    `);
  }
};

