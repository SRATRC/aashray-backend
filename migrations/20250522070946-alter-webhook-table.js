'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('razorpay_webhook', 'payment_id', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: ''
    });

    await queryInterface.addColumn('razorpay_webhook', 'order_id', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: ''
    });

    await queryInterface.addColumn('razorpay_webhook', 'status', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: ''
    });

    await queryInterface.addIndex('razorpay_webhook', ['payment_id'], {
      name: 'razorpay_webhook_payment_id_idx'
    });

    await queryInterface.addIndex('razorpay_webhook', ['order_id', 'status'], {
      name: 'razorpay_webhook_order_id_status_idx',
      unique: true
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex(
      'razorpay_webhook',
      'razorpay_webhook_order_id_status_idx'
    );
    await queryInterface.removeIndex(
      'razorpay_webhook',
      'razorpay_webhook_payment_id_idx'
    );

    await queryInterface.removeColumn('razorpay_webhook', 'status');
    await queryInterface.removeColumn('razorpay_webhook', 'order_id');
    await queryInterface.removeColumn('razorpay_webhook', 'payment_id');
  }
};
