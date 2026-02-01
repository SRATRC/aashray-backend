
'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('utsav_feedback', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },

      cardno: {
        type: Sequelize.STRING(20),
        allowNull: false,
      },

      utsav_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },

      mumukshu_name: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },

      accommodation_type: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },

      room_number: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },

      accommodation_rating: {
        type: Sequelize.TINYINT,
        allowNull: false,
      },

      qr_rating: {
        type: Sequelize.TINYINT,
        allowNull: false,
      },

      food_rating: {
        type: Sequelize.TINYINT,
        allowNull: false,
      },

      program_rating: {
        type: Sequelize.TINYINT,
        allowNull: false,
      },

      volunteer_rating: {
        type: Sequelize.TINYINT,
        allowNull: false,
      },

      infrastructure_rating: {
        type: Sequelize.TINYINT,
        allowNull: false,
      },

      decor_rating: {
        type: Sequelize.TINYINT,
        allowNull: false,
      },

      internal_transport_rating: {
        type: Sequelize.TINYINT,
        allowNull: false,
      },

      raj_pravas_rating: {
        type: Sequelize.TINYINT,
        allowNull: false,
      },

      sparsh_rating: {
        type: Sequelize.TINYINT,
        allowNull: false,
      },

      av_rating: {
        type: Sequelize.TINYINT,
        allowNull: false,
      },

      loved_most: {
        type: Sequelize.TEXT,
        allowNull: false,
      },

      improvement_suggestions: {
        type: Sequelize.TEXT,
        allowNull: false,
      },

      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },

      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal(
          'CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
        ),
      },
    });

    // Prevent duplicate feedback per user per utsav
    await queryInterface.addConstraint('utsav_feedback', {
      fields: ['utsav_id', 'cardno'],
      type: 'unique',
      name: 'unique_utsav_feedback_per_user',
    });

    await queryInterface.addIndex('utsav_feedback', ['utsav_id']);
    await queryInterface.addIndex('utsav_feedback', ['cardno']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('utsav_feedback');
  },
};

