const {
  default: makeWASocket,
  useMultiFileAuthState,
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

class WhatsAppClient {
  constructor() {
    this.socket = null;
    this.status = "disconnected"; // disconnected | connecting | qr_ready | connected
    this.qrDataUrl = null;
    this.user = null;
    this.eventEmitter = null; // function or socket.io emitter
    this.authDir = path.join(__dirname, "..", "auth_info");
    this.messagesHistory = [];
    this.groupCache = new Map(); // groupJid -> { id, subject, ... }
  }

  get isConnected() {
    return this.status === "connected" && !!this.socket;
  }

  setEventEmitter(emitter) {
    this.eventEmitter = emitter;
  }

  emit(event, data) {
    if (typeof this.eventEmitter === "function") {
      this.eventEmitter(event, data);
    }
  }

  async start() {
    this.status = "connecting";
    this.emit("status_change", { status: this.status });

    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
      const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));

      this.socket = makeWASocket({
        version,
        logger: pino({ level: "silent" }),
        printQRInTerminal: true,
        auth: state,
        browser: ["WhatsApp Pro Dashboard", "Chrome", "1.0.0"],
        syncFullHistory: false,
      });

      this.socket.ev.on("creds.update", saveCreds);

      this.socket.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.status = "qr_ready";
          try {
            this.qrDataUrl = await QRCode.toDataURL(qr);
          } catch (e) {
            this.qrDataUrl = null;
          }
          console.log("[WhatsApp] New QR code generated. Scan with your phone.");
          this.emit("status_change", {
            status: this.status,
            qr: this.qrDataUrl,
          });
        }

        if (connection === "close") {
          const statusCode = (lastDisconnect?.error instanceof Boom)
            ? lastDisconnect.error.output?.statusCode
            : lastDisconnect?.error?.statusCode;
          const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;

          console.log(`[WhatsApp] Connection closed (code: ${statusCode}). LoggedOut: ${isLoggedOut}`);
          this.status = "disconnected";
          this.qrDataUrl = null;
          this.user = null;

          if (isLoggedOut) {
            console.log("[WhatsApp] Session expired/logged out. Clearing session to generate fresh QR code...");
            try {
              if (fs.existsSync(this.authDir)) {
                fs.rmSync(this.authDir, { recursive: true, force: true });
              }
            } catch (e) {
              console.error("[WhatsApp] Error clearing authDir:", e.message);
            }
            this.emit("status_change", { status: "disconnected", reason: "logged_out" });
            setTimeout(() => this.start(), 1500);
          } else {
            this.emit("status_change", { status: this.status, reason: statusCode });
            setTimeout(() => this.start(), 3000);
          }
        } else if (connection === "open") {
          this.status = "connected";
          this.qrDataUrl = null;
          this.user = this.socket.user;
          console.log(`[WhatsApp] Connected successfully as ${this.user?.name || this.user?.id}!`);
          this.emit("status_change", {
            status: this.status,
            user: this.user,
          });

          // Preload and cache all WhatsApp groups
          try {
            const groups = await this.socket.groupFetchAllParticipating();
            for (const [gid, meta] of Object.entries(groups)) {
              this.groupCache.set(gid, meta);
              await crmDB.upsertContact(
                gid,
                meta.subject || "مجموعة واتساب",
                "",
                "",
                Date.now(),
                false,
                1
              );
            }
            console.log(`[WhatsApp] Cached ${Object.keys(groups).length} WhatsApp groups.`);
          } catch (gErr) {
            console.warn("[WhatsApp] Group preloading notice:", gErr.message);
          }
        }
      });

      // Handle incoming messages
      this.socket.ev.on("messages.upsert", async ({ messages, type }) => {
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
          const uploads = [];
          let mediaLabel = "";
          let mediaUrl = "";
          let mediaType = "text";

          const uploadsDir = path.join(__dirname, "public", "uploads");
          if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
          }

          try {
            if (msg.message.imageMessage) {
              mediaLabel = "📷 [صورة / Image]";
              mediaType = "image";
              const buffer = await downloadMediaMessage(
                msg,
                "buffer",
                {},
                { logger: pino({ level: "silent" }), reuploadRequest: this.socket.updateMediaMessage }
              );
              if (buffer) {
                const mime = msg.message.imageMessage.mimetype || "image/jpeg";
                const ext = mime.includes("png") ? "png" : "jpg";
                const fileName = `img_${msg.key.id}_${Date.now()}.${ext}`;
                const filePath = path.join(uploadsDir, fileName);
                fs.writeFileSync(filePath, buffer);
                mediaUrl = `/uploads/${fileName}`;

                uploads.push({
                  data: `data:${mime};base64,${buffer.toString("base64")}`,
                  type: "file",
                  name: fileName,
                  mime: mime,
                });
              }
            } else if (msg.message.audioMessage) {
              mediaLabel = "🎤 [تسجيل صوتي / Voice Note]";
              mediaType = "audio";
              const buffer = await downloadMediaMessage(
                msg,
                "buffer",
                {},
                { logger: pino({ level: "silent" }), reuploadRequest: this.socket.updateMediaMessage }
              );
              if (buffer) {
                const rawMime = msg.message.audioMessage.mimetype || "audio/ogg";
                const cleanMime = rawMime.split(";")[0].trim();
                const ext = cleanMime.includes("mp4") || cleanMime.includes("m4a") ? "mp4" : "ogg";
                const fileName = `audio_${msg.key.id}_${Date.now()}.${ext}`;
                const filePath = path.join(uploadsDir, fileName);
                fs.writeFileSync(filePath, buffer);
                mediaUrl = `/uploads/${fileName}`;

                uploads.push({
                  data: `data:${cleanMime};base64,${buffer.toString("base64")}`,
                  type: "audio",
                  name: fileName,
                  mime: cleanMime,
                });
              }
            } else if (msg.message.videoMessage) {
              mediaLabel = "🎥 [فيديو / Video]";
              mediaType = "video";
              const buffer = await downloadMediaMessage(
                msg,
                "buffer",
                {},
                { logger: pino({ level: "silent" }), reuploadRequest: this.socket.updateMediaMessage }
              );
              if (buffer) {
                const fileName = `vid_${msg.key.id}_${Date.now()}.mp4`;
                const filePath = path.join(uploadsDir, fileName);
                fs.writeFileSync(filePath, buffer);
                mediaUrl = `/uploads/${fileName}`;
              }
            } else if (msg.message.documentMessage) {
              mediaLabel = "📄 [ملف / Document]";
              mediaType = "document";
              const rawFileName = msg.message.documentMessage.fileName || "document.pdf";
              const cleanFileName = rawFileName.replace(/[^a-zA-Z0-9._-]/g, "_");
              const buffer = await downloadMediaMessage(
                msg,
                "buffer",
                {},
                { logger: pino({ level: "silent" }), reuploadRequest: this.socket.updateMediaMessage }
              );
              if (buffer) {
                const mime = msg.message.documentMessage.mimetype || "application/pdf";
                const fileName = `doc_${msg.key.id}_${cleanFileName}`;
                const filePath = path.join(uploadsDir, fileName);
                fs.writeFileSync(filePath, buffer);
                mediaUrl = `/uploads/${fileName}`;

                uploads.push({
                  data: `data:${mime};base64,${buffer.toString("base64")}`,
                  type: "file",
                  name: rawFileName,
                  mime: mime,
                });
              }
            } else if (msg.message.stickerMessage) {
              mediaLabel = "✨ [ملصق / Sticker]";
              mediaType = "image";
              const buffer = await downloadMediaMessage(
                msg,
                "buffer",
                {},
                { logger: pino({ level: "silent" }), reuploadRequest: this.socket.updateMediaMessage }
              );
              if (buffer) {
                const fileName = `stk_${msg.key.id}_${Date.now()}.webp`;
                const filePath = path.join(uploadsDir, fileName);
                fs.writeFileSync(filePath, buffer);
                mediaUrl = `/uploads/${fileName}`;
              }
            }
          } catch (mediaErr) {
            console.error("[WhatsApp] Error downloading incoming media:", mediaErr.message);
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

          // Save to persistent database
          await crmDB.saveMessage(msgData);

          // Store last 100 messages in memory for the UI
          this.messagesHistory.unshift(msgData);
          if (this.messagesHistory.length > 100) this.messagesHistory.pop();

          this.emit("new_message", msgData);

          // Handle Auto-Reply for incoming messages from others (DMs only - never reply in groups)
          if (!isFromMe && !isGroup) {
            // Check Human Takeover (bot_paused for this specific contact)
            const contact = await crmDB.getContact(remoteJid);
            if (contact && Number(contact.bot_paused) === 1) {
              console.log(`[AutoReply] Skipped for ${remoteJid} because Human Takeover is ACTIVE.`);
              continue;
            }

            try {
              const replyText = await autoReplyEngine.findResponse(text, remoteJid, uploads);
              if (replyText) {
                await this.sendMessage(remoteJid, replyText, true);
                msgData.autoReplied = true;
                this.emit("message_updated", msgData);
              }
            } catch (err) {
              console.error("[WhatsApp] Auto-reply send error:", err);
            }
          }
        }
      });
    } catch (error) {
      console.error("[WhatsApp] Initialization error:", error);
      this.status = "disconnected";
      this.emit("status_change", { status: this.status, error: error.message });
    }
  }

  async sendMessage(to, text, autoReplied = false) {
    if (!this.socket || this.status !== "connected") {
      throw new Error("WhatsApp client is not connected.");
    }

    // Format phone number / JID if not full JID
    let jid = to;
    if (!jid.includes("@")) {
      let clean = jid.replace(/\D/g, "");
      if (clean.startsWith("01") && clean.length === 11) {
        clean = "2" + clean;
      }
      jid = `${clean}@s.whatsapp.net`;
    }

    const sent = await this.socket.sendMessage(jid, { text });

    const sentData = {
      id: sent.key.id,
      sender: jid,
      senderName: autoReplied ? "البوت الذكي" : "أنت (Me)",
      text,
      timestamp: Date.now(),
      fromMe: true,
      autoReplied: !!autoReplied,
    };

    // Save sent message to database
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

    // Remove auth folder
    if (fs.existsSync(this.authDir)) {
      fs.rmSync(this.authDir, { recursive: true, force: true });
    }

    // Restart to give a new QR code
    setTimeout(() => this.start(), 1500);
  }

  getState() {
    return {
      status: this.status,
      qr: this.qrDataUrl,
      user: this.user,
      botEnabled: autoReplyEngine.isBotEnabled(),
    };
  }

  async getProfilePicture(jid) {
    if (!this.socket || !jid) return null;
    try {
      const url = await this.socket.profilePictureUrl(jid, "image");
      return url;
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
      if (!meta) {
        meta = this.groupCache.get(groupJid);
      }
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
          admin: p.admin, // 'admin' | 'superadmin' | null
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
      console.warn(`[WhatsApp] getGroupDetails warning for ${groupJid}:`, err.message);
      return this.groupCache.get(groupJid) || null;
    }
  }

  getMessages() {
    return this.messagesHistory;
  }
}

module.exports = new WhatsAppClient();
