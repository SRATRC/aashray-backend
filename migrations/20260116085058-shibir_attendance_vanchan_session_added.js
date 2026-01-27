'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('shibir_attendance_db', 'session_7', {
      type: Sequelize.BOOLEAN,
      defaultValue: false
    });
    await queryInterface.addColumn('shibir_attendance_db', 'session_7_attendance', {
      type: Sequelize.BOOLEAN,
      defaultValue: false
    });

    await queryInterface.addColumn('shibir_attendance_db', 'session_8', {
      type: Sequelize.BOOLEAN,
      defaultValue: false
    });
    await queryInterface.addColumn('shibir_attendance_db', 'session_8_attendance', {
      type: Sequelize.BOOLEAN,
      defaultValue: false
    });

    await queryInterface.addColumn('shibir_attendance_db', 'session_9', {
      type: Sequelize.BOOLEAN,
      defaultValue: false
    });
    await queryInterface.addColumn('shibir_attendance_db', 'session_9_attendance', {
      type: Sequelize.BOOLEAN,
      defaultValue: false
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('shibir_attendance_db', 'session_7');
    await queryInterface.removeColumn('shibir_attendance_db', 'session_7_attendance');
    await queryInterface.removeColumn('shibir_attendance_db', 'session_8');
    await queryInterface.removeColumn('shibir_attendance_db', 'session_8_attendance');
    await queryInterface.removeColumn('shibir_attendance_db', 'session_9');
    await queryInterface.removeColumn('shibir_attendance_db', 'session_9_attendance');
  }
};
