'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('bulk_food_booking', 'breakfast_plate_issued', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });

    await queryInterface.addColumn('bulk_food_booking', 'lunch_plate_issued', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });

    await queryInterface.addColumn('bulk_food_booking', 'dinner_plate_issued', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('bulk_food_booking', 'breakfast_plate_issued');
    await queryInterface.removeColumn('bulk_food_booking', 'lunch_plate_issued');
    await queryInterface.removeColumn('bulk_food_booking', 'dinner_plate_issued');
  }
};
