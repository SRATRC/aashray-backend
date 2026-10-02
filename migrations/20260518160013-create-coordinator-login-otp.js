'use strict';

module.exports = {

  async up(queryInterface, Sequelize) {

    await queryInterface.createTable(
      'coordinator_login_otp',
      {

        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.UUIDV4,
          primaryKey: true,
          allowNull: false,
        },

        mobno: {
          type: Sequelize.STRING,
          allowNull: false,
        },

        otp: {
          type: Sequelize.STRING,
          allowNull: false,
        },

        expires_at: {
          type: Sequelize.DATE,
          allowNull: false,
        },

        verified: {
          type: Sequelize.BOOLEAN,
          defaultValue: false,
          allowNull: false,
        },

        createdAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue:
            Sequelize.literal(
              'CURRENT_TIMESTAMP'
            ),
        },

        updatedAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue:
            Sequelize.literal(
              'CURRENT_TIMESTAMP'
            ),
        },
      }
    );

    await queryInterface.addIndex(
      'coordinator_login_otp',
      ['mobno']
    );

    await queryInterface.addIndex(
      'coordinator_login_otp',
      ['otp']
    );

    await queryInterface.addIndex(
      'coordinator_login_otp',
      ['verified']
    );

    await queryInterface.addIndex(
      'coordinator_login_otp',
      ['expires_at']
    );
  },

  async down(queryInterface) {

    await queryInterface.dropTable(
      'coordinator_login_otp'
    );
  },
};