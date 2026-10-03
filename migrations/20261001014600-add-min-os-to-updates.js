'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // An earlier draft of this change may already have added it on QA.
    const table = await queryInterface.describeTable('updates');
    if (table.min_os) return;
    // iOS: version ("16.4"). Android: API level ("26"). NULL = everyone.
    await queryInterface.addColumn('updates', 'min_os', {
      type: Sequelize.STRING,
      allowNull: true
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('updates', 'min_os');
  }
};
