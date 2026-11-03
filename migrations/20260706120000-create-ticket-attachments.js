'use strict';

async function addIndexIfMissing(queryInterface, table, columns, options) {
  const existing = await queryInterface.showIndex(table).catch(() => []);
  const alreadyExists = existing.some(
    (idx) => idx.fields.map((f) => f.attribute).join(',') === columns.join(',')
  );
  if (!alreadyExists) {
    await queryInterface.addIndex(table, columns, options);
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    // sync() may already have created this table on an app/test boot; only
    // create it when it's genuinely missing so the migration stays idempotent.
    const existing = await queryInterface.describeTable('ticket_attachments').catch(() => null);
    if (!existing) {
      await queryInterface.createTable('ticket_attachments', {
        id: {
          type: Sequelize.INTEGER,
          primaryKey: true,
          autoIncrement: true,
          allowNull: false
        },
        ticket_id: {
          type: Sequelize.STRING,
          allowNull: false,
          references: { model: 'tickets', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE'
        },
        message_id: {
          type: Sequelize.INTEGER,
          allowNull: true,
          references: { model: 'ticket_messages', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE'
        },
        s3_key: {
          type: Sequelize.STRING,
          allowNull: false
        },
        content_type: {
          type: Sequelize.STRING,
          allowNull: false
        },
        kind: {
          type: Sequelize.ENUM('image', 'video'),
          allowNull: false
        },
        size: {
          type: Sequelize.INTEGER,
          allowNull: false
        },
        uploaded_by: {
          type: Sequelize.STRING,
          allowNull: false
        },
        uploaded_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
        },
        expired_at: {
          type: Sequelize.DATE,
          allowNull: true
        },
        createdAt: {
          type: Sequelize.DATE,
          allowNull: false
        },
        updatedAt: {
          type: Sequelize.DATE,
          allowNull: false
        }
      });
    }

    // ticket_id — list/detail lookups by ticket.
    // uploaded_at — the retention cron's WHERE expired_at IS NULL AND
    //   uploaded_at < cutoff scan.
    // (ticket_id, kind) — the per-ticket video-cap count.
    await addIndexIfMissing(queryInterface, 'ticket_attachments', ['ticket_id']);
    await addIndexIfMissing(queryInterface, 'ticket_attachments', ['uploaded_at']);
    await addIndexIfMissing(queryInterface, 'ticket_attachments', ['ticket_id', 'kind']);
  },

  async down(queryInterface) {
    const existing = await queryInterface.describeTable('ticket_attachments').catch(() => null);
    if (existing) {
      await queryInterface.dropTable('ticket_attachments');
    }
  }
};
