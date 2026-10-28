'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('travel_db', 'trip_group_id', {
      type: Sequelize.STRING,
      allowNull: true,
      defaultValue: null
    });
    await queryInterface.addIndex('travel_db', ['trip_group_id'], {
      name: 'travel_db_trip_group_id_idx'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('travel_db', 'travel_db_trip_group_id_idx');
    await queryInterface.removeColumn('travel_db', 'trip_group_id');
  }
};
