'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tableInfo = await queryInterface.describeTable('utsav_packages_db');

    if (!tableInfo.starting_meal) {
      await queryInterface.addColumn('utsav_packages_db', 'starting_meal', {
        type: Sequelize.JSON,
        allowNull: true
      });
    }

    if (!tableInfo.ending_meal) {
      await queryInterface.addColumn('utsav_packages_db', 'ending_meal', {
        type: Sequelize.JSON,
        allowNull: true
      });
    }

    // Copy meal data from utsav_db to matching packages
    await queryInterface.sequelize.query(`
      UPDATE utsav_packages_db AS p
      INNER JOIN utsav_db AS u ON p.utsavid = u.id
      SET p.starting_meal = CASE
            WHEN DATE(p.start_date) = DATE(u.start_date) THEN u.starting_meal
            ELSE NULL
          END,
          p.ending_meal = CASE
            WHEN DATE(p.end_date) = DATE(u.end_date) THEN u.ending_meal
            ELSE NULL
          END
      WHERE u.starting_meal IS NOT NULL OR u.ending_meal IS NOT NULL
    `);
  },

  async down(queryInterface) {
    const tableInfo = await queryInterface.describeTable('utsav_packages_db');

    if (tableInfo.starting_meal) {
      await queryInterface.removeColumn('utsav_packages_db', 'starting_meal');
    }

    if (tableInfo.ending_meal) {
      await queryInterface.removeColumn('utsav_packages_db', 'ending_meal');
    }
  }
};
