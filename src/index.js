const fs = require("fs");
const path = require("path");
const { server } = require("./server");
const whatsapp = require("./whatsapp");
const crmDB = require("./database");
const { runAsTenant, LEGACY_TENANT } = require("./tenant");

let PORT = process.env.PORT || 5000;
try {
  const configPath = path.join(__dirname, "..", "config.json");
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    PORT = process.env.PORT || config.port || 5000;
  }
} catch (e) {}

// One-time bridge from the pre-multi-tenant setup (config.json rules,
// the already-linked WhatsApp session on disk) into the new per-account
// database storage, so upgrading to accounts does not lose anything or
// force a fresh QR scan for the account that already existed.
async function migrateLegacyDataOnce() {
  await runAsTenant(LEGACY_TENANT, async () => {
    try {
      const configPath = path.join(__dirname, "..", "config.json");
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

        const existingRules = await crmDB.getAutoReplyRules();
        if (existingRules.length === 0 && Array.isArray(config.autoReplyRules) && config.autoReplyRules.length > 0) {
          for (const r of config.autoReplyRules) {
            if (!r || !r.keyword || !r.response) continue;
            await crmDB.addAutoReplyRule({
              id: r.id,
              keyword: r.keyword,
              matchType: r.matchType,
              response: r.response,
              active: r.active !== false,
            });
          }
          console.log(`[Migration] Imported ${config.autoReplyRules.length} legacy auto-reply rules into the database.`);
        }

        const currentSettings = await crmDB.kvGet("bot_settings");
        if (!currentSettings) {
          await crmDB.setBotSettings({
            botEnabled: config.botEnabled !== false,
            aiMode: config.aiMode || "",
            microMindApiUrl: config.microMindApiUrl || "",
            googleSheetWebhookUrl: config.googleSheetWebhookUrl || "",
          });
          console.log("[Migration] Imported legacy bot settings into the database.");
        }
      }
    } catch (e) {
      console.warn("[Migration] Legacy config -> database seed notice:", e.message);
    }
  });
}

migrateLegacyDataOnce().finally(() => {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`====================================================`);
    console.log(`🚀 WhatsApp Pro Dashboard is running at:`);
    console.log(`👉 Port: ${PORT}`);
    console.log(`====================================================`);

    // Auto-connect the original ("legacy") account's WhatsApp session on boot,
    // exactly like before multi-tenancy. Every other account's WhatsApp
    // connection starts lazily the first time that account is used.
    whatsapp.bootLegacy();
  });
});
