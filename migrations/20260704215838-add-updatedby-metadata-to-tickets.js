'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('tickets').catch(() => null);
    if (!table) return; // sync() creates tickets on boot; nothing to alter pre-boot
    if (!table.updatedBy) {
      await queryInterface.addColumn('tickets', 'updatedBy', { type: Sequelize.STRING, allowNull: true });
    }
    if (!table.metadata) {
      await queryInterface.addColumn('tickets', 'metadata', { type: Sequelize.JSON, allowNull: true });
    }
  },
  async down(queryInterface) {
    const table = await queryInterface.describeTable('tickets').catch(() => null);
    if (!table) return;
    if (table.metadata) await queryInterface.removeColumn('tickets', 'metadata');
    if (table.updatedBy) await queryInterface.removeColumn('tickets', 'updatedBy');
  }
};
