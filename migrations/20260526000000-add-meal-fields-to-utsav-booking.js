'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('utsav_db', 'starting_meal', {
      type: Sequelize.JSON,
      allowNull: true
    });

    await queryInterface.addColumn('utsav_db', 'ending_meal', {
      type: Sequelize.JSON,
      allowNull: true
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('utsav_db', 'starting_meal');
    await queryInterface.removeColumn('utsav_db', 'ending_meal');
  }
};
