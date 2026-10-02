'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Create wa_sessions table
    await queryInterface.createTable('wa_sessions', {
      id: {
        type: Sequelize.STRING(255),
        allowNull: false,
        primaryKey: true
      },
      creds: {
        type: Sequelize.JSON,
        allowNull: true
      },
      keys: {
        type: Sequelize.JSON,
        allowNull: true
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW')
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW')
      }
    });

    // 2. Create wa_group_jobs table
    await queryInterface.createTable('wa_group_jobs', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      action: {
        type: Sequelize.ENUM('create_group', 'add_member', 'remove_member', 'send_message'),
        allowNull: false
      },
      phone: {
        type: Sequelize.STRING(50),
        allowNull: true
      },
      groupJid: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      status: {
        type: Sequelize.ENUM('pending', 'processing', 'success', 'failed'),
        defaultValue: 'pending',
        allowNull: false
      },
      attempts: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false
      },
      error: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      payload: {
        type: Sequelize.JSON,
        allowNull: true
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW')
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW')
      }
    });

    // 3. Add whatsapp_group_jid column to utsav_db
    const utsavTableInfo = await queryInterface.describeTable('utsav_db');
    if (!utsavTableInfo.whatsapp_group_jid) {
      await queryInterface.addColumn('utsav_db', 'whatsapp_group_jid', {
        type: Sequelize.STRING(255),
        allowNull: true
      });
    }

    // 4. Add whatsapp_group_jid column to shibir_db
    const shibirTableInfo = await queryInterface.describeTable('shibir_db');
    if (!shibirTableInfo.whatsapp_group_jid) {
      await queryInterface.addColumn('shibir_db', 'whatsapp_group_jid', {
        type: Sequelize.STRING(255),
        allowNull: true
      });
    }
  },

  async down(queryInterface, Sequelize) {
    // 1. Remove whatsapp_group_jid from shibir_db
    const shibirTableInfo = await queryInterface.describeTable('shibir_db');
    if (shibirTableInfo.whatsapp_group_jid) {
      await queryInterface.removeColumn('shibir_db', 'whatsapp_group_jid');
    }

    // 2. Remove whatsapp_group_jid from utsav_db
    const utsavTableInfo = await queryInterface.describeTable('utsav_db');
    if (utsavTableInfo.whatsapp_group_jid) {
      await queryInterface.removeColumn('utsav_db', 'whatsapp_group_jid');
    }

    // 3. Drop tables
    await queryInterface.dropTable('wa_group_jobs');
    await queryInterface.dropTable('wa_sessions');
  }
};
