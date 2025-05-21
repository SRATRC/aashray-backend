'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.removeColumn('transactions', 'razorpay_payment_id');
    await queryInterface.removeColumn('transactions', 'razorpay_fee');
    await queryInterface.removeColumn('transactions', 'razorpay_tax');
    await queryInterface.removeColumn('transactions', 'razorpay_credit_amt');
    await queryInterface.removeColumn('transactions', 'payment_method');
    await queryInterface.removeColumn('transactions', 'razorpay_settlement_id');
    await queryInterface.removeColumn('transactions', 'razorpay_settled_at');
    await queryInterface.removeColumn('transactions', 'settlement_utr');

    await queryInterface.changeColumn('transactions', 'status', {
      type: Sequelize.ENUM(
        'pending',
        'completed',
        'cash pending',
        'cash completed',
        'cancelled',
        'admin cancelled',
        'credited',
        'authorized',
        'captured',
        'payment failed'
      ),
      allowNull: false
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn('transactions', 'razorpay_payment_id', {
      type: Sequelize.STRING,
      allowNull: true
    });
    await queryInterface.addColumn('transactions', 'razorpay_fee', {
      type: Sequelize.FLOAT,
      allowNull: true
    });
    await queryInterface.addColumn('transactions', 'razorpay_tax', {
      type: Sequelize.FLOAT,
      allowNull: true
    });
    await queryInterface.addColumn('transactions', 'razorpay_credit_amt', {
      type: Sequelize.FLOAT,
      allowNull: true
    });
    await queryInterface.addColumn('transactions', 'payment_method', {
      type: Sequelize.STRING,
      allowNull: true
    });
    await queryInterface.addColumn('transactions', 'razorpay_settlement_id', {
      type: Sequelize.STRING,
      allowNull: true
    });
    await queryInterface.addColumn('transactions', 'razorpay_settled_at', {
      type: Sequelize.STRING,
      allowNull: true
    });
    await queryInterface.addColumn('transactions', 'settlement_utr', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: 'NA'
    });

    await queryInterface.changeColumn('transactions', 'status', {
      type: Sequelize.ENUM(
        'pending',
        'completed',
        'cash pending',
        'cash completed',
        'cancelled',
        'admin cancelled',
        'credited'
      ),
      allowNull: false
    });
  }
};
