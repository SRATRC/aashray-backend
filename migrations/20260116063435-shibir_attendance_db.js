'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('shibir_attendance_db', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true
      },

      shibir_id: {
        type: Sequelize.INTEGER,
        allowNull: false
      },

      bookingid: {
        type: Sequelize.STRING(255),
        allowNull: false
      },

      cardno: {
        type: Sequelize.STRING(255),
        allowNull: false
      },

      days: {
        type: Sequelize.INTEGER,
        allowNull: false
      },

      session_1: {
        type: Sequelize.BOOLEAN,
        defaultValue: true
      },
      session_1_attendance: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },

      session_2: {
        type: Sequelize.BOOLEAN,
        defaultValue: true
      },
      session_2_attendance: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },

      session_3: {
        type: Sequelize.BOOLEAN,
        defaultValue: true
      },
      session_3_attendance: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },

      session_4: {
        type: Sequelize.BOOLEAN,
        defaultValue: true
      },
      session_4_attendance: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },

      session_5: {
        type: Sequelize.BOOLEAN,
        defaultValue: true
      },
      session_5_attendance: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },

      session_6: {
        type: Sequelize.BOOLEAN,
        defaultValue: true
      },
      session_6_attendance: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },

      updatedBy: {
        type: Sequelize.STRING(255),
        allowNull: true
      },

      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },

      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal(
          'CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
        )
      }
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('shibir_attendance_db');
  }
};
