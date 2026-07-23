'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Modify room_booking status enum and add extra_stay_reason column
    await queryInterface.sequelize.query(`
      ALTER TABLE room_booking
      MODIFY COLUMN status ENUM('waiting', 'pending', 'pending checkin', 'checkedin', 'checkedout', 'cancelled', 'admin cancelled', 'awaiting confirmation') NOT NULL;
    `);
    await queryInterface.addColumn('room_booking', 'extra_stay_reason', {
      type: Sequelize.TEXT,
      allowNull: true
    });

    // 2. Modify flat_booking status enum and add extra_stay_reason column
    await queryInterface.sequelize.query(`
      ALTER TABLE flat_booking
      MODIFY COLUMN status ENUM('waiting', 'pending', 'pending checkin', 'checkedin', 'checkedout', 'cancelled', 'admin cancelled', 'awaiting confirmation') NOT NULL;
    `);
    await queryInterface.addColumn('flat_booking', 'extra_stay_reason', {
      type: Sequelize.TEXT,
      allowNull: true
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('room_booking', 'extra_stay_reason');
    await queryInterface.sequelize.query(`
      ALTER TABLE room_booking
      MODIFY COLUMN status ENUM('waiting', 'pending', 'pending checkin', 'checkedin', 'checkedout', 'cancelled', 'admin cancelled') NOT NULL;
    `);

    await queryInterface.removeColumn('flat_booking', 'extra_stay_reason');
    await queryInterface.sequelize.query(`
      ALTER TABLE flat_booking
      MODIFY COLUMN status ENUM('waiting', 'pending', 'pending checkin', 'checkedin', 'checkedout', 'cancelled', 'admin cancelled') NOT NULL;
    `);
  }
};
