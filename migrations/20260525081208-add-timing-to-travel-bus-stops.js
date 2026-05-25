'use strict';

module.exports = {

  async up(queryInterface, Sequelize) {

    await queryInterface.addColumn(
      'travel_bus_stops',
      'timing',
      {
        type:
          Sequelize.STRING,

        allowNull:
          true,
      }
    );

    await queryInterface.removeColumn(
      'travel_bus_group',
      'timing'
    );
  },

  async down(queryInterface, Sequelize) {

    await queryInterface.addColumn(
      'travel_bus_group',
      'timing',
      {
        type:
          Sequelize.STRING,

        allowNull:
          true,
      }
    );

    await queryInterface.removeColumn(
      'travel_bus_stops',
      'timing'
    );
  },
};