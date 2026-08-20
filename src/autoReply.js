const fs = require("fs");
const path = require("path");
const crmDB = require("./database");

const CONFIG_PATH = path.join(__dirname, "..", "config.json");

class AutoReplyEngine {
  constructor() {
    this.config = this.loadConfig();
  }

  loadConfig() {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
        return JSON.parse(raw);
      }
    } catch (e) {
      console.error("Error reading config.json:", e);
    }
    return {
      port: 3000,
      botEnabled: true,
      autoReplyRules: [],
    };
  }

  saveConfig() {
    try {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2), "utf-8");
      return true;
    } catch (e) {
      console.error("Error saving config.json:", e);
      return false;
    }
  }

  isBotEnabled() {
    return !!this.config.botEnabled;
  }

  setBotEnabled(enabled) {
    this.config.botEnabled = !!enabled;
    this.saveConfig();
    return this.config.botEnabled;
  }

  getRules() {
    return this.config.autoReplyRules || [];
  }

  addRule(rule) {
    const newRule = {
      id: Date.now().toString(),
      keyword: rule.keyword.trim(),
      matchType: rule.matchType || "contains",
      response: rule.response.trim(),
      active: rule.active !== false,
    };
    this.config.autoReplyRules.push(newRule);
    this.saveConfig();
    return newRule;
  }

  updateRule(id, updatedFields) {
    const index = this.config.autoReplyRules.findIndex((r) => r.id === id);
    if (index !== -1) {
      this.config.autoReplyRules[index] = {
        ...this.config.autoReplyRules[index],
        ...updatedFields,
      };
      this.saveConfig();
      return this.config.autoReplyRules[index];
    }
    return null;
  }

  deleteRule(id) {
    const initialLen = this.config.autoReplyRules.length;
    this.config.autoReplyRules = this.config.autoReplyRules.filter((r) => r.id !== id);
    if (this.config.autoReplyRules.length !== initialLen) {
      this.saveConfig();
      return true;
    }
    return false;
  }

  async findResponse(text, senderId, uploads = []) {
    if (!this.isBotEnabled() || (!text && (!uploads || uploads.length === 0))) return null;
    const cleanText = (text || "").trim();

    // 1. Check if MicroMind AI Mode is active
    if (this.config.aiMode === "micromind" && this.config.microMindApiUrl) {
      try {
        const isAudioUpload = uploads && uploads.length > 0 && uploads.some(u => u.type === "audio");
        
        // Fetch current customer data
        const rawPhone = (senderId || "").split("@")[0].replace(/\D/g, "");
        let contact = null;
        try {
          contact = await crmDB.getContact(senderId);
        } catch (e) {}

        const customerPhone = (contact && contact.phone && contact.phone !== rawPhone) ? contact.phone : (rawPhone || "01558909252");
        const customerName = contact?.name || "عبدالله";
        const customerEmail = "blylh91@gmail.com";
        const statusTag = contact?.status_tag || "new";
        
        // Generate real-time Cairo date & time
        const cairoDateTime = new Date().toLocaleString("ar-EG", {
          timeZone: "Africa/Cairo",
          dateStyle: "full",
          timeStyle: "short",
        });

        const customerContext = `[بيانات العميل المتحدث معك]:
- معرف الواتساب (contact_jid): ${senderId}
- رقم الهاتف (phone): ${customerPhone}
- الاسم: ${customerName}
- البريد الإلكتروني (email): ${customerEmail}
- التصنيف: ${statusTag}
- تاريخ ووقت مصر الآن: ${cairoDateTime}`;

        const finalQuestion = isAudioUpload 
          ? "" 
          : `${customerContext}\n\n[رسالة العميل]:\n${cleanText || (uploads && uploads.length > 0 ? "يرجى تحليل المرفق بدقة" : "")}`;

        const payload = {
          // If audio upload, question must be empty string so Flowise Whisper transcribes it
          question: finalQuestion,
          chatId: senderId || "default_user",
          overrideConfig: {
            vars: {
              contact_jid: senderId,
              phone: customerPhone,
              customer_name: customerName,
              customer_email: customerEmail,
              status_tag: statusTag,
            },
          },
        };

        if (uploads && uploads.length > 0) {
          payload.uploads = uploads;
        }

        const response = await fetch(this.config.microMindApiUrl, {
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

    // 2. Fallback to static rules
    const lowerText = cleanText.toLowerCase();
    for (const rule of this.config.autoReplyRules) {
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
