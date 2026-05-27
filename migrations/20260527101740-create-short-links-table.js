'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('short_links', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false
      },

      slug: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true
      },

      target_url: {
        type: Sequelize.TEXT,
        allowNull: false
      },

      type: {
        type: Sequelize.ENUM('wifi', 'video', 'external', 'form'),
        allowNull: false,
        defaultValue: 'external'
      },

      active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true
      },

      click_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0
      },

      createdBy: {
        type: Sequelize.STRING,
        allowNull: true
      },

      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },

      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal(
          'CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
        )
      }
    });

    await queryInterface.addIndex('short_links', ['slug']);
    await queryInterface.addIndex('short_links', ['type']);
    await queryInterface.addIndex('short_links', ['active']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('short_links');

    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS enum_short_links_type;'
    );
  }
};