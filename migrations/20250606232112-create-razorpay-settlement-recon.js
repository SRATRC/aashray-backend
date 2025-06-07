'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('razorpay_settlement_recon', {
      payment_id: {
        type: Sequelize.STRING,
        allowNull: false,
        primaryKey: true,
      },
      order_id: {
        type: Sequelize.STRING,
        allowNull: false,
        primaryKey: true,
      },
      amount: {
        type: Sequelize.FLOAT,
        allowNull: false,
      },
      fees: {
        type: Sequelize.FLOAT,
        allowNull: false,
      },
      tax: {
        type: Sequelize.FLOAT,
        allowNull: true,
      },
      credit_amount: {
        type: Sequelize.FLOAT,
        allowNull: false,
      },
      payment_notes: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      settlement_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      settled_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      settlement_utr: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW')
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW')
      }
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('razorpay_settlement_recon');
  }
};
