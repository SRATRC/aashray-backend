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
    const ticketsTable = await queryInterface.describeTable('tickets').catch(() => null);
    if (!ticketsTable) return; // sync() creates tickets on boot; nothing to alter pre-boot

    if (!ticketsTable.updatedBy) {
      await queryInterface.addColumn('tickets', 'updatedBy', { type: Sequelize.STRING, allowNull: true });
    }
    if (!ticketsTable.metadata) {
      await queryInterface.addColumn('tickets', 'metadata', { type: Sequelize.JSON, allowNull: true });
    }

    // Composite (status, updatedAt) rather than two single-column indexes:
    // it serves the auto-close cron's `WHERE status='resolved' AND
    // updatedAt<cutoff` as a single range scan, and MySQL can still use its
    // leading column alone for a status-only filter (leftmost-prefix rule) —
    // so status doesn't need its own separate index too. `service` and
    // `createdAt` (the admin list's default sort) are indexed separately
    // since they're each used independently of status/updatedAt.
    await addIndexIfMissing(queryInterface, 'tickets', ['status', 'updatedAt']);
    await addIndexIfMissing(queryInterface, 'tickets', ['service']);
    await addIndexIfMissing(queryInterface, 'tickets', ['createdAt']);

    const messagesTable = await queryInterface.describeTable('ticket_messages').catch(() => null);
    if (messagesTable) {
      await addIndexIfMissing(queryInterface, 'ticket_messages', ['ticket_id', 'createdAt']);
    }
  },
  async down(queryInterface) {
    const ticketsTable = await queryInterface.describeTable('tickets').catch(() => null);
    if (ticketsTable) {
      await queryInterface.removeIndex('tickets', ['status', 'updatedAt']).catch(() => {});
      await queryInterface.removeIndex('tickets', ['service']).catch(() => {});
      await queryInterface.removeIndex('tickets', ['createdAt']).catch(() => {});
      if (ticketsTable.metadata) await queryInterface.removeColumn('tickets', 'metadata');
      if (ticketsTable.updatedBy) await queryInterface.removeColumn('tickets', 'updatedBy');
    }
    const messagesTable = await queryInterface.describeTable('ticket_messages').catch(() => null);
    if (messagesTable) {
      await queryInterface.removeIndex('ticket_messages', ['ticket_id', 'createdAt']).catch(() => {});
    }
  }
};
