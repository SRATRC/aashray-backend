'use strict';

// Returns true if the column already exists on the table. Keeps this migration
// idempotent when the schema change was already applied but not recorded in
// SequelizeMeta.
async function columnExists(queryInterface, tableName, columnName) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT COUNT(*) AS count FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :tableName AND COLUMN_NAME = :columnName`,
    { replacements: { tableName, columnName } }
  );
  return Number(rows[0].count) > 0;
}

const COLUMNS = [
  'accommodation_rating',
  'qr_rating',
  'food_rating',
  'program_rating',
  'volunteer_rating',
  'infrastructure_rating',
  'decor_rating',
  'internal_transport_rating',
  'raj_pravas_rating',
  'sparsh_rating',
  'av_rating',
  'loved_most',
  'improvement_suggestions'
];

module.exports = {
  async up(queryInterface) {
    for (const column of COLUMNS) {
      if (await columnExists(queryInterface, 'utsav_feedback', column)) {
        await queryInterface.removeColumn('utsav_feedback', column);
      }
    }
  },

  async down(queryInterface, Sequelize) {
    const textColumns = ['loved_most', 'improvement_suggestions'];

    for (const column of COLUMNS) {
      if (await columnExists(queryInterface, 'utsav_feedback', column)) {
        continue;
      }

      const isText = textColumns.includes(column);
      await queryInterface.addColumn('utsav_feedback', column, {
        type: isText ? Sequelize.TEXT : Sequelize.INTEGER,
        allowNull: false,
        defaultValue: isText ? '' : 1
      });
    }
  }
};
