const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const QRCode = require("qrcode");
const path = require("path");
const fs = require("fs");
const { Boom } = require("@hapi/boom");
const autoReplyEngine = require("./autoReply");
const crmDB = require("./database");
const lidMapper = require("./lidMapper");
const { useDbAuthState } = require("./dbAuthState");
const { runAsTenant, LEGACY_TENANT } = require("./tenant");

// ============================================================
// One WhatsAppClient per signed-in account. Each keeps its own
// connection, its own QR code, its own in-memory recent-message
// cache, and (crucially) its own auth-state persisted in that
// account's own part of the database - so one person's WhatsApp
// session can never bleed into another's.
// ============================================================
class WhatsAppClient {
  constructor(userId, emitter) {
    this.userId = userId;
    this.socket = null;
    this.status = "disconnected"; // disconnected | connecting | qr_ready | connected
    this.qrDataUrl = null;
    this.user = null;
    this.eventEmitter = emitter || null; // function(userId, event, data)
    this.messagesHistory = [];
    this.groupCache = new Map(); // groupJid -> { id, subject, ... }
    this.startedAt = Date.now();
    this._starting = false;
  }

  get isConnected() {
    return this.status === "connected" && !!this.socket;
  }

  setEventEmitter(emitter) {
    this.eventEmitter = emitter;
  }

  emit(event, data) {
    if (typeof this.eventEmitter === "function") {
      this.eventEmitter(this.userId, event, data);
    }
  }

  uploadsDir() {
    const dir = path.join(__dirname, "public", "uploads", this.userId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  uploadsUrl(fileName) {
    return `/uploads/${this.userId}/${fileName}`;
  }

  async start() {
    if (this._starting || this.status === "connected") return;
    this._starting = true;
    if (this._replaceTimer) clearTimeout(this._replaceTimer);

    if (this.socket) {
      try {
        this.socket.ev.removeAllListeners("creds.update");
        this.socket.ev.removeAllListeners("connection.update");
        this.socket.ev.removeAllListeners("messages.upsert");
      } catch (e) {}
    }

    this.status = "connecting";
    this.startedAt = Date.now();
    this.emit("status_change", { status: this.status });

    try {
      const { state, saveCreds } = await useDbAuthState(this.userId);
      const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));

      this.socket = makeWASocket({
        version,
        logger: pino({ level: "silent" }),
        printQRInTerminal: false,
        auth: state,
        browser: ["WhatsApp Pro Dashboard", "Chrome", "1.0.0"],
        syncFullHistory: false,
      });

      this.socket.ev.on("creds.update", saveCreds);

      this.socket.ev.on("connection.update", (update) =>
        runAsTenant(this.userId, () => this._handleConnectionUpdate(update))
      );

      this.socket.ev.on("messages.upsert", (payload) =>
        runAsTenant(this.userId, () => this._handleMessagesUpsert(payload))
      );
    } catch (error) {
      console.error(`[WhatsApp:${this.userId}] Initialization error:`, error);
      this.status = "disconnected";
      this.emit("status_change", { status: this.status, error: error.message });
    } finally {
      this._starting = false;
    }
  }

  async _handleConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      this.status = "qr_ready";
      this.qrDataUrl = await QRCode.toDataURL(qr);
      console.log(`[WhatsApp:${this.userId}] Scan QR code from browser...`);
      this.emit("status_change", {
        status: this.status,
        qr: this.qrDataUrl,
      });
    }

    if (connection === "close") {
      const statusCode = (lastDisconnect?.error instanceof Boom)
        ? lastDisconnect.error.output?.statusCode
        : 0;

      const isReplaced = statusCode === DisconnectReason.connectionReplaced || statusCode === 440;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;

      this.status = "disconnected";
      this.user = null;

      if (isReplaced) {
        console.warn(`[WhatsApp:${this.userId}] ⚠️ Connection replaced (code: 440). Another active instance (e.g. on Railway or local) connected with this WhatsApp session.`);
        this.emit("status_change", { status: "disconnected", reason: "connection_replaced" });
        // Attempt a calm reconnection after 25s in case the other instance (e.g. local) was stopped
        clearTimeout(this._replaceTimer);
        this._replaceTimer = setTimeout(() => {
          if (this.status === "disconnected") {
            console.log(`[WhatsApp:${this.userId}] Attempting gentle reconnect after connection replacement cooldown...`);
            this.start();
          }
        }, 25000);
        return;
      }

      const shouldReconnect = !isLoggedOut;
      console.log(`[WhatsApp:${this.userId}] Connection closed (code: ${statusCode}). Reconnect: ${shouldReconnect}`);

      if (shouldReconnect) {
        this.emit("status_change", { status: "connecting" });
        setTimeout(() => this.start(), 3000);
      } else {
        this.emit("status_change", { status: this.status, reason: statusCode });
      }
    } else if (connection === "open") {
      this.status = "connected";
      this.qrDataUrl = null;
      this.user = this.socket.user;
      console.log(`[WhatsApp:${this.userId}] Connected successfully as ${this.user?.name || this.user?.id}!`);
      this.emit("status_change", {
        status: this.status,
        user: this.user,
      });

      // Preload and cache all WhatsApp groups only if not already cached to prevent rate-overlimit
      if (this.groupCache.size === 0) {
        try {
          const groups = await this.socket.groupFetchAllParticipating();
          for (const [gid, meta] of Object.entries(groups)) {
            this.groupCache.set(gid, meta);
            await crmDB.upsertContact(
              gid,
              meta.subject || "مجموعة واتساب",
              "",
              "",
              meta.creation ? Number(meta.creation) * 1000 : 0,
              false,
              1
            );
          }
          console.log(`[WhatsApp:${this.userId}] Cached ${Object.keys(groups).length} WhatsApp groups.`);
        } catch (gErr) {
          console.warn(`[WhatsApp:${this.userId}] Group preloading notice:`, gErr.message);
        }
      }
    }
  }

  async _handleMessagesUpsert({ messages, type }) {
    if (type !== "notify" && type !== "append") return;

    for (const msg of messages) {
      if (!msg.message) continue;

      // Extract text content
      let text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        msg.message.videoMessage?.caption ||
        msg.message.documentMessage?.caption ||
        "";

      const remoteJid = msg.key.remoteJid;
      const isFromMe = !!msg.key.fromMe;
      const isGroup = remoteJid.endsWith("@g.us") || remoteJid.endsWith("@broadcast") || remoteJid.endsWith("@newsletter");
      const participantJid = isGroup
        ? (msg.key.participant || msg.participant || (isFromMe ? this.user?.id : ""))
        : (isFromMe ? this.user?.id : remoteJid);

      let chatName = "";
      let senderName = "";

      if (isGroup) {
        let groupMeta = this.groupCache.get(remoteJid);
        if (!groupMeta && this.socket && this.isConnected) {
          try {
            groupMeta = await this.socket.groupMetadata(remoteJid);
            if (groupMeta) this.groupCache.set(remoteJid, groupMeta);
          } catch (e) {}
        }
        chatName = groupMeta?.subject || "مجموعة واتساب";
        const participantPhone = participantJid ? participantJid.split("@")[0].replace(/\D/g, "") : "";
        senderName = isFromMe ? "أنت (Me)" : (msg.pushName || (participantPhone ? `+${participantPhone}` : "عضو"));
      } else {
        const remotePhone = remoteJid.split("@")[0].replace(/\D/g, "");
        chatName = msg.pushName || (isFromMe ? "أنت (Me)" : (remotePhone ? `+${remotePhone}` : remoteJid.split("@")[0]));
        senderName = isFromMe ? "أنت (Me)" : (msg.pushName || (remotePhone ? `+${remotePhone}` : remoteJid.split("@")[0]));
      }

      const timestamp = msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : Date.now();

      // Don't process system status broadcasts
      if (remoteJid === "status@broadcast") continue;

      // Process Media (Images, Voice Notes / Audio, Videos, Documents)
      let mediaLabel = "";
      let mediaUrl = "";
      let mediaType = "text";
      const uploadsDir = this.uploadsDir();

      try {
        if (msg.message.imageMessage) {
          mediaLabel = "📷 [صورة / Image]";
          mediaType = "image";
          const buffer = await downloadMediaMessage(
            msg, "buffer", {},
            { logger: pino({ level: "silent" }), reuploadRequest: this.socket.updateMediaMessage }
          );
          if (buffer) {
            const mime = msg.message.imageMessage.mimetype || "image/jpeg";
            const ext = mime.includes("png") ? "png" : "jpg";
            const fileName = `img_${msg.key.id}_${Date.now()}.${ext}`;
            fs.writeFileSync(path.join(uploadsDir, fileName), buffer);
            mediaUrl = this.uploadsUrl(fileName);
          }
        } else if (msg.message.audioMessage) {
          mediaLabel = "🎤 [تسجيل صوتي / Voice Note]";
          mediaType = "audio";
          const buffer = await downloadMediaMessage(
            msg, "buffer", {},
            { logger: pino({ level: "silent" }), reuploadRequest: this.socket.updateMediaMessage }
          );
          if (buffer) {
            const rawMime = msg.message.audioMessage.mimetype || "audio/ogg";
            const cleanMime = rawMime.split(";")[0].trim();
            const ext = cleanMime.includes("mp4") || cleanMime.includes("m4a") ? "mp4" : "ogg";
            const fileName = `audio_${msg.key.id}_${Date.now()}.${ext}`;
            fs.writeFileSync(path.join(uploadsDir, fileName), buffer);
            mediaUrl = this.uploadsUrl(fileName);
          }
        } else if (msg.message.videoMessage) {
          mediaLabel = "🎥 [فيديو / Video]";
          mediaType = "video";
          const buffer = await downloadMediaMessage(
            msg, "buffer", {},
            { logger: pino({ level: "silent" }), reuploadRequest: this.socket.updateMediaMessage }
          );
          if (buffer) {
            const fileName = `vid_${msg.key.id}_${Date.now()}.mp4`;
            fs.writeFileSync(path.join(uploadsDir, fileName), buffer);
            mediaUrl = this.uploadsUrl(fileName);
          }
        } else if (msg.message.documentMessage) {
          mediaLabel = "📄 [ملف / Document]";
          mediaType = "document";
          const buffer = await downloadMediaMessage(
            msg, "buffer", {},
            { logger: pino({ level: "silent" }), reuploadRequest: this.socket.updateMediaMessage }
          );
          if (buffer) {
            const rawFileName = msg.message.documentMessage.fileName || "document.pdf";
            const cleanFileName = rawFileName.replace(/[^a-zA-Z0-9._-]/g, "_");
            const fileName = `doc_${msg.key.id}_${cleanFileName}`;
            fs.writeFileSync(path.join(uploadsDir, fileName), buffer);
            mediaUrl = this.uploadsUrl(fileName);
          }
        } else if (msg.message.stickerMessage) {
          mediaLabel = "✨ [ملصق / Sticker]";
          mediaType = "image";
          const buffer = await downloadMediaMessage(
            msg, "buffer", {},
            { logger: pino({ level: "silent" }), reuploadRequest: this.socket.updateMediaMessage }
          );
          if (buffer) {
            const fileName = `stk_${msg.key.id}_${Date.now()}.webp`;
            fs.writeFileSync(path.join(uploadsDir, fileName), buffer);
            mediaUrl = this.uploadsUrl(fileName);
          }
        }
      } catch (mediaErr) {
        console.error(`[WhatsApp:${this.userId}] Error downloading incoming media:`, mediaErr.message);
      }

      if (!text && !mediaLabel && !mediaUrl) continue;

      const displayText = text || mediaLabel || "";

      const msgData = {
        id: msg.key.id,
        sender: remoteJid,
        participantJid,
        senderName,
        chatName,
        isGroup,
        text: displayText,
        mediaType,
        mediaUrl,
        timestamp,
        fromMe: isFromMe,
        autoReplied: false,
      };

      // Save to persistent database (this account's own tenant storage)
      await crmDB.saveMessage(msgData);

      this.messagesHistory.unshift(msgData);
      if (this.messagesHistory.length > 100) this.messagesHistory.pop();

      this.emit("new_message", msgData);

      // Handle Auto-Reply for incoming messages from others (DMs only - never reply in groups)
      if (!isFromMe && !isGroup) {
        const isHistorical = timestamp < (this.startedAt - 15000) || (Date.now() - timestamp > 180000);
        if (isHistorical) {
          console.log(`[AutoReply:${this.userId}] ⏭️ Skipped offline/backlog message from ${remoteJid}. Message saved to CRM.`);
          continue;
        }

        const contact = await crmDB.getContact(remoteJid);
        if (contact && Number(contact.bot_paused) === 1) {
          console.log(`[AutoReply:${this.userId}] Skipped for ${remoteJid} because Human Takeover is ACTIVE.`);
          continue;
        }

        try {
          const replyText = await autoReplyEngine.findResponse(text, remoteJid, []);
          if (replyText) {
            await this.sendMessage(remoteJid, replyText, true);
            msgData.autoReplied = true;
            this.emit("message_updated", msgData);
          }
        } catch (err) {
          console.error(`[WhatsApp:${this.userId}] Auto-reply send error:`, err);
        }
      }
    }
  }

  async sendMessage(to, text, autoReplied = false, imageBuffer = null) {
    if (!this.socket || this.status !== "connected") {
      throw new Error("WhatsApp client is not connected.");
    }

    let jid = to;
    if (!jid.includes("@")) {
      let clean = jid.replace(/\D/g, "");
      if (clean.startsWith("01") && clean.length === 11) {
        clean = "2" + clean;
      }
      jid = `${clean}@s.whatsapp.net`;
    }

    let sent;
    if (imageBuffer) {
      sent = await this.socket.sendMessage(jid, { image: imageBuffer, caption: text });
    } else {
      sent = await this.socket.sendMessage(jid, { text });
    }

    const sentData = {
      id: sent.key.id,
      sender: jid,
      senderName: autoReplied ? "البوت الذكي" : "أنت (Me)",
      text: text || (imageBuffer ? "صورة" : ""),
      mediaType: imageBuffer ? "image" : null,
      timestamp: Date.now(),
      fromMe: true,
      autoReplied: !!autoReplied,
    };

    await crmDB.saveMessage(sentData);

    this.messagesHistory.unshift(sentData);
    if (this.messagesHistory.length > 100) this.messagesHistory.pop();
    this.emit("new_message", sentData);

    return sentData;
  }

  async logout() {
    if (this.socket) {
      try {
        await this.socket.logout();
      } catch (e) {}
    }
    this.status = "disconnected";
    this.qrDataUrl = null;
    this.user = null;
    this.emit("status_change", { status: this.status });

    // Clear this account's stored WhatsApp session so a fresh QR is issued
    await runAsTenant(this.userId, () => crmDB.clearAuthBlobs(this.userId));

    setTimeout(() => this.start(), 1500);
  }

  getState() {
    return {
      status: this.status,
      qr: this.qrDataUrl,
      user: this.user,
      botEnabled: true, // per-tenant bot toggle is fetched separately via /api/rules
    };
  }

  async getProfilePicture(jid) {
    if (!this.socket || !jid) return null;
    try {
      return await this.socket.profilePictureUrl(jid, "image");
    } catch (e) {
      return null;
    }
  }

  async getContactStatus(jid) {
    if (!this.socket || !jid) return null;
    try {
      const res = await this.socket.fetchStatus(jid);
      return res?.status || null;
    } catch (e) {
      return null;
    }
  }

  async getGroupDetails(groupJid) {
    if (!groupJid) return null;
    try {
      let meta = null;
      if (this.socket && this.isConnected) {
        meta = await this.socket.groupMetadata(groupJid);
      }
      if (!meta) meta = this.groupCache.get(groupJid);
      if (!meta) return null;

      let avatarUrl = "";
      if (this.socket && this.isConnected) {
        try {
          avatarUrl = await this.socket.profilePictureUrl(groupJid, "image");
        } catch (e) {}
      }

      const participants = (meta.participants || []).map((p) => {
        const phone = p.id ? (lidMapper.resolveLidToPhone(p.id) || p.id.split("@")[0].replace(/\D/g, "")) : "";
        return {
          id: p.id,
          phone,
          admin: p.admin,
          isAdmin: p.admin === "admin" || p.admin === "superadmin",
          isSuperAdmin: p.admin === "superadmin",
        };
      });

      const details = {
        id: meta.id || groupJid,
        subject: meta.subject || "مجموعة واتساب",
        desc: meta.desc || "",
        owner: meta.owner || meta.subjectOwner || "",
        creation: meta.creation ? meta.creation * 1000 : null,
        participantCount: participants.length,
        participants,
        avatarUrl: avatarUrl || "",
      };

      this.groupCache.set(groupJid, details);
      return details;
    } catch (err) {
      console.warn(`[WhatsApp:${this.userId}] getGroupDetails warning for ${groupJid}:`, err.message);
      return this.groupCache.get(groupJid) || null;
    }
  }

  async getAllGroups() {
    try {
      if (this.socket && this.isConnected) {
        const groupsObj = await this.socket.groupFetchAllParticipating();
        const groupsList = Object.values(groupsObj || {}).map((g) => ({
          jid: g.id,
          name: g.subject || "مجموعة واتساب",
          subject: g.subject || "مجموعة واتساب",
          participantCount: g.participants?.length || 0,
          desc: g.desc || "",
          creation: g.creation ? g.creation * 1000 : null,
          is_group: 1,
        }));
        for (const g of Object.values(groupsObj || {})) {
          this.groupCache.set(g.id, g);
        }
        return groupsList;
      }
    } catch (e) {
      console.warn(`[WhatsApp:${this.userId}] groupFetchAllParticipating notice:`, e.message);
    }
    try {
      const dbGroups = await crmDB.getContacts("", "groups");
      return dbGroups.map((g) => ({
        jid: g.jid,
        name: g.name || "مجموعة واتساب",
        subject: g.name || "مجموعة واتساب",
        participantCount: 0,
        is_group: 1,
      }));
    } catch (e) {
      return [];
    }
  }

  getMessages() {
    return this.messagesHistory;
  }
}

// ============================================================
// Manager: one WhatsAppClient per account, created on demand.
// Everything server.js used to call directly on the old singleton
// (`whatsapp.getState()`, `whatsapp.sendMessage(...)`, ...) is now
// called on `whatsapp.getClient(userId)` instead.
// ============================================================
class WhatsAppManager {
  constructor() {
    this.clients = new Map(); // userId -> WhatsAppClient
    this.eventEmitter = null; // function(userId, event, data)
  }

  setEventEmitter(emitter) {
    this.eventEmitter = emitter;
    for (const client of this.clients.values()) client.setEventEmitter(emitter);
  }

  getClient(userId) {
    const key = userId || LEGACY_TENANT;
    let client = this.clients.get(key);
    if (!client) {
      client = new WhatsAppClient(key, this.eventEmitter);
      this.clients.set(key, client);
      client.start();
    }
    return client;
  }

  hasClient(userId) {
    return this.clients.has(userId || LEGACY_TENANT);
  }

  // Boot the legacy/default account's WhatsApp connection automatically
  // at server startup (matches the original single-tenant behaviour).
  bootLegacy() {
    this.getClient(LEGACY_TENANT);
  }
}

module.exports = new WhatsAppManager();
