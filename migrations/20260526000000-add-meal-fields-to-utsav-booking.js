'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tableInfo = await queryInterface.describeTable('utsav_db');
    
    if (!tableInfo.starting_meal) {
      await queryInterface.addColumn('utsav_db', 'starting_meal', {
        type: Sequelize.JSON,
        allowNull: true
      });
    }

    if (!tableInfo.ending_meal) {
      await queryInterface.addColumn('utsav_db', 'ending_meal', {
        type: Sequelize.JSON,
        allowNull: true
      });
    }
  },

  async down(queryInterface) {
    const tableInfo = await queryInterface.describeTable('utsav_db');

    if (tableInfo.starting_meal) {
      await queryInterface.removeColumn('utsav_db', 'starting_meal');
    }
    
    if (tableInfo.ending_meal) {
      await queryInterface.removeColumn('utsav_db', 'ending_meal');
    }
  }
};
