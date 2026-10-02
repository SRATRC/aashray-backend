'use strict';

module.exports = {

  async up(
    queryInterface,
    Sequelize
  ) {

    await queryInterface.addColumn(

      'travel_bus_passengers',

      'boarded',

      {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
      }
    );

    await queryInterface.addColumn(

      'travel_bus_passengers',

      'boarded_at',

      {
        type: Sequelize.DATE,
        allowNull: true,
      }
    );
  },

  async down(
    queryInterface
  ) {

    await queryInterface.removeColumn(
      'travel_bus_passengers',
      'boarded'
    );

    await queryInterface.removeColumn(
      'travel_bus_passengers',
      'boarded_at'
    );
  },
};