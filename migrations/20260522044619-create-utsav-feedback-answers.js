'use strict';

// Returns true if an index with the given name already exists on the table.
// Keeps this migration idempotent when the schema is already present but
// unrecorded in SequelizeMeta.
async function indexExists(queryInterface, tableName, indexName) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT COUNT(*) AS count FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :tableName AND INDEX_NAME = :indexName`,
    { replacements: { tableName, indexName } }
  );
  return Number(rows[0].count) > 0;
}

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

    if (
      !(await indexExists(
        queryInterface,
        'utsav_feedback_answers',
        'utsav_feedback_answers_feedback_id'
      ))
    ) {
      await queryInterface.addIndex('utsav_feedback_answers', ['feedback_id']);
    }

    if (
      !(await indexExists(
        queryInterface,
        'utsav_feedback_answers',
        'utsav_feedback_answers_question_id'
      ))
    ) {
      await queryInterface.addIndex('utsav_feedback_answers', ['question_id']);
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('utsav_feedback_answers');
  }
};