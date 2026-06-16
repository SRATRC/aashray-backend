'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      // 1. Create shibir_sessions table
      await queryInterface.createTable(
        'shibir_sessions',
        {
          id: {
            type: Sequelize.INTEGER,
            autoIncrement: true,
            primaryKey: true
          },
          shibir_id: {
            type: Sequelize.INTEGER,
            allowNull: false
          },
          session_number: {
            type: Sequelize.INTEGER,
            allowNull: false
          },
          type: {
            type: Sequelize.ENUM('regular', 'MV'),
            allowNull: false,
            defaultValue: 'regular'
          },
          date: {
            type: Sequelize.DATEONLY,
            allowNull: true
          },
          start_time: {
            type: Sequelize.TIME,
            allowNull: true
          },
          updatedBy: {
            type: Sequelize.STRING(255),
            allowNull: true
          },
          createdAt: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
          },
          updatedAt: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
          }
        },
        { transaction }
      );

      // Add unique constraint on shibir_id & session_number
      await queryInterface.addIndex(
        'shibir_sessions',
        ['shibir_id', 'session_number'],
        {
          unique: true,
          name: 'shibir_sessions_unique_shibir_session',
          transaction
        }
      );

      // 2. Create shibir_attendance_records table
      await queryInterface.createTable(
        'shibir_attendance_records',
        {
          id: {
            type: Sequelize.INTEGER,
            autoIncrement: true,
            primaryKey: true
          },
          shibir_id: {
            type: Sequelize.INTEGER,
            allowNull: false
          },
          bookingid: {
            type: Sequelize.STRING(255),
            allowNull: false
          },
          cardno: {
            type: Sequelize.STRING(255),
            allowNull: false
          },
          session_number: {
            type: Sequelize.INTEGER,
            allowNull: false
          },
          attended: {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: false
          },
          updatedBy: {
            type: Sequelize.STRING(255),
            allowNull: true
          },
          createdAt: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
          },
          updatedAt: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
          }
        },
        { transaction }
      );

      // Add unique constraint on bookingid & session_number
      await queryInterface.addIndex(
        'shibir_attendance_records',
        ['bookingid', 'session_number'],
        {
          unique: true,
          name: 'shibir_attendance_records_unique_booking_session',
          transaction
        }
      );

      // 3. Migrate existing shibirs to shibir_sessions
      const shibirs = await queryInterface.sequelize.query(
        'SELECT id, start_date, end_date FROM shibir_db',
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      for (const shibir of shibirs) {
        for (let i = 1; i <= 9; i++) {
          const type = i >= 7 ? 'MV' : 'regular';
          await queryInterface.sequelize.query(
            `INSERT IGNORE INTO shibir_sessions (shibir_id, session_number, type, createdAt, updatedAt) 
             VALUES (:shibir_id, :session_number, :type, NOW(), NOW())`,
            {
              replacements: {
                shibir_id: shibir.id,
                session_number: i,
                type
              },
              transaction
            }
          );
        }
      }

      // 4. Migrate existing attendance from shibir_attendance_db to shibir_attendance_records
      const existingAttendance = await queryInterface.sequelize.query(
        'SELECT * FROM shibir_attendance_db',
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      for (const att of existingAttendance) {
        for (let i = 1; i <= 9; i++) {
          const val = att[`session_${i}_attendance`];
          if (val === 1 || val === true) {
            await queryInterface.sequelize.query(
              `INSERT IGNORE INTO shibir_attendance_records (shibir_id, bookingid, cardno, session_number, attended, updatedBy, createdAt, updatedAt) 
               VALUES (:shibir_id, :bookingid, :cardno, :session_number, 1, :updatedBy, NOW(), NOW())`,
              {
                replacements: {
                  shibir_id: att.shibir_id,
                  bookingid: att.bookingid,
                  cardno: att.cardno,
                  session_number: i,
                  updatedBy: att.updatedBy || 'migration'
                },
                transaction
              }
            );
          }
        }
      }

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  async down(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.dropTable('shibir_attendance_records', { transaction });
      await queryInterface.dropTable('shibir_sessions', { transaction });
      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }
};
