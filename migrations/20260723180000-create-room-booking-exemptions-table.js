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
    if (existing.includes('room_booking_exemptions')) return;
    await queryInterface.createTable('room_booking_exemptions', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      cardno: {
        type: Sequelize.STRING,
        allowNull: false,
        references: {
          model: 'card_db',
          key: 'cardno'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      is_permanent: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      valid_from: {
        type: Sequelize.DATEONLY,
        allowNull: true
      },
      valid_to: {
        type: Sequelize.DATEONLY,
        allowNull: true
      },
      reason: {
        type: Sequelize.STRING(255),
        allowNull: true
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
    await queryInterface.dropTable('room_booking_exemptions');
  }
};
