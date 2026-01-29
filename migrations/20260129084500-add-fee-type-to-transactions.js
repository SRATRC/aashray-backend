'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('transactions', 'amt_type', {
      type: Sequelize.ENUM(
        'late_checkout_room',
        'no_show_food',
        'credits_added',
        'credits_used',
        'cash_txn',
        'upi_txn',
        'department_txn',
        'no_credits'
      ),
      allowNull: true
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('transactions', 'amt_type');
  }
};
