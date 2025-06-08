'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.removeIndex(
      'razorpay_webhook',
      'razorpay_webhook_order_id_status'
    );
    await queryInterface.removeIndex(
      'razorpay_webhook',
      'razorpay_webhook_order_id_status_idx'
    );
    await queryInterface.removeIndex(
      'razorpay_webhook',
      'razorpay_webhook_payment_id_idx'
    );
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addIndex('razorpay_webhook', ['order_id', 'status'], {
      name: 'razorpay_webhook_order_id_status_idx',
      unique: true
    });
    await queryInterface.addIndex('razorpay_webhook', ['payment_id'], {
      name: 'razorpay_webhook_payment_id_idx'
    });
  }
};
