'use strict';

module.exports = {

  async up(queryInterface, Sequelize) {

    await queryInterface.addColumn(
      'coordinator_login_otp',
      'attempts',
      {

        type:
          Sequelize.INTEGER,

        allowNull:
          false,

        defaultValue:
          0,
      }
    );
  },

  async down(queryInterface) {

    await queryInterface.removeColumn(
      'coordinator_login_otp',
      'attempts'
    );
  },
};