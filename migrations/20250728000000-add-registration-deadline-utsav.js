'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('utsav_db', 'registration_deadline', {
      type: Sequelize.DATEONLY,
      allowNull: true,
      comment: 'Registration deadline date - users can only see and register for utsavs before or on this date'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('utsav_db', 'registration_deadline');
  }
};
