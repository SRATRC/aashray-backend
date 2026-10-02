'use strict';

module.exports = {

  async up(queryInterface, Sequelize) {
    const tableInfo = await queryInterface.describeTable('travel_bus_stops');
    if (!tableInfo.timing) {
      await queryInterface.addColumn(
        'travel_bus_stops',
        'timing',
        {
          type: Sequelize.STRING,
          allowNull: true,
        }
      );
    }

    const groupTableInfo = await queryInterface.describeTable('travel_bus_group');
    if (groupTableInfo.timing) {
      await queryInterface.removeColumn(
        'travel_bus_group',
        'timing'
      );
    }
  },

  async down(queryInterface, Sequelize) {
    const groupTableInfo = await queryInterface.describeTable('travel_bus_group');
    if (!groupTableInfo.timing) {
      await queryInterface.addColumn(
        'travel_bus_group',
        'timing',
        {
          type: Sequelize.STRING,
          allowNull: true,
        }
      );
    }

    const tableInfo = await queryInterface.describeTable('travel_bus_stops');
    if (tableInfo.timing) {
      await queryInterface.removeColumn(
        'travel_bus_stops',
        'timing'
      );
    }
  },
};