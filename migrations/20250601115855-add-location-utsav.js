'use strict';

const { RESEARCH_CENTRE } = require('../config/constants');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('utsav_db', 'location', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: RESEARCH_CENTRE
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('utsav_db', 'location');
  }
};
