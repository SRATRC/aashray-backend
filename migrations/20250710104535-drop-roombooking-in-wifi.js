'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.removeConstraint('wifi_pwd', 'wifi_pwd_ibfk_2');
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.addConstraint('wifi_pwd', {
      fields: ['roombookingid'],
      type: 'foreign key',
      name: 'wifi_pwd_ibfk_2',
      references: {
        table: 'room_booking',
        field: 'bookingid'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });
  }
};
