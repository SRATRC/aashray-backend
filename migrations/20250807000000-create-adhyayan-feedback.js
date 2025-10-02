'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('adhyayan_feedback', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      shibir_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'shibir_db',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      cardno: {
        type: Sequelize.STRING,
        allowNull: false,
        references: {
          model: 'card_db',
          key: 'cardno'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      swadhay_karta_rating: {
        type: Sequelize.INTEGER,
        allowNull: false,
        validate: {
          min: 1,
          max: 5
        },
        comment: 'Rating for Swadhay Karta session (1-5 scale)'
      },
      personal_interaction_rating: {
        type: Sequelize.INTEGER,
        allowNull: false,
        validate: {
          min: 1,
          max: 5
        },
        comment: 'Rating for personal interaction with swadhay karta (1-5 scale)'
      },
      swadhay_karta_suggestions: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Suggestions for swadhay karta to improve skills/activity'
      },
      raj_adhyayan_interest: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        comment: 'Interest in attending Raj Adhyayan in future (true/false)'
      },
      future_topics: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Topics for future Raj Adhyayan sessions'
      },
      loved_most: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'What they loved most about this Raj Adhyayan'
      },
      improvement_suggestions: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Other scope of improvement suggestions'
      },
      food_rating: {
        type: Sequelize.INTEGER,
        allowNull: false,
        validate: {
          min: 1,
          max: 5
        },
        comment: 'Rating for food at bhojanalay (1-5 scale)'
      },
      stay_rating: {
        type: Sequelize.INTEGER,
        allowNull: false,
        validate: {
          min: 1,
          max: 5
        },
        comment: 'Rating for stay at Research Centre (1-5 scale)'
      },
      submitted_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      },
      updatedBy: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'USER'
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      }
    });

    // Add unique constraint to prevent duplicate feedback
    await queryInterface.addIndex('adhyayan_feedback', {
      fields: ['shibir_id', 'cardno'],
      unique: true,
      name: 'unique_feedback_per_user_per_adhyayan'
    });

    // Add indexes for better query performance
    await queryInterface.addIndex('adhyayan_feedback', {
      fields: ['shibir_id'],
      name: 'idx_feedback_shibir_id'
    });

    await queryInterface.addIndex('adhyayan_feedback', {
      fields: ['cardno'],
      name: 'idx_feedback_cardno'
    });

    await queryInterface.addIndex('adhyayan_feedback', {
      fields: ['submitted_at'],
      name: 'idx_feedback_submitted_at'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('adhyayan_feedback');
  }
};
