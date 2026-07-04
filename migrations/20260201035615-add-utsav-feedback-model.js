'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('utsav_feedback', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },

      cardno: {
        type: Sequelize.STRING,
        allowNull: false,
        references: {
          model: 'card_db',
          key: 'cardno'
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      },

      utsav_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'utsav_db',
          key: 'id'
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      },

      accommodation_rating: {
        type: Sequelize.INTEGER,
        allowNull: false
      },

      qr_rating: {
        type: Sequelize.INTEGER,
        allowNull: false
      },

      food_rating: {
        type: Sequelize.INTEGER,
        allowNull: false
      },

      program_rating: {
        type: Sequelize.INTEGER,
        allowNull: false
      },

      volunteer_rating: {
        type: Sequelize.INTEGER,
        allowNull: false
      },

      infrastructure_rating: {
        type: Sequelize.INTEGER,
        allowNull: false
      },

      decor_rating: {
        type: Sequelize.INTEGER,
        allowNull: false
      },

      internal_transport_rating: {
        type: Sequelize.INTEGER,
        allowNull: false
      },

      raj_pravas_rating: {
        type: Sequelize.INTEGER,
        allowNull: false
      },

      sparsh_rating: {
        type: Sequelize.INTEGER,
        allowNull: false
      },

      av_rating: {
        type: Sequelize.INTEGER,
        allowNull: false
      },

      loved_most: {
        type: Sequelize.TEXT,
        allowNull: false
      },

      improvement_suggestions: {
        type: Sequelize.TEXT,
        allowNull: false
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

    await queryInterface.addConstraint('utsav_feedback', {
      fields: ['utsav_id', 'cardno'],
      type: 'unique',
      name: 'unique_feedback_per_user_per_utsav'
    });

    await queryInterface.addIndex('utsav_feedback', ['utsav_id']);
    await queryInterface.addIndex('utsav_feedback', ['cardno']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('utsav_feedback');
  }
};
