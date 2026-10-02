'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('travel_bus_passengers', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        allowNull: false,
        primaryKey: true,
      },

      bus_group_id: {
        type: Sequelize.UUID,
        allowNull: false,
      },

      bookingid: {
        type: Sequelize.STRING,
        allowNull: false,
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

    // FK → travel_bus_group.id
    await queryInterface.addConstraint('travel_bus_passengers', {
      fields: ['bus_group_id'],
      type: 'foreign key',
      name: 'fk_travel_bus_passengers_bus_group_id',
      references: {
        table: 'travel_bus_group',
        field: 'id',
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    });

    // FK → travel_db.bookingid
    await queryInterface.addConstraint('travel_bus_passengers', {
      fields: ['bookingid'],
      type: 'foreign key',
      name: 'fk_travel_bus_passengers_bookingid',
      references: {
        table: 'travel_db',
        field: 'bookingid',
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    });

    // Prevent same booking assigned multiple times
    await queryInterface.addConstraint('travel_bus_passengers', {
      fields: ['bookingid'],
      type: 'unique',
      name: 'unique_bookingid_bus_assignment',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('travel_bus_passengers');
  },
};