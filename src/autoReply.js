const crmDB = require("./database");

// Auto-reply rules and bot settings now live per-tenant in the database
// (see database.js: getBotSettings/getAutoReplyRules) instead of the
// shared config.json file, so every account's bot behaves independently.
class AutoReplyEngine {
  async getSettings() {
    return crmDB.getBotSettings();
  }

  async isBotEnabled() {
    const s = await this.getSettings();
    return !!s.botEnabled;
  }

  async setBotEnabled(enabled) {
    const s = await crmDB.setBotSettings({ botEnabled: !!enabled });
    return s.botEnabled;
  }

  async getRules() {
    return crmDB.getAutoReplyRules();
  }

  async addRule(rule) {
    if (!rule || !rule.keyword || !rule.response) return null;
    return crmDB.addAutoReplyRule({
      keyword: String(rule.keyword).trim(),
      matchType: rule.matchType || "contains",
      response: String(rule.response).trim(),
      active: rule.active !== false,
    });
  }

  async updateRule(id, updatedFields) {
    return crmDB.updateAutoReplyRule(id, updatedFields || {});
  }

  async deleteRule(id) {
    return crmDB.deleteAutoReplyRule(id);
  }

  async findResponse(text, senderId, uploads = []) {
    const settings = await this.getSettings();
    if (!settings.botEnabled || (!text && (!uploads || uploads.length === 0))) return null;
    const cleanText = (text || "").trim();

    // 1. Check if MicroMind AI Mode is active for this account
    if (settings.aiMode === "micromind" && settings.microMindApiUrl) {
      try {
        const isAudioUpload = uploads && uploads.length > 0 && uploads.some(u => u.type === "audio");

        const rawPhone = (senderId || "").split("@")[0].replace(/\D/g, "");
        let contact = null;
        try {
          contact = await crmDB.getContact(senderId);
        } catch (e) {}

        const customerPhone = (contact && contact.phone && contact.phone !== rawPhone) ? contact.phone : (rawPhone || "");
        const customerName = contact?.name || "";
        const statusTag = contact?.status_tag || "new";

        const cairoDateTime = new Date().toLocaleString("ar-EG", {
          timeZone: "Africa/Cairo",
          dateStyle: "full",
          timeStyle: "short",
        });

        const customerContext = `[بيانات العميل المتحدث معك]:
- معرف الواتساب (contact_jid): ${senderId}
- رقم الهاتف (phone): ${customerPhone}
- الاسم: ${customerName}
- التصنيف: ${statusTag}
- تاريخ ووقت مصر الآن: ${cairoDateTime}`;

        const finalQuestion = isAudioUpload
          ? ""
          : `${customerContext}\n\n[رسالة العميل]:\n${cleanText || (uploads && uploads.length > 0 ? "يرجى تحليل المرفق بدقة" : "")}`;

        const payload = {
          question: finalQuestion,
          chatId: senderId || "default_user",
          overrideConfig: {
            vars: {
              contact_jid: senderId,
              phone: customerPhone,
              customer_name: customerName,
              status_tag: statusTag,
            },
          },
        };

        if (uploads && uploads.length > 0) {
          payload.uploads = uploads;
        }

        const response = await fetch(settings.microMindApiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.text) {
            return data.text;
          }
        } else {
          const errText = await response.text();
          console.error("[AutoReply] MicroMind API responded with error status:", response.status, errText);
        }
      } catch (err) {
        console.error("[AutoReply] MicroMind API Error:", err.message);
      }
    }

    // 2. Fallback to this account's own keyword rules
    const rules = await this.getRules();
    const lowerText = cleanText.toLowerCase();
    for (const rule of rules) {
      if (!rule.active) continue;
      const ruleKw = (rule.keyword || "").trim().toLowerCase();
      if (!ruleKw) continue;

      if (rule.matchType === "exact" && lowerText === ruleKw) {
        return rule.response;
      } else if (rule.matchType === "contains" && lowerText.includes(ruleKw)) {
        return rule.response;
      } else if (rule.matchType === "regex") {
        try {
          const re = new RegExp(rule.keyword, "i");
          if (re.test(lowerText)) return rule.response;
        } catch (err) {
          // ignore invalid regex
        }
      }
    }
    return null;
  }
}

module.exports = new AutoReplyEngine();
