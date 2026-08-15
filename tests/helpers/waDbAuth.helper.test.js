import { jest } from '@jest/globals';

// @whiskeysockets/baileys ships ESM only, which the CJS test transform cannot load.
// The adapter uses just these two exports, so stub them rather than pull in the package.
jest.mock('@whiskeysockets/baileys', () => ({
  initAuthCreds: () => ({ registered: false }),
  BufferJSON: {
    replacer: (key, value) =>
      value && value.type === 'Buffer'
        ? { type: 'Buffer', data: Buffer.from(value.data).toString('base64') }
        : value
  }
}));

import sequelize from '../../config/database.js';
import { useDatabaseAuthState } from '../../helpers/waDbAuth.helper.js';
import { WaSession, WaSessionKey } from '../../models/associations.js';

const SESSION_ID = 'test_wa_session';

async function reset() {
  await WaSessionKey.destroy({ where: { session_id: SESSION_ID } });
  await WaSession.destroy({ where: { id: SESSION_ID } });
}

beforeEach(reset);
afterAll(reset);

test('each signal key gets its own row and the legacy blob stays empty', async () => {
  const { state } = await useDatabaseAuthState(SESSION_ID);

  await state.keys.set({
    'pre-key': {
      1: { public: Buffer.from('aa', 'hex') },
      2: { public: Buffer.from('bb', 'hex') }
    }
  });

  const rows = await WaSessionKey.findAll({
    where: { session_id: SESSION_ID },
    order: [['key_name', 'ASC']]
  });
  expect(rows.map((r) => r.key_name)).toEqual(['pre-key-1', 'pre-key-2']);

  const session = await WaSession.findByPk(SESSION_ID);
  expect(session.keys).toBeNull();
});

// This is the regression guard for the incident on 2026-08-15: writing one key must not
// rewrite the others. Rewriting the whole store is what filled the database volume.
test('setting one key does not rewrite the untouched keys', async () => {
  const { state } = await useDatabaseAuthState(SESSION_ID);

  await state.keys.set({
    'pre-key': { 1: { public: 'one' }, 2: { public: 'two' } }
  });

  // Raw SQL, because Model.update with silent: true drops an explicit updatedAt.
  const readUpdatedAt = async () => {
    const [[row]] = await sequelize.query(
      "SELECT updatedAt FROM wa_session_keys WHERE session_id = ? AND key_name = 'pre-key-2'",
      { replacements: [SESSION_ID] }
    );
    return new Date(row.updatedAt).getTime();
  };

  await sequelize.query(
    "UPDATE wa_session_keys SET updatedAt = '2020-01-01 00:00:00' WHERE session_id = ? AND key_name = 'pre-key-2'",
    { replacements: [SESSION_ID] }
  );
  const before = await readUpdatedAt();

  await state.keys.set({ 'pre-key': { 1: { public: 'one-changed' } } });

  expect(await readUpdatedAt()).toBe(before);

  const changed = await WaSessionKey.findOne({
    where: { session_id: SESSION_ID, key_name: 'pre-key-1' }
  });
  expect(changed.value).toEqual({ public: 'one-changed' });
});

test('a null value removes only that key', async () => {
  const { state } = await useDatabaseAuthState(SESSION_ID);

  await state.keys.set({
    'pre-key': { 1: { public: 'one' }, 2: { public: 'two' } }
  });
  await state.keys.set({ 'pre-key': { 1: null } });

  const rows = await WaSessionKey.findAll({ where: { session_id: SESSION_ID } });
  expect(rows.map((r) => r.key_name)).toEqual(['pre-key-2']);
  expect(state.keys.get('pre-key', ['1'])).toEqual({});
});

test('buffers survive the round trip through the database', async () => {
  const bytes = Buffer.from('0badc0de', 'hex');

  const first = await useDatabaseAuthState(SESSION_ID);
  await first.state.keys.set({ 'pre-key': { 1: { public: bytes } } });

  // A fresh adapter reads the key back from the database, not from memory.
  const second = await useDatabaseAuthState(SESSION_ID);
  const loaded = second.state.keys.get('pre-key', ['1']);

  expect(Buffer.isBuffer(loaded['1'].public)).toBe(true);
  expect(loaded['1'].public.equals(bytes)).toBe(true);
});

test('a session still on the legacy blob is moved to rows on load', async () => {
  await WaSession.create({
    id: SESSION_ID,
    creds: { registered: true },
    keys: { 'pre-key-7': { public: 'legacy' } }
  });

  const { state } = await useDatabaseAuthState(SESSION_ID);

  const rows = await WaSessionKey.findAll({ where: { session_id: SESSION_ID } });
  expect(rows.map((r) => r.key_name)).toEqual(['pre-key-7']);
  expect(state.keys.get('pre-key', ['7'])).toEqual({ 7: { public: 'legacy' } });

  const session = await WaSession.findByPk(SESSION_ID);
  expect(session.keys).toBeNull();
});
