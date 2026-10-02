'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('travel_bus_group', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        allowNull: false,
        primaryKey: true,
      },

      event_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },

      bus_name: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      pickup_point: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      drop_point: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      timing: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      coordinator_bookingid: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      capacity: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },

      notes: {
        type: Sequelize.TEXT,
        allowNull: true,
      },

      createdBy: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW'),
      },

      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW'),
      },
    });


  },

  async down(queryInterface) {
    await queryInterface.dropTable('travel_bus_group');
  },
};