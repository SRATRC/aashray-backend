'use strict';

const moment = require('moment-timezone');

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
            allowNull: false,
            references: {
              model: 'shibir_db',
              key: 'id'
            },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE'
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
            allowNull: false,
            references: {
              model: 'shibir_db',
              key: 'id'
            },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE'
          },
          bookingid: {
            type: Sequelize.STRING(255),
            allowNull: false,
            references: {
              model: 'shibir_booking_db',
              key: 'bookingid'
            },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE'
          },
          cardno: {
            type: Sequelize.STRING(255),
            allowNull: false,
            references: {
              model: 'card_db',
              key: 'cardno'
            },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE'
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
      // Only select shibirs that actually have attendance records in shibir_attendance_db
      const shibirs = await queryInterface.sequelize.query(
        `SELECT DISTINCT s.id, s.start_date, s.end_date, s.location 
         FROM shibir_db s
         INNER JOIN shibir_attendance_db a ON s.id = a.shibir_id`,
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      for (const shibir of shibirs) {
        // Only initialize sessions for Research Centre shibirs where attendance is tracked
        if (shibir.location !== 'Research Centre') {
          continue;
        }

        const startDate = moment.tz(shibir.start_date, 'Asia/Kolkata').startOf('day');
        const endDate = moment.tz(shibir.end_date, 'Asia/Kolkata').startOf('day');
        const days = endDate.diff(startDate, 'days') + 1;

        // Dynamic session mapping matching initializeShibirSessions helper
        for (let d = 1; d <= days; d++) {
          const dateStr = moment.tz(shibir.start_date, 'Asia/Kolkata').add(d - 1, 'days').format('YYYY-MM-DD');

          // Regular Morning session
          await queryInterface.sequelize.query(
            `INSERT IGNORE INTO shibir_sessions (shibir_id, session_number, type, date, start_time, createdAt, updatedAt) 
             VALUES (:shibir_id, :session_number, 'regular', :date, '10:00:00', NOW(), NOW())`,
            {
              replacements: {
                shibir_id: shibir.id,
                session_number: (d - 1) * 2 + 1,
                date: dateStr
              },
              transaction
            }
          );

          // Regular Afternoon session
          await queryInterface.sequelize.query(
            `INSERT IGNORE INTO shibir_sessions (shibir_id, session_number, type, date, start_time, createdAt, updatedAt) 
             VALUES (:shibir_id, :session_number, 'regular', :date, '15:45:00', NOW(), NOW())`,
            {
              replacements: {
                shibir_id: shibir.id,
                session_number: (d - 1) * 2 + 2,
                date: dateStr
              },
              transaction
            }
          );

          // MV session (placed last, matching 2 * days + d)
          await queryInterface.sequelize.query(
            `INSERT IGNORE INTO shibir_sessions (shibir_id, session_number, type, date, start_time, createdAt, updatedAt) 
             VALUES (:shibir_id, :session_number, 'MV', :date, '04:30:00', NOW(), NOW())`,
            {
              replacements: {
                shibir_id: shibir.id,
                session_number: 2 * days + d,
                date: dateStr
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

      const shibirMap = new Map(shibirs.map(s => [s.id, s]));

      for (const att of existingAttendance) {
        const shibir = shibirMap.get(att.shibir_id);
        if (!shibir || shibir.location !== 'Research Centre') {
          continue;
        }

        const startDate = moment.tz(shibir.start_date, 'Asia/Kolkata').startOf('day');
        const endDate = moment.tz(shibir.end_date, 'Asia/Kolkata').startOf('day');
        const days = endDate.diff(startDate, 'days') + 1;
        const totalSessions = days * 3;

        // Loop through valid sessions (up to 9 since the old table only has columns up to session_9_attendance)
        for (let i = 1; i <= Math.min(totalSessions, 9); i++) {
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
