'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.changeColumn('bulk_food_booking', 'breakfast', {
      type: Sequelize.INTEGER,
      allowNull: false,
    });

    await queryInterface.changeColumn('bulk_food_booking', 'lunch', {
      type: Sequelize.INTEGER,
      allowNull: false,
    });

    await queryInterface.changeColumn('bulk_food_booking', 'dinner', {
      type: Sequelize.INTEGER,
      allowNull: false,
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.changeColumn('bulk_food_booking', 'breakfast', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
    });

    await queryInterface.changeColumn('bulk_food_booking', 'lunch', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
    });

    await queryInterface.changeColumn('bulk_food_booking', 'dinner', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
    });
  }
};
