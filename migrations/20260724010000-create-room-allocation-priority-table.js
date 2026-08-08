'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
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
