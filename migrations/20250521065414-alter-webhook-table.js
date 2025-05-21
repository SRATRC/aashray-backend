'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('razorpay_webhook', 'order_id', {
      type: Sequelize.STRING,
      allowNull: false
    });

    await queryInterface.sequelize.query(`
      UPDATE razorpay_webhook SET order_id = CAST(id AS CHAR)
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE razorpay_webhook
      DROP PRIMARY KEY,
      ADD PRIMARY KEY (order_id)
    `);

    await queryInterface.removeColumn('razorpay_webhook', 'id');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn('razorpay_webhook', 'id', {
      type: Sequelize.INTEGER,
      allowNull: false
    });

    await queryInterface.sequelize.query(`
      SET @counter = 0;
      UPDATE razorpay_webhook SET id = (@counter:=@counter+1)
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE razorpay_webhook
      DROP PRIMARY KEY,
      ADD PRIMARY KEY (id),
      MODIFY id INT NOT NULL AUTO_INCREMENT
    `);

    await queryInterface.removeColumn('razorpay_webhook', 'order_id');
  }
};
