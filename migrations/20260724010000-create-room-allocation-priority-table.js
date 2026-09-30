'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Idempotent: app.js runs sequelize.sync() on boot, which creates this table
    // from the model when the code ships before the migration runs (that is how
    // prod got it without a SequelizeMeta row). Never fail on that.
    const existing = (await queryInterface.showAllTables()).map((t) =>
      String(typeof t === 'object' ? t.tableName || t.table_name : t).toLowerCase()
    );
    if (existing.includes('room_allocation_priorities')) return;
    await queryInterface.createTable('room_allocation_priorities', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      month: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: 'Month (1-12), NULL represents global default priority'
      },
      priority_order: {
        type: Sequelize.STRING(255),
        allowNull: false,
        defaultValue: 'OAG_1st,OAG_2nd,NAG_1st,NAG_2nd'
      },
      updatedBy: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'ADMIN'
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false
      }
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('room_allocation_priorities');
  }
};
