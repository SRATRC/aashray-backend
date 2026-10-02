'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('satshrut_sessions', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false
      },
      session_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
        unique: true
      },
      youtube_video_id: {
        type: Sequelize.STRING,
        allowNull: false
      },
      youtube_url: {
        type: Sequelize.STRING(500),
        allowNull: true
      },
      video_start_seconds: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      video_end_seconds: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      youtube2_video_id: {
        type: Sequelize.STRING,
        allowNull: true
      },
      youtube2_url: {
        type: Sequelize.STRING(500),
        allowNull: true
      },
      video2_start_seconds: {
        type: Sequelize.INTEGER,
        allowNull: true
      },
      video2_end_seconds: {
        type: Sequelize.INTEGER,
        allowNull: true
      },
      audio1_youtube_id: {
        type: Sequelize.STRING,
        allowNull: true
      },
      audio1_youtube_url: {
        type: Sequelize.STRING(500),
        allowNull: true
      },
      audio2_youtube_id: {
        type: Sequelize.STRING,
        allowNull: true
      },
      audio2_youtube_url: {
        type: Sequelize.STRING(500),
        allowNull: true
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      notes2: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      status: {
        type: Sequelize.ENUM('active', 'inactive'),
        allowNull: false,
        defaultValue: 'active'
      },
      created_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'admin_users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal(
          'CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
        )
      }
    });

    await queryInterface.addIndex('satshrut_sessions', ['session_date']);
    await queryInterface.addIndex('satshrut_sessions', ['status']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('satshrut_sessions');
  }
};
