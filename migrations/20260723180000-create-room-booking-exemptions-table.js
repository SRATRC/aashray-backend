'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
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
