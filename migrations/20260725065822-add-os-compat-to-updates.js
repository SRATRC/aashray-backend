'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // The `updates` table is created via sequelize.sync in some environments,
    // so guard each column add against a table that may already have them.
    const table = await queryInterface.describeTable('updates');

    if (!table.build_number) {
      await queryInterface.addColumn('updates', 'build_number', {
        type: Sequelize.INTEGER,
        allowNull: true
      });
    }

    if (!table.min_os) {
      await queryInterface.addColumn('updates', 'min_os', {
        type: Sequelize.STRING,
        allowNull: true
      });
    }

    if (!table.tier) {
      await queryInterface.addColumn('updates', 'tier', {
        type: Sequelize.ENUM('optional', 'required'),
        allowNull: false,
        defaultValue: 'optional'
      });
    }

    // Backfill tier from the deprecated `mandatory` flag.
    await queryInterface.sequelize.query(
      `UPDATE updates SET tier = 'required' WHERE mandatory = true`
    );

    // Backfill build_number from row order per OS (oldest = lowest), so existing
    // rows have a monotonic key. New releases must set build_number explicitly.
    await queryInterface.sequelize.query(`
      UPDATE updates u
      JOIN (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY os ORDER BY createdAt ASC, id ASC) AS rn
        FROM updates
      ) ranked ON ranked.id = u.id
      SET u.build_number = ranked.rn
      WHERE u.build_number IS NULL
    `);
  },

  async down(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('updates');

    if (table.tier) await queryInterface.removeColumn('updates', 'tier');
    if (table.min_os) await queryInterface.removeColumn('updates', 'min_os');
    if (table.build_number)
      await queryInterface.removeColumn('updates', 'build_number');

    // Clean up the ENUM type MySQL creates for the tier column.
    await queryInterface.sequelize
      .query('DROP TYPE IF EXISTS "enum_updates_tier"')
      .catch(() => {});
  }
};
