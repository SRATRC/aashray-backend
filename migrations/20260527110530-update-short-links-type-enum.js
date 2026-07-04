'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {

    await queryInterface.changeColumn(
      'short_links',
      'type',
      {
        type: Sequelize.ENUM(
          'accounts',
          'room',
          'card',
          'office',
          'food',
          'adhyayan',
          'travel',
          'utsav',
          'avt',
          'wifi'
        ),
        allowNull: false,
        defaultValue: 'wifi'
      }
    );
  },

  async down(queryInterface, Sequelize) {

    await queryInterface.changeColumn(
      'short_links',
      'type',
      {
        type: Sequelize.ENUM(
          'wifi',
          'video',
          'external',
          'form'
        ),
        allowNull: false,
        defaultValue: 'external'
      }
    );
  }
};