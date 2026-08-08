import { initAuthCreds, BufferJSON } from '@whiskeysockets/baileys';
import { WaSession } from '../models/associations.js';

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

/**
 * Custom auth state manager that persists Baileys WhatsApp Web credentials
 * and keys in MySQL (via WaSession model) rather than the local filesystem.
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
      keys: {}
    });
  }

  // Revive all buffer instances inside credentials and keys loaded from MySQL
  let creds = reviveBuffers(session.creds) || initAuthCreds();
  let keys = reviveBuffers(session.keys) || {};

  const saveCreds = async () => {
    // Stringify and parse via BufferJSON.replacer to properly serialize Buffer objects before updating.
    const serializedCreds = JSON.parse(JSON.stringify(creds, BufferJSON.replacer));
    await WaSession.update(
      { creds: serializedCreds },
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
        let changed = false;
        for (const type in data) {
          for (const id in data[type]) {
            const value = data[type][id];
            const keyName = `${type}-${id}`;
            if (value) {
              // Store the revived value in memory so keys.get returns actual NodeJS Buffers
              keys[keyName] = reviveBuffers(JSON.parse(JSON.stringify(value, BufferJSON.replacer)));
              changed = true;
            } else if (keys[keyName]) {
              delete keys[keyName];
              changed = true;
            }
          }
        }

        if (changed) {
          // Properly serialize the keys to JSON using BufferJSON.replacer before database write
          const serializedKeys = JSON.parse(JSON.stringify(keys, BufferJSON.replacer));
          await WaSession.update(
            { keys: serializedKeys },
            { where: { id: sessionId } }
          );
        }
      }
    }
  };

  return {
    state,
    saveCreds
  };
}
