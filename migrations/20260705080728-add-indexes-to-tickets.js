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
  async up(queryInterface) {
    const ticketsTable = await queryInterface.describeTable('tickets').catch(() => null);
    if (ticketsTable) {
      await addIndexIfMissing(queryInterface, 'tickets', ['status']);
      await addIndexIfMissing(queryInterface, 'tickets', ['service']);
      await addIndexIfMissing(queryInterface, 'tickets', ['updatedAt']);
    }

    const messagesTable = await queryInterface.describeTable('ticket_messages').catch(() => null);
    if (messagesTable) {
      await addIndexIfMissing(queryInterface, 'ticket_messages', ['ticket_id', 'createdAt']);
    }
  },
  async down(queryInterface) {
    const ticketsTable = await queryInterface.describeTable('tickets').catch(() => null);
    if (ticketsTable) {
      await queryInterface.removeIndex('tickets', ['status']).catch(() => {});
      await queryInterface.removeIndex('tickets', ['service']).catch(() => {});
      await queryInterface.removeIndex('tickets', ['updatedAt']).catch(() => {});
    }
    const messagesTable = await queryInterface.describeTable('ticket_messages').catch(() => null);
    if (messagesTable) {
      await queryInterface.removeIndex('ticket_messages', ['ticket_id', 'createdAt']).catch(() => {});
    }
  }
};
