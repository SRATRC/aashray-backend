'use strict';

/**
 * Adds `allow_waitlist` boolean to `blockdates` table so admins can toggle
 * whether an RC closure permits waitlist bookings (true) or completely blocks bookings (false).
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('blockdates', 'allow_waitlist', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('blockdates', 'allow_waitlist');
  }
};
