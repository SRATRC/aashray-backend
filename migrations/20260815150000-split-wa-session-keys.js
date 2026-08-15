'use strict';

// Baileys signal keys used to live in a single `wa_sessions.keys` JSON column, so every
// key rotation rewrote the whole store. With row-based binary logging MySQL then wrote the
// full before-image and after-image of that column for each change, which filled the
// database volume. Give every key its own row so a rotation writes only what changed.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('wa_session_keys', {
      session_id: {
        type: Sequelize.STRING(255),
        allowNull: false,
        primaryKey: true,
        references: { model: 'wa_sessions', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      },
      key_name: {
        type: Sequelize.STRING(255),
        allowNull: false,
        primaryKey: true
      },
      value: {
        type: Sequelize.JSON,
        allowNull: false
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW')
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW')
      }
    });

    const [sessions] = await queryInterface.sequelize.query(
      'SELECT id, `keys` FROM wa_sessions WHERE `keys` IS NOT NULL'
    );

    const rows = [];
    for (const session of sessions) {
      const keys =
        typeof session.keys === 'string' ? JSON.parse(session.keys) : session.keys;
      if (!keys) continue;

      for (const [keyName, value] of Object.entries(keys)) {
        rows.push({
          session_id: session.id,
          key_name: keyName,
          value: JSON.stringify(value),
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }
    }

    if (rows.length > 0) {
      await queryInterface.bulkInsert('wa_session_keys', rows);
    }

    // Clearing the blob also shrinks every future `creds` write, because a FULL row image
    // logs every column of the row, not only the one that changed.
    await queryInterface.sequelize.query(
      'UPDATE wa_sessions SET `keys` = NULL WHERE `keys` IS NOT NULL'
    );
  },

  async down(queryInterface) {
    const [rows] = await queryInterface.sequelize.query(
      'SELECT session_id, key_name, value FROM wa_session_keys'
    );

    const bySession = {};
    for (const row of rows) {
      const value = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      bySession[row.session_id] = bySession[row.session_id] || {};
      bySession[row.session_id][row.key_name] = value;
    }

    for (const [sessionId, keys] of Object.entries(bySession)) {
      await queryInterface.sequelize.query(
        'UPDATE wa_sessions SET `keys` = ? WHERE id = ?',
        { replacements: [JSON.stringify(keys), sessionId] }
      );
    }

    await queryInterface.dropTable('wa_session_keys');
  }
};
