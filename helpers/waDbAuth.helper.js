import { initAuthCreds, BufferJSON } from '@whiskeysockets/baileys';
import { WaSession, WaSessionKey } from '../models/associations.js';

/**
 * Recursively converts raw JSON buffer representations ({ type: 'Buffer', data: [...] })
 * back into Node.js Buffer instances.
 */
function reviveBuffers(obj) {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'object') {
    if (obj.type === 'Buffer') {
      if (typeof obj.data === 'string') {
        return Buffer.from(obj.data, 'base64');
      } else if (Array.isArray(obj.data)) {
        return Buffer.from(obj.data);
      }
    }

    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        obj[key] = reviveBuffers(obj[key]);
      }
    }
  }

  return obj;
}

function serialize(value) {
  return JSON.parse(JSON.stringify(value, BufferJSON.replacer));
}

/**
 * Loads every signal key for a session into memory.
 *
 * Keys used to live in a single `wa_sessions.keys` JSON column. Baileys rotates keys
 * constantly, so each rotation rewrote the whole store, and row-based binary logging
 * then wrote the full before-image and after-image of that column for every change.
 * That is what filled the database volume. Keys now get one row each, so a rotation
 * writes only the key that changed. A session left on the old layout is migrated here
 * on first load, so a restore of an older dump still recovers without a new QR scan.
 */
async function loadKeys(sessionId, session) {
  const rows = await WaSessionKey.findAll({ where: { session_id: sessionId } });

  if (rows.length > 0) {
    const keys = {};
    for (const row of rows) {
      keys[row.key_name] = reviveBuffers(row.value);
    }
    return keys;
  }

  const legacyKeys = session.keys;
  if (!legacyKeys || Object.keys(legacyKeys).length === 0) {
    return {};
  }

  await WaSessionKey.bulkCreate(
    Object.entries(legacyKeys).map(([keyName, value]) => ({
      session_id: sessionId,
      key_name: keyName,
      value
    })),
    { updateOnDuplicate: ['value', 'updatedAt'] }
  );
  await WaSession.update({ keys: null }, { where: { id: sessionId } });

  const keys = {};
  for (const [keyName, value] of Object.entries(legacyKeys)) {
    keys[keyName] = reviveBuffers(value);
  }
  return keys;
}

/**
 * Custom auth state manager that persists Baileys WhatsApp Web credentials
 * and keys in MySQL (via the WaSession and WaSessionKey models) rather than
 * the local filesystem.
 *
 * @param {string} sessionId Unique identifier for the WhatsApp session.
 * @returns {Promise<{ state: any, saveCreds: () => Promise<void> }>}
 */
export async function useDatabaseAuthState(sessionId) {
  let session = await WaSession.findByPk(sessionId);
  if (!session) {
    session = await WaSession.create({
      id: sessionId,
      creds: initAuthCreds(),
      keys: null
    });
  }

  // Revive all buffer instances inside credentials loaded from MySQL
  let creds = reviveBuffers(session.creds) || initAuthCreds();
  const keys = await loadKeys(sessionId, session);

  const saveCreds = async () => {
    // Stringify and parse via BufferJSON.replacer to properly serialize Buffer objects before updating.
    await WaSession.update(
      { creds: serialize(creds) },
      { where: { id: sessionId } }
    );
  };

  const state = {
    creds,
    keys: {
      get: (type, ids) => {
        const data = {};
        for (const id of ids) {
          const rawValue = keys[`${type}-${id}`];
          if (rawValue) {
            data[id] = rawValue;
          }
        }
        return data;
      },
      set: async (data) => {
        const upserts = [];
        const removedKeyNames = [];

        for (const type in data) {
          for (const id in data[type]) {
            const value = data[type][id];
            const keyName = `${type}-${id}`;

            if (value) {
              const serializedValue = serialize(value);
              // Store the revived value in memory so keys.get returns actual NodeJS Buffers.
              // Clone first, because reviveBuffers mutates what it is given.
              keys[keyName] = reviveBuffers(
                JSON.parse(JSON.stringify(serializedValue))
              );
              upserts.push({
                session_id: sessionId,
                key_name: keyName,
                value: serializedValue
              });
            } else if (keys[keyName]) {
              delete keys[keyName];
              removedKeyNames.push(keyName);
            }
          }
        }

        // Write only the keys that changed, never the whole store.
        if (upserts.length > 0) {
          await WaSessionKey.bulkCreate(upserts, {
            updateOnDuplicate: ['value', 'updatedAt']
          });
        }

        if (removedKeyNames.length > 0) {
          await WaSessionKey.destroy({
            where: { session_id: sessionId, key_name: removedKeyNames }
          });
        }
      }
    }
  };

  return {
    state,
    saveCreds
  };
}
