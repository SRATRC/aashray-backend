'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('utsav_feedback_answers', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },

      feedback_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'utsav_feedback',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },

      question_id: {
        type: Sequelize.STRING,
        allowNull: false
      },

      question_text: {
        type: Sequelize.TEXT,
        allowNull: false
      },

      question_type: {
        type: Sequelize.ENUM('rating', 'text'),
        allowNull: false
      },

      answer: {
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
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    await queryInterface.addIndex(
      'utsav_feedback_answers',
      ['feedback_id']
    );

    await queryInterface.addIndex(
      'utsav_feedback_answers',
      ['question_id']
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('utsav_feedback_answers');
  }
};