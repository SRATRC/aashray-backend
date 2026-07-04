'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {

    await queryInterface.createTable(
      'travel_bus_stops',
      {

        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.UUIDV4,
          primaryKey: true,
          allowNull: false,
        },

        bus_group_id: {
          type: Sequelize.UUID,
          allowNull: false,

          references: {
            model: 'travel_bus_group',
            key: 'id',
          },

          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },

        stop_name: {
          type: Sequelize.STRING,
          allowNull: false,
        },

        stop_order: {
          type: Sequelize.INTEGER,
          allowNull: false,
        },

        createdAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue:
            Sequelize.literal(
              'CURRENT_TIMESTAMP'
            ),
        },

        updatedAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue:
            Sequelize.literal(
              'CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
            ),
        },
      }
    );

    // OPTIONAL INDEXES

    await queryInterface.addIndex(
      'travel_bus_stops',
      ['bus_group_id']
    );

    await queryInterface.addIndex(
      'travel_bus_stops',
      ['stop_order']
    );
  },

  async down(queryInterface) {

    await queryInterface.dropTable(
      'travel_bus_stops'
    );
  },
};