// ============================================================
// Database-backed Baileys auth state (Strict Multi-Tenant Isolation)
//
// By default Baileys (@whiskeysockets/baileys) persists the WhatsApp
// login session as a folder of JSON files on local disk
// (useMultiFileAuthState). That causes collisions and session loss
// across redeploys, restarts, or multiple accounts.
//
// This module stores every account's auth-state in a dedicated
// `whatsapp_sessions` table with compound primary key (user_id, key).
// Key operations are batched so large key sets (100+ keys) are read
// and written in 1-2 queries instead of 100+ concurrent connections.
// ============================================================

const { initAuthCreds, BufferJSON, proto } = require("@whiskeysockets/baileys");
const fs = require("fs");
const path = require("path");
const crmDB = require("./database");
const { LEGACY_TENANT } = require("./tenant");

async function useDbAuthState(userId) {
  const uid = String(userId || LEGACY_TENANT);
  const isLegacy = uid === LEGACY_TENANT;
  const legacyAuthDir = path.join(__dirname, "..", "auth_info");

  const readData = async (key) => {
    try {
      const raw = await crmDB.getAuthBlob(uid, key);
      if (!raw) return null;
      return JSON.parse(raw, BufferJSON.reviver);
    } catch (e) {
      return null;
    }
  };

  const writeData = async (key, data) => {
    await crmDB.setAuthBlob(uid, key, JSON.stringify(data, BufferJSON.replacer));
  };

  const removeData = async (key) => {
    await crmDB.deleteAuthBlob(uid, key);
  };

  // 1. Initial creds resolution
  let creds = await readData("creds");

  // If creds is missing or is an invalid/dead session (e.g. unlinked or 401 logged out where me was set but registered is false)
  if (!creds || (creds.registered === false && creds.me)) {
    creds = initAuthCreds();
    await writeData("creds", creds);
  }

  const stateObj = {
    creds,
    keys: {
      get: async (type, ids) => {
        const data = {};
        if (!ids || ids.length === 0) return data;

        // 1. Batch fetch all primary keys at once
        const keyMap = new Map(); // primaryKey -> id
        const keysToFetch = [];
        for (const id of ids) {
          const pk = `${type}-${id}`;
          keyMap.set(pk, id);
          keysToFetch.push(pk);
        }

        const rawResults = await crmDB.getAuthBlobs(uid, keysToFetch);

        const missingIds = [];
        for (const id of ids) {
          const pk = `${type}-${id}`;
          const raw = rawResults[pk];
          if (raw) {
            try {
              let parsed = JSON.parse(raw, BufferJSON.reviver);
              if (type === "app-state-sync-key" && parsed) {
                parsed = proto.Message.AppStateSyncKeyData.fromObject(parsed);
              }
              data[id] = parsed;
            } catch (e) {
              data[id] = null;
            }
          } else {
            missingIds.push(id);
          }
        }

        // 2. For any missing ids, try alternate key format (with replaced chars)
        if (missingIds.length > 0) {
          const altKeysToFetch = [];
          const altKeyMap = new Map(); // altKey -> id
          for (const id of missingIds) {
            const altKey = `${type}-${String(id).replace(/\//g, "__").replace(/:/g, "-")}`;
            if (altKey !== `${type}-${id}`) {
              altKeysToFetch.push(altKey);
              altKeyMap.set(altKey, id);
            } else {
              data[id] = null;
            }
          }

          if (altKeysToFetch.length > 0) {
            const altResults = await crmDB.getAuthBlobs(uid, altKeysToFetch);
            for (const [altKey, id] of altKeyMap.entries()) {
              const raw = altResults[altKey];
              if (raw) {
                try {
                  let parsed = JSON.parse(raw, BufferJSON.reviver);
                  if (type === "app-state-sync-key" && parsed) {
                    parsed = proto.Message.AppStateSyncKeyData.fromObject(parsed);
                  }
                  data[id] = parsed;
                } catch (e) {
                  data[id] = null;
                }
              } else {
                data[id] = null;
              }
            }
          }
        }

        return data;
      },
      set: async (data) => {
        const toWrite = [];
        const toDelete = [];

        for (const category in data) {
          for (const id in data[category]) {
            const value = data[category][id];
            const key = `${category}-${id}`;
            if (value) {
              toWrite.push({
                key,
                value: JSON.stringify(value, BufferJSON.replacer),
              });
            } else {
              toDelete.push(key);
            }
          }
        }

        if (toWrite.length > 0) {
          await crmDB.setAuthBlobs(uid, toWrite);
        }
        if (toDelete.length > 0) {
          await crmDB.deleteAuthBlobs(uid, toDelete);
        }
      },
    },
  };

  return {
    state: stateObj,
    saveCreds: async () => {
      try {
        await writeData("creds", stateObj.creds);
      } catch (err) {
        console.warn(`[Auth:${uid}] Failed to save creds:`, err.message);
      }
    },
    // Fully clears this account's WhatsApp session (used on logout / relink)
    clearAll: async () => {
      await crmDB.clearAuthBlobs(uid);
    },
  };
}

module.exports = { useDbAuthState };
