const fs = require("fs");
const path = require("path");

class LidMapper {
  constructor() {
    this.authDir = path.join(__dirname, "..", "auth_info");
    this.lidToPhone = new Map();
    this.phoneToLid = new Map();
    this.isLoaded = false;
    this.loadMappings();
  }

  loadMappings() {
    try {
      if (!fs.existsSync(this.authDir)) return;
      const files = fs.readdirSync(this.authDir);
      let count = 0;
      for (const f of files) {
        if (f.startsWith("lid-mapping-") && f.endsWith("_reverse.json")) {
          const lid = f.replace("lid-mapping-", "").replace("_reverse.json", "");
          try {
            const raw = fs.readFileSync(path.join(this.authDir, f), "utf-8");
            const pn = JSON.parse(raw);
            if (pn && typeof pn === "string") {
              const cleanPn = pn.replace(/\D/g, "");
              this.lidToPhone.set(lid, cleanPn);
              this.phoneToLid.set(cleanPn, lid);
              count++;
            }
          } catch (e) {}
        }
      }
      this.isLoaded = true;
      console.log(`📱 [LID Mapper] Loaded ${count} LID-to-Phone mappings from auth.`);
    } catch (err) {
      console.warn("⚠️ [LID Mapper] Notice:", err.message);
    }
  }

  resolveLidToPhone(jidOrId) {
    if (!jidOrId) return "";
    const str = String(jidOrId).trim();

    // If newsletter or group
    if (str.endsWith("@g.us") || str.endsWith("@newsletter") || str.endsWith("@broadcast")) {
      return "";
    }

    // Clean user part
    const userPart = str.split("@")[0].split(":")[0].replace(/\D/g, "");
    if (!userPart) return "";

    // Check if userPart is in LID cache
    if (this.lidToPhone.has(userPart)) {
      return this.lidToPhone.get(userPart);
    }

    // Try dynamic file check if not cached yet
    try {
      const revPath = path.join(this.authDir, `lid-mapping-${userPart}_reverse.json`);
      if (fs.existsSync(revPath)) {
        const raw = fs.readFileSync(revPath, "utf-8");
        const pn = JSON.parse(raw);
        if (pn && typeof pn === "string") {
          const cleanPn = pn.replace(/\D/g, "");
          this.lidToPhone.set(userPart, cleanPn);
          this.phoneToLid.set(cleanPn, userPart);
          return cleanPn;
        }
      }
    } catch (e) {}

    // If it looks like a standard phone number (10-14 digits, typically starting with country code like 20, 966, 971, etc.)
    // Note: LIDs are usually 14-15 digit arbitrary internal numbers that don't match standard Egyptian or international mobile prefixes if checked without mapping.
    // If it was already a phone number JID (@s.whatsapp.net), userPart IS the phone number.
    if (str.endsWith("@s.whatsapp.net")) {
      return userPart;
    }

    return userPart;
  }

  formatPhoneNumber(phoneOrJid) {
    const raw = this.resolveLidToPhone(phoneOrJid);
    if (!raw) return "";

    // Format Egyptian numbers: 201XXXXXXXXX -> +20 1X XXXXXXXX
    if (raw.startsWith("20") && raw.length === 12) {
      const prefix = raw.substring(0, 2); // 20
      const operator = raw.substring(2, 4); // 10, 11, 12, 15
      const rest = raw.substring(4);
      return `+${prefix} ${operator} ${rest}`;
    }

    // Format 01XXXXXXXXX -> 01X XXXXXXXX
    if (raw.startsWith("01") && raw.length === 11) {
      const operator = raw.substring(0, 3);
      const rest = raw.substring(3);
      return `${operator} ${rest}`;
    }

    return `+${raw}`;
  }
}

module.exports = new LidMapper();
