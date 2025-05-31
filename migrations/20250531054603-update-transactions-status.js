'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.sequelize.query(
        `UPDATE transactions SET status = 'failed' WHERE status = 'payment failed'`,
        { transaction }
      );

      const currentEnumValues = [
        'pending',
        'completed',
        'cash pending',
        'cash completed',
        'cancelled',
        'admin cancelled',
        'credited',
        'authorized',
        'captured',
        'failed' // New value
      ];

      await queryInterface.changeColumn(
        'transactions',
        'status',
        {
          type: Sequelize.ENUM(currentEnumValues),
          allowNull: false
        },
        { transaction }
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.sequelize.query(
        `UPDATE transactions SET status = 'payment failed' WHERE status = 'failed'`,
        { transaction }
      );

      const originalEnumValues = [
        'pending',
        'completed',
        'cash pending',
        'cash completed',
        'cancelled',
        'admin cancelled',
        'credited',
        'authorized',
        'captured',
        'payment failed' // Original value
      ];

      await queryInterface.changeColumn(
        'transactions',
        'status',
        {
          type: Sequelize.ENUM(originalEnumValues),
          allowNull: false
        },
        { transaction }
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
};
