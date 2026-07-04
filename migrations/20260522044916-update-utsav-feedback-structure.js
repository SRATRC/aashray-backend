'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.removeColumn('utsav_feedback', 'accommodation_rating');
    await queryInterface.removeColumn('utsav_feedback', 'qr_rating');
    await queryInterface.removeColumn('utsav_feedback', 'food_rating');
    await queryInterface.removeColumn('utsav_feedback', 'program_rating');
    await queryInterface.removeColumn('utsav_feedback', 'volunteer_rating');
    await queryInterface.removeColumn('utsav_feedback', 'infrastructure_rating');
    await queryInterface.removeColumn('utsav_feedback', 'decor_rating');
    await queryInterface.removeColumn('utsav_feedback', 'internal_transport_rating');
    await queryInterface.removeColumn('utsav_feedback', 'raj_pravas_rating');
    await queryInterface.removeColumn('utsav_feedback', 'sparsh_rating');
    await queryInterface.removeColumn('utsav_feedback', 'av_rating');
    await queryInterface.removeColumn('utsav_feedback', 'loved_most');
    await queryInterface.removeColumn('utsav_feedback', 'improvement_suggestions');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn('utsav_feedback', 'accommodation_rating', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 1
    });

    await queryInterface.addColumn('utsav_feedback', 'qr_rating', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 1
    });

    await queryInterface.addColumn('utsav_feedback', 'food_rating', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 1
    });

    await queryInterface.addColumn('utsav_feedback', 'program_rating', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 1
    });

    await queryInterface.addColumn('utsav_feedback', 'volunteer_rating', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 1
    });

    await queryInterface.addColumn('utsav_feedback', 'infrastructure_rating', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 1
    });

    await queryInterface.addColumn('utsav_feedback', 'decor_rating', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 1
    });

    await queryInterface.addColumn('utsav_feedback', 'internal_transport_rating', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 1
    });

    await queryInterface.addColumn('utsav_feedback', 'raj_pravas_rating', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 1
    });

    await queryInterface.addColumn('utsav_feedback', 'sparsh_rating', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 1
    });

    await queryInterface.addColumn('utsav_feedback', 'av_rating', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 1
    });

    await queryInterface.addColumn('utsav_feedback', 'loved_most', {
      type: Sequelize.TEXT,
      allowNull: false,
      defaultValue: ''
    });

    await queryInterface.addColumn('utsav_feedback', 'improvement_suggestions', {
      type: Sequelize.TEXT,
      allowNull: false,
      defaultValue: ''
    });
  }
};