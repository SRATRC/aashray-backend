'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('room_block', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      roomno: {
        type: Sequelize.STRING,
        allowNull: false,
        references: {
          model: 'roomdb',
          key: 'roomno'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      start_date: {
        type: Sequelize.DATEONLY,
        allowNull: false
      },
      end_date: {
        type: Sequelize.DATEONLY,
        allowNull: true
        // NULL = permanent block
      },
      reason: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      status: {
        type: Sequelize.ENUM('active', 'cancelled'),
        allowNull: false,
        defaultValue: 'active'
      },
      createdBy: {
        type: Sequelize.STRING,
        allowNull: false
      },
      updatedBy: {
        type: Sequelize.STRING,
        allowNull: false
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

    // Migrate existing permanently-blocked rooms into room_block
    await queryInterface.sequelize.query(`
      INSERT INTO room_block (roomno, start_date, end_date, reason, status, createdBy, updatedBy, createdAt, updatedAt)
      SELECT roomno,
             CURDATE(),
             NULL,
             'Migrated from legacy permanent block',
             'active',
             'system',
             'system',
             NOW(),
             NOW()
      FROM roomdb
      WHERE roomstatus = 'blocked'
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('room_block');
  }
};
