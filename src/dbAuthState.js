// ============================================================
// Database-backed Baileys auth state.
//
// By default Baileys (@whiskeysockets/baileys) persists the WhatsApp
// login session as a folder of JSON files on local disk
// (useMultiFileAuthState). That's a problem on Railway (and most
// cloud hosts): local disk is wiped on every redeploy/restart unless
// a persistent volume is attached, which is exactly why "stay logged
// in" was not surviving.
//
// This module implements the same auth-state contract Baileys expects
// (`{ state: { creds, keys }, saveCreds }`) but reads/writes every
// piece of it as rows in the tenant's own database (Postgres schema
// or SQLite file - see tenant.js/database.js), keyed by account.
// That means the WhatsApp login is tied to the website account itself,
// exactly like a normal "keep me signed in" flow, and survives
// redeploys, container restarts, and moving hosts entirely.
// ============================================================

const { initAuthCreds, BufferJSON, proto, useMultiFileAuthState } = require("@whiskeysockets/baileys");
const fs = require("fs");
const path = require("path");
const crmDB = require("./database");
const { LEGACY_TENANT } = require("./tenant");

async function useDbAuthState(userId) {
  const isLegacy = !userId || userId === LEGACY_TENANT;
  const legacyAuthDir = path.join(__dirname, "..", "auth_info");

  // For the legacy tenant, if auth_info with creds.json exists, use useMultiFileAuthState
  // so the established WhatsApp session (all 66,000+ keys and creds) is directly used!
  if (isLegacy && fs.existsSync(path.join(legacyAuthDir, "creds.json"))) {
    const multiFile = await useMultiFileAuthState(legacyAuthDir);
    return {
      state: multiFile.state,
      saveCreds: multiFile.saveCreds,
      clearAll: async () => {
        try {
          await crmDB.clearAuthBlobs(LEGACY_TENANT);
          const credsFile = path.join(legacyAuthDir, "creds.json");
          if (fs.existsSync(credsFile)) fs.unlinkSync(credsFile);
        } catch (e) {
          console.warn("[Auth] clearAll warning:", e.message);
        }
      },
    };
  }
  const readData = async (key) => {
    try {
      const raw = await crmDB.getAuthBlob(userId, key);
      if (!raw) return null;
      return JSON.parse(raw, BufferJSON.reviver);
    } catch (e) {
      return null;
    }
  };

  const writeData = async (key, data) => {
    await crmDB.setAuthBlob(userId, key, JSON.stringify(data, BufferJSON.replacer));
  };

  const removeData = async (key) => {
    await crmDB.deleteAuthBlob(userId, key);
  };

  const creds = (await readData("creds")) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}`);
              if (!value) {
                const altKey = `${type}-${id.replace(/\//g, '__').replace(/:/g, '-')}`;
                if (altKey !== `${type}-${id}`) {
                  value = await readData(altKey);
                }
              }
              if (type === "app-state-sync-key" && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              tasks.push(value ? writeData(key, value) : removeData(key));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: async () => {
      await writeData("creds", creds);
    },
    // Fully clears this account's WhatsApp session (used on logout / relink)
    clearAll: async () => {
      await crmDB.clearAuthBlobs(userId);
    },
  };
}

module.exports = { useDbAuthState };
