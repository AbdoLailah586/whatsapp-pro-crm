const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");
const cookie = require("cookie");
const multer = require("multer");

const whatsapp = require("./whatsapp");
const autoReplyEngine = require("./autoReply");
const crmDB = require("./database");
const AutomationTools = require("./automationTools");
const BookingEngine = require("./bookingEngine");
const EmailNotifier = require("./emailNotifier");
const lidMapper = require("./lidMapper");
const { tenantContext, LEGACY_TENANT } = require("./tenant");
const {
  hashPassword,
  verifyPassword,
  setSessionCookie,
  clearSessionCookie,
  verifyToken,
  isValidEmail,
  COOKIE_NAME,
} = require("./auth");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "public", "uploads")));

// Per-account campaign image uploads land in that account's own folder
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, "public", "uploads", req.userId || "shared");
      try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const clean = (file.originalname || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
      cb(null, `${Date.now()}_${clean}`);
    },
  }),
});

// Route every WhatsApp event to the browser session(s) of that SAME
// account only, via a Socket.io room - never a global broadcast.
whatsapp.setEventEmitter((userId, event, data) => {
  io.to(`user:${userId}`).emit(event, data);
});

// ==========================================================
// Auth: register / login / logout / me
// A JWT in an httpOnly cookie is the session - no server-side
// session store needed. The very first account ever created on
// this deployment inherits all the data that already existed
// before multi-tenancy (contacts, campaigns, saved presets, the
// already-linked WhatsApp session) - everyone who registers after
// that gets a brand new, empty, fully isolated account.
// ==========================================================
const authRouter = express.Router();

authRouter.post("/register", async (req, res) => {
  try {
    let { email, password, displayName } = req.body || {};
    email = String(email || "").trim();
    if (!email) {
      return res.status(400).json({ error: "البريد الإلكتروني أو رقم الهاتف مطلوب." });
    }
    // Allow phone numbers as account identifier
    if (/^\+?\d{8,15}$/.test(email)) {
      email = `${email.replace(/\D/g, "")}@whatsapp.pro`;
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "بريد إلكتروني أو رقم هاتف غير صالح." });
    }
    if (!password || String(password).length < 6) {
      return res.status(400).json({ error: "كلمة المرور يجب ألا تقل عن 6 أحرف." });
    }

    const existing = await crmDB.getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: "هذا الحساب مسجّل بالفعل." });
    }

    const isFirstUser = (await crmDB.countUsers()) === 0;
    const id = isFirstUser ? LEGACY_TENANT : crypto.randomUUID();
    const passwordHash = await hashPassword(password);
    const user = await crmDB.createUser({ id, email, passwordHash, displayName });

    setSessionCookie(res, user);
    res.json({
      success: true,
      isFirstUser,
      user: { id: user.id, email: user.email, displayName: user.displayName },
    });
  } catch (err) {
    console.error("[Auth] register error:", err);
    res.status(500).json({ error: err.message });
  }
});

authRouter.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "البريد الإلكتروني وكلمة المرور مطلوبان." });
    }
    const user = await crmDB.getUserByEmail(email);
    if (!user) return res.status(401).json({ error: "بيانات الدخول غير صحيحة." });

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "بيانات الدخول غير صحيحة." });

    setSessionCookie(res, user);
    res.json({
      success: true,
      user: { id: user.id, email: user.email, displayName: user.display_name },
    });
  } catch (err) {
    console.error("[Auth] login error:", err);
    res.status(500).json({ error: err.message });
  }
});

authRouter.post("/logout", (req, res) => {
  clearSessionCookie(res);
  res.json({ success: true });
});

authRouter.get("/me", async (req, res) => {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    const payload = token && verifyToken(token);
    if (!payload || !payload.uid) return res.status(401).json({ error: "not signed in" });
    const user = await crmDB.getUserById(payload.uid);
    if (!user) return res.status(401).json({ error: "not signed in" });
    res.json({ success: true, user: { id: user.id, email: user.email, displayName: user.display_name } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use("/api/auth", authRouter);

// Everything else under /api requires a signed-in account, and runs
// with that account's tenant context active for every database call
// made anywhere during the request (see tenant.js).
function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  const payload = token && verifyToken(token);
  if (!payload || !payload.uid) {
    return res.status(401).json({ error: "غير مصرح - يرجى تسجيل الدخول." });
  }
  req.userId = payload.uid;
  req.userEmail = payload.email;
  next();
}

app.use("/api", requireAuth);
app.use("/api", (req, res, next) => {
  tenantContext.run({ userId: req.userId }, next);
});

// ==========================================================
// Socket.io - authenticate via the same session cookie, then
// join a private per-account room so events never cross accounts.
// ==========================================================
io.use((socket, next) => {
  try {
    const raw = socket.handshake.headers.cookie || "";
    const parsed = cookie.parse(raw);
    const token = parsed[COOKIE_NAME];
    const payload = token && verifyToken(token);
    if (!payload || !payload.uid) return next(new Error("unauthorized"));
    socket.userId = payload.uid;
    next();
  } catch (e) {
    next(new Error("unauthorized"));
  }
});

io.on("connection", (socket) => {
  socket.join(`user:${socket.userId}`);

  tenantContext.run({ userId: socket.userId }, async () => {
    try {
      const client = whatsapp.getClient(socket.userId);
      const rawContacts = await crmDB.getContacts();
      const contacts = rawContacts.map(c => {
        const isGrp = c.is_group === 1 || (c.jid && c.jid.endsWith("@g.us"));
        let cleanPhone = c.phone || "";
        if (!isGrp && (!cleanPhone || cleanPhone.length >= 14 || cleanPhone.includes("@") || c.jid.endsWith("@lid"))) {
          cleanPhone = lidMapper.resolveLidToPhone(c.phone || c.jid) || cleanPhone;
        }
        return { ...c, phone: cleanPhone };
      });
      const analytics = await crmDB.getAnalytics();
      const rules = await autoReplyEngine.getRules();
      const botEnabled = await autoReplyEngine.isBotEnabled();
      socket.emit("initial_state", {
        state: { ...client.getState(), botEnabled },
        rules,
        messages: client.getMessages(),
        contacts,
        analytics,
      });
    } catch (err) {
      socket.emit("initial_state", {
        state: whatsapp.getClient(socket.userId).getState(),
        rules: [],
        messages: [],
        contacts: [],
      });
    }
  });
});

// ==========================================================
// 1. Core WhatsApp & Bot Status Endpoints
// ==========================================================
app.get("/api/status", (req, res) => {
  const client = whatsapp.getClient(req.userId);
  res.json(client.getState());
});

app.post("/api/connect", async (req, res) => {
  try {
    const client = whatsapp.getClient(req.userId);
    if (client.status === "disconnected" || client.status === "close") {
      client.start();
    }
    res.json({ success: true, status: client.status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/messages", (req, res) => {
  const client = whatsapp.getClient(req.userId);
  res.json(client.getMessages());
});

app.get("/api/rules", async (req, res) => {
  res.json({
    botEnabled: await autoReplyEngine.isBotEnabled(),
    rules: await autoReplyEngine.getRules(),
  });
});

app.post("/api/rules", async (req, res) => {
  const { keyword, matchType, response } = req.body;
  if (!keyword || !response) {
    return res.status(400).json({ error: "Keyword and Response are required." });
  }
  const newRule = await autoReplyEngine.addRule({ keyword, matchType, response });
  io.to(`user:${req.userId}`).emit("rules_updated", {
    botEnabled: await autoReplyEngine.isBotEnabled(),
    rules: await autoReplyEngine.getRules(),
  });
  res.json(newRule);
});

app.put("/api/rules/:id", async (req, res) => {
  const updated = await autoReplyEngine.updateRule(req.params.id, req.body);
  if (!updated) {
    return res.status(404).json({ error: "Rule not found." });
  }
  io.to(`user:${req.userId}`).emit("rules_updated", {
    botEnabled: await autoReplyEngine.isBotEnabled(),
    rules: await autoReplyEngine.getRules(),
  });
  res.json(updated);
});

app.delete("/api/rules/:id", async (req, res) => {
  const deleted = await autoReplyEngine.deleteRule(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Rule not found." });
  }
  io.to(`user:${req.userId}`).emit("rules_updated", {
    botEnabled: await autoReplyEngine.isBotEnabled(),
    rules: await autoReplyEngine.getRules(),
  });
  res.json({ success: true });
});

app.post("/api/bot/toggle", async (req, res) => {
  const { enabled } = req.body;
  const current = await autoReplyEngine.setBotEnabled(
    enabled !== undefined ? enabled : !(await autoReplyEngine.isBotEnabled())
  );
  io.to(`user:${req.userId}`).emit("rules_updated", {
    botEnabled: current,
    rules: await autoReplyEngine.getRules(),
  });
  res.json({ botEnabled: current });
});

app.post("/api/send", async (req, res) => {
  const { to, text } = req.body;
  if (!to || !text) {
    return res.status(400).json({ error: "Recipient (to) and text are required." });
  }
  try {
    const client = whatsapp.getClient(req.userId);
    const result = await client.sendMessage(to, text);
    res.json({ success: true, message: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/logout", async (req, res) => {
  try {
    const client = whatsapp.getClient(req.userId);
    await client.logout();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================================
// 2. CRM & Smart Inbox Endpoints
// ==========================================================
app.get("/api/contacts", async (req, res) => {
  try {
    let search = req.query.search || "";
    if (search === "undefined" || search === "null") search = "";
    search = search.trim();

    let tag = req.query.tag || "all";
    if (tag === "undefined" || tag === "null" || !tag) tag = "all";
    tag = tag.trim();

    const contacts = await crmDB.getContacts(search, tag);
    const mapped = contacts.map(c => {
      const isGrp = c.is_group === 1 || (c.jid && c.jid.endsWith("@g.us"));
      let cleanPhone = c.phone || "";
      if (!isGrp && (!cleanPhone || cleanPhone.length >= 14 || cleanPhone.includes("@") || c.jid.endsWith("@lid"))) {
        cleanPhone = lidMapper.resolveLidToPhone(c.phone || c.jid) || cleanPhone;
      }
      return { ...c, phone: cleanPhone };
    });
    res.json({ success: true, contacts: mapped });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/export/contacts", async (req, res) => {
  try {
    let tag = req.query.tag || "all";
    if (tag === "undefined" || tag === "null" || !tag) tag = "all";
    tag = tag.trim();

    let groupJid = req.query.groupJid || null;
    const client = whatsapp.getClient(req.userId);

    let contactsToExport = [];

    if (groupJid) {
      const groupDetails = await client.getGroupDetails(groupJid);
      if (groupDetails && groupDetails.participants) {
        contactsToExport = groupDetails.participants.map(p => ({
          jid: p.id,
          phone: p.id.split("@")[0].replace(/\D/g, ""),
          isAdmin: p.admin ? true : false
        }));
      }
    } else {
      const contacts = await crmDB.getContacts("", tag);
      contactsToExport = contacts.map(c => {
        const isGrp = c.is_group === 1 || (c.jid && c.jid.endsWith("@g.us"));
        let cleanPhone = c.phone || "";
        if (!isGrp && (!cleanPhone || cleanPhone.length >= 14 || cleanPhone.includes("@") || c.jid.endsWith("@lid"))) {
          cleanPhone = lidMapper.resolveLidToPhone(c.phone || c.jid) || cleanPhone;
        }
        return {
          name: c.name || "",
          phone: cleanPhone,
          jid: c.jid,
          tag: c.status_tag,
          isGroup: isGrp
        };
      });
    }

    res.json({ success: true, count: contactsToExport.length, data: contactsToExport });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Extraction / export tool: contacts, one group, several groups, or every group ----
app.get("/api/export/groups", async (req, res) => {
  try {
    const client = whatsapp.getClient(req.userId);
    const groups = await client.getAllGroups();
    res.json({ success: true, groups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/export/extract", async (req, res) => {
  try {
    const client = whatsapp.getClient(req.userId);
    const {
      source = "groups",       // "groups" | "contacts" | "all-groups"
      groupJids = [],
      dedupe = true,
      includeNames = true,
      excludeAdmins = false,
      adminsOnly = false,
      excludeNumbers = [],
      tag = "all",
    } = req.body || {};

    let rawEntries = [];

    if (source === "contacts") {
      const contacts = await crmDB.getContacts("", tag);
      for (const c of contacts) {
        const isGrp = c.is_group === 1 || (c.jid && c.jid.endsWith("@g.us"));
        if (isGrp) continue;
        let phone = c.phone || "";
        if (!phone || phone.length >= 14 || phone.includes("@")) {
          phone = lidMapper.resolveLidToPhone(c.phone || c.jid) || phone;
        }
        if (!phone) continue;
        rawEntries.push({ phone, jid: c.jid, name: c.name || "", source: "crm" });
      }
    } else {
      let targetGroupJids = [];
      if (source === "all-groups") {
        const allGroups = await client.getAllGroups();
        targetGroupJids = allGroups.map(g => g.jid);
      } else {
        targetGroupJids = Array.isArray(groupJids) ? groupJids : [];
      }

      for (const gJid of targetGroupJids) {
        const details = await client.getGroupDetails(gJid);
        if (!details || !details.participants) continue;
        for (const p of details.participants) {
          if (adminsOnly && !p.isAdmin) continue;
          if (excludeAdmins && p.isAdmin) continue;
          const phone = p.phone || (p.id ? p.id.split("@")[0].replace(/\D/g, "") : "");
          if (!phone) continue;
          rawEntries.push({
            phone,
            jid: p.id,
            name: "",
            isAdmin: !!p.isAdmin,
            groupName: details.subject,
            groupJid: gJid,
            source: "group",
          });
        }
      }
    }

    if (includeNames) {
      const known = await crmDB.getContacts();
      const byPhone = new Map();
      for (const c of known) {
        if (c.phone) byPhone.set(c.phone, c.name);
      }
      for (const e of rawEntries) {
        if (!e.name && byPhone.has(e.phone)) e.name = byPhone.get(e.phone) || "";
      }
    }

    const excludeSet = new Set((excludeNumbers || []).map(n => String(n).replace(/\D/g, "")).filter(Boolean));
    if (excludeSet.size > 0) {
      rawEntries = rawEntries.filter(e => !excludeSet.has(e.phone));
    }

    let finalEntries = rawEntries;
    if (dedupe) {
      const map = new Map();
      for (const e of rawEntries) {
        if (!map.has(e.phone)) {
          map.set(e.phone, { ...e, groups: e.groupName ? [e.groupName] : undefined });
        } else if (e.groupName) {
          const existing = map.get(e.phone);
          if (!existing.groups) existing.groups = [];
          if (!existing.groups.includes(e.groupName)) existing.groups.push(e.groupName);
        }
      }
      finalEntries = Array.from(map.values());
    }

    res.json({
      success: true,
      count: finalEntries.length,
      duplicatesRemoved: rawEntries.length - finalEntries.length,
      data: finalEntries,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/contacts/:jid/messages", async (req, res) => {
  try {
    const jid = decodeURIComponent(req.params.jid);
    const messages = await crmDB.getMessages(jid);
    res.json({ success: true, messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Full WhatsApp-style Contact Details (Profile, Status/Bio, Avatar, Orders, Bookings, Shared Media)
app.get("/api/contacts/:jid/details", async (req, res) => {
  try {
    const jid = decodeURIComponent(req.params.jid);
    const client = whatsapp.getClient(req.userId);
    let contact = await crmDB.getContact(jid);
    if (!contact) {
      contact = { jid, name: jid.split("@")[0], phone: jid.split("@")[0], status_tag: "new" };
    }

    const isGroup = Number(contact.is_group) === 1 || jid.endsWith("@g.us");
    let resolvedPhone = isGroup ? "" : (contact.phone || lidMapper.resolveLidToPhone(jid) || (jid.endsWith("@s.whatsapp.net") ? jid.split("@")[0].replace(/\D/g, "") : ""));
    if (!isGroup && (resolvedPhone.length >= 14 || resolvedPhone.includes("@") || jid.endsWith("@lid"))) {
      resolvedPhone = lidMapper.resolveLidToPhone(resolvedPhone || jid) || resolvedPhone;
    }
    contact.phone = resolvedPhone;

    if (!contact.avatar_url && client.isConnected) {
      const avatarUrl = await client.getProfilePicture(jid);
      if (avatarUrl) {
        await crmDB.updateContactAvatar(jid, avatarUrl);
        contact.avatar_url = avatarUrl;
        io.to(`user:${req.userId}`).emit("contact_avatar_updated", { jid, avatar_url: avatarUrl });
      }
    }

    if (!contact.status_bio && client.isConnected) {
      const bio = await client.getContactStatus(jid);
      if (bio) {
        await crmDB.updateContactBio(jid, bio);
        contact.status_bio = bio;
      }
    }

    const cleanPhone = resolvedPhone;

    let orders = [];
    try {
      if (crmDB.isPostgres) {
        const oRes = await crmDB.q(
          "SELECT * FROM orders_leads WHERE contact_jid = $1 OR (phone != '' AND phone = $2) ORDER BY id DESC LIMIT 10",
          [jid, cleanPhone]
        );
        orders = oRes.rows;
      } else {
        orders = crmDB.db.prepare(
          "SELECT * FROM orders_leads WHERE contact_jid = ? OR (phone != '' AND phone = ?) ORDER BY id DESC LIMIT 10"
        ).all(jid, cleanPhone);
      }
    } catch (e) {}

    let bookings = [];
    try {
      if (crmDB.isPostgres) {
        const bRes = await crmDB.q(
          "SELECT * FROM bookings_appointments WHERE contact_jid = $1 OR (customer_phone != '' AND customer_phone = $2) ORDER BY id DESC LIMIT 10",
          [jid, cleanPhone]
        );
        bookings = bRes.rows;
      } else {
        bookings = crmDB.db.prepare(
          "SELECT * FROM bookings_appointments WHERE contact_jid = ? OR (customer_phone != '' AND customer_phone = ?) ORDER BY id DESC LIMIT 10"
        ).all(jid, cleanPhone);
      }
    } catch (e) {}

    let sharedMedia = [];
    try {
      if (crmDB.isPostgres) {
        const mRes = await crmDB.q(
          "SELECT id, text, media_type, media_url, timestamp, from_me FROM messages WHERE contact_jid = $1 AND media_url IS NOT NULL AND media_url != '' ORDER BY timestamp DESC LIMIT 30",
          [jid]
        );
        sharedMedia = mRes.rows;
      } else {
        sharedMedia = crmDB.db.prepare(
          "SELECT id, text, media_type, media_url, timestamp, from_me FROM messages WHERE contact_jid = ? AND media_url IS NOT NULL AND media_url != '' ORDER BY timestamp DESC LIMIT 30"
        ).all(jid);
      }
    } catch (e) {}

    let sharedGroupMessages = [];
    try {
      sharedGroupMessages = await crmDB.getSharedGroupsMessages(jid, 50);
    } catch (e) {}

    let groupDetails = null;
    if (isGroup) {
      groupDetails = await client.getGroupDetails(jid);
      if (groupDetails && groupDetails.participants) {
        try {
          const participantJids = groupDetails.participants.map(p => p.id);
          if (participantJids.length > 0) {
            let knownContacts = [];
            if (crmDB.isPostgres) {
              const kcRes = await crmDB.q(
                "SELECT jid, name, phone, avatar_url FROM contacts WHERE jid = ANY($1)",
                [participantJids]
              );
              knownContacts = kcRes.rows;
            } else {
              const placeholders = participantJids.map(() => "?").join(",");
              knownContacts = crmDB.db.prepare(
                `SELECT jid, name, phone, avatar_url FROM contacts WHERE jid IN (${placeholders})`
              ).all(...participantJids);
            }
            const knownMap = new Map(knownContacts.map(c => [c.jid, c]));
            groupDetails.participants = groupDetails.participants.map(p => {
              const kc = knownMap.get(p.id);
              return {
                ...p,
                name: (kc && kc.name && kc.name !== kc.phone) ? kc.name : "",
                avatarUrl: kc?.avatar_url || "",
              };
            });
          }
        } catch (e) {}
      }
    }

    res.json({
      success: true,
      contact,
      isGroup,
      groupDetails,
      orders,
      bookings,
      sharedMedia,
      sharedGroupMessages,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/contacts/:jid/group-activity", async (req, res) => {
  try {
    const jid = decodeURIComponent(req.params.jid);
    const messages = await crmDB.getSharedGroupsMessages(jid);
    res.json({ success: true, jid, messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/contacts/:jid/toggle-bot", async (req, res) => {
  try {
    const jid = decodeURIComponent(req.params.jid);
    const { paused } = req.body;
    await crmDB.toggleBotPaused(jid, !!paused);
    io.to(`user:${req.userId}`).emit("contact_updated", { jid, bot_paused: paused ? 1 : 0 });
    res.json({ success: true, jid, bot_paused: paused ? 1 : 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/contacts/:jid/profile", async (req, res) => {
  try {
    const jid = decodeURIComponent(req.params.jid);
    const { name, phone, city, governorate, address, status_tag, custom_notes } = req.body;
    await crmDB.updateContactProfile(jid, { name, phone, city, governorate, address, status_tag, custom_notes });
    const updated = await crmDB.getContact(jid);
    io.to(`user:${req.userId}`).emit("contact_updated", updated || { jid, name, phone, status_tag, custom_notes });
    res.json({ success: true, contact: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/contacts/:jid/tag", async (req, res) => {
  try {
    const jid = decodeURIComponent(req.params.jid);
    const { tag } = req.body;
    await crmDB.updateContactTag(jid, tag);
    io.to(`user:${req.userId}`).emit("contact_updated", { jid, status_tag: tag });
    res.json({ success: true, jid, status_tag: tag });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/contacts/:jid/notes", async (req, res) => {
  try {
    const jid = decodeURIComponent(req.params.jid);
    const { notes } = req.body;
    await crmDB.updateContactNotes(jid, notes);
    io.to(`user:${req.userId}`).emit("contact_updated", { jid, custom_notes: notes });
    res.json({ success: true, jid, custom_notes: notes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/contacts/:jid/read", async (req, res) => {
  try {
    const jid = decodeURIComponent(req.params.jid);
    await crmDB.markContactRead(jid);
    io.to(`user:${req.userId}`).emit("contact_read", { jid });
    res.json({ success: true, jid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/contacts/:jid/send", async (req, res) => {
  try {
    const jid = decodeURIComponent(req.params.jid);
    const { text, autoPauseBot } = req.body;
    if (!text) return res.status(400).json({ error: "Text is required." });

    if (autoPauseBot) {
      await crmDB.toggleBotPaused(jid, 1);
      io.to(`user:${req.userId}`).emit("contact_updated", { jid, bot_paused: 1 });
    }

    const client = whatsapp.getClient(req.userId);
    const sent = await client.sendMessage(jid, text, false);
    res.json({ success: true, message: sent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/contacts/:jid/send-voice", async (req, res) => {
  try {
    const jid = decodeURIComponent(req.params.jid);
    const { text, lang } = req.body;
    if (!text) return res.status(400).json({ error: "Text is required." });

    const client = whatsapp.getClient(req.userId);
    const result = await AutomationTools.sendVoiceNote(client, jid, text, lang || "ar");
    if (result.success) {
      const msgData = {
        id: "voice_" + Date.now(),
        sender: jid,
        senderName: "أنت (Me)",
        text: `🎙️ رسالة صوتية: "${text}"`,
        mediaType: "audio",
        mediaUrl: result.mediaUrl || "",
        fromMe: 1,
        autoReplied: 0,
        timestamp: Date.now(),
      };
      await crmDB.saveMessage(msgData);
      io.to(`user:${req.userId}`).emit("new_message", msgData);
      res.json({ success: true, message: "Voice note sent", mediaUrl: result.mediaUrl });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================================
// 3. Leads & Orders Management
// ==========================================================
app.get("/api/orders", async (req, res) => {
  try {
    const orders = await crmDB.getOrdersLeads();
    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/orders", async (req, res) => {
  try {
    const result = await AutomationTools.recordOrderLead(req.body);
    io.to(`user:${req.userId}`).emit("new_order", result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/orders/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    await crmDB.updateOrderStatus(req.params.id, status);
    res.json({ success: true, id: req.params.id, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================================
// 4. Marketing Campaigns & Broadcast Engine
// ==========================================================
app.get("/api/campaigns", async (req, res) => {
  try {
    const campaigns = await crmDB.getCampaigns();
    res.json({ success: true, campaigns });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/campaigns", upload.fields([{ name: "image", maxCount: 1 }, { name: "jsonFile", maxCount: 1 }]), async (req, res) => {
  try {
    let {
      title,
      template,
      contacts,
      delaySeconds,
      minDelay,
      maxDelay,
      batchSize,
      batchCooldownMinutes,
      enableTyping,
      enableSpintax,
      verifyWhatsApp,
    } = req.body || {};
    let imagePath = null;

    if (req.files && req.files.image && req.files.image[0]) {
      imagePath = req.files.image[0].path;
    } else if (req.file) {
      imagePath = req.file.path;
    }

    if ((!contacts || contacts === "[]") && req.files && req.files.jsonFile && req.files.jsonFile[0]) {
      try {
        const fileContent = fs.readFileSync(req.files.jsonFile[0].path, "utf8");
        const parsed = JSON.parse(fileContent);
        contacts = Array.isArray(parsed) ? parsed : (parsed.data || parsed.contacts || parsed.items || []);
      } catch (e) {
        return res.status(400).json({ error: "Invalid JSON file uploaded." });
      }
    }

    if (typeof contacts === "string") {
      try {
        contacts = JSON.parse(contacts);
      } catch (e) {
        return res.status(400).json({ error: "Invalid contacts format." });
      }
    }

    if (!title || !template || !Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ error: "Title, template, and contacts array are required." });
    }

    const client = whatsapp.getClient(req.userId);
    const userId = req.userId;
    const result = await AutomationTools.runCampaign(client, {
      title,
      template,
      contacts,
      imagePath,
      delaySeconds: Number(delaySeconds) || 8,
      minDelay: minDelay !== undefined && minDelay !== null && minDelay !== "" ? Number(minDelay) : null,
      maxDelay: maxDelay !== undefined && maxDelay !== null && maxDelay !== "" ? Number(maxDelay) : null,
      batchSize: batchSize !== undefined && batchSize !== null && batchSize !== "" ? Number(batchSize) : 25,
      batchCooldownMinutes: batchCooldownMinutes !== undefined && batchCooldownMinutes !== null && batchCooldownMinutes !== "" ? Number(batchCooldownMinutes) : 45,
      enableTyping: enableTyping === undefined || enableTyping === null || enableTyping === "true" || enableTyping === true || enableTyping === "1",
      enableSpintax: enableSpintax === undefined || enableSpintax === null || enableSpintax === "true" || enableSpintax === true || enableSpintax === "1",
      verifyWhatsApp: verifyWhatsApp === undefined || verifyWhatsApp === null || verifyWhatsApp === "true" || verifyWhatsApp === true || verifyWhatsApp === "1",
      ioEmitter: (evt, payload) => io.to(`user:${userId}`).emit(evt, payload),
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/campaigns/:id/control", async (req, res) => {
  try {
    const campaignId = req.params.id;
    const { action } = req.body;

    if (!['pause', 'resume', 'cancel', 'skip_cooldown'].includes(action)) {
      return res.status(400).json({ error: "Invalid action. Use 'pause', 'resume', 'cancel', or 'skip_cooldown'." });
    }

    if (AutomationTools.campaignState[campaignId]) {
      let newStatus = 'running';
      if (action === 'resume' || action === 'skip_cooldown') {
        newStatus = 'running';
        AutomationTools.campaignState[campaignId] = 'running';
      } else if (action === 'pause') {
        newStatus = 'paused';
        AutomationTools.campaignState[campaignId] = 'paused';
      } else if (action === 'cancel') {
        newStatus = 'cancelled';
        AutomationTools.campaignState[campaignId] = 'cancelled';
      }

      await crmDB.updateCampaignStatusOnly(campaignId, newStatus);

      io.to(`user:${req.userId}`).emit("campaign_status_changed", { campaignId, status: newStatus });
      res.json({ success: true, status: newStatus });
    } else {
      res.status(404).json({ error: "Campaign not active or already finished." });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/campaigns/:id/logs", async (req, res) => {
  try {
    const logs = await crmDB.getCampaignLogs(req.params.id);
    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/groups", async (req, res) => {
  try {
    const client = whatsapp.getClient(req.userId);
    const groups = await client.getAllGroups();
    res.json({ success: true, groups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/audience-presets", async (req, res) => {
  try {
    const presets = await crmDB.getAudiencePresets();
    res.json({ success: true, presets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/audience-presets", async (req, res) => {
  try {
    const { id, name, type, targetJids, excludedJids } = req.body;
    if (!name || !Array.isArray(targetJids)) {
      return res.status(400).json({ error: "Name and targetJids array are required." });
    }
    const preset = await crmDB.saveAudiencePreset({ id, name, type: type || "groups", targetJids, excludedJids: excludedJids || [] });
    io.to(`user:${req.userId}`).emit("audience_presets_updated", preset);
    res.json({ success: true, preset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/audience-presets/:id", async (req, res) => {
  try {
    await crmDB.deleteAudiencePreset(req.params.id);
    io.to(`user:${req.userId}`).emit("audience_presets_updated", { deletedId: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ==========================================================
// 5. Analytics & Dashboard Stats
// ==========================================================
app.get("/api/analytics", async (req, res) => {
  try {
    const analytics = await crmDB.getAnalytics();
    res.json({ success: true, analytics });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================================
// 6. MicroMind AI Custom Tools Endpoints (Cloudflare Webhook)
// Note: these are called BY your MicroMind chatflow, per account,
// so they still need a signed-in session like everything else here.
// ==========================================================
app.post("/api/tools/order", async (req, res) => {
  try {
    const { customerName, phone, orderDetails, address, totalPrice, contactJid } = req.body;
    const result = await AutomationTools.recordOrderLead({
      contactJid: contactJid || (phone ? `${phone.replace(/\D/g, "")}@s.whatsapp.net` : ""),
      customerName,
      phone,
      orderDetails,
      address,
      totalPrice,
    });
    io.to(`user:${req.userId}`).emit("new_order", result);
    res.json(result);
  } catch (err) {
    console.error("⚠️ [MicroMind Tool Error]:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/tools/voice", async (req, res) => {
  try {
    const { to, text, lang } = req.body;
    const client = whatsapp.getClient(req.userId);
    const result = await AutomationTools.sendVoiceNote(client, to, text, lang || "ar");
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/tools/takeover", async (req, res) => {
  try {
    const { contactJid } = req.body;
    if (contactJid) {
      await crmDB.toggleBotPaused(contactJid, 1);
      io.to(`user:${req.userId}`).emit("contact_updated", { jid: contactJid, bot_paused: 1 });
      return res.json({ success: true, message: "Human takeover activated" });
    }
    res.status(400).json({ error: "contactJid is required" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================================
// Settings: per-account business settings (bot/AI/rules-related)
// live in the database now; shared deployment infra (SMTP email,
// port) still lives in config.json since it's one mailbox/server
// for the whole deployment, not one per account.
// ==========================================================
app.get("/api/settings", async (req, res) => {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf-8"));
    const safeConfig = { ...config };
    if (safeConfig.emailPass) safeConfig.emailPass = "••••••••";
    delete safeConfig.autoReplyRules; // now per-account, served via /api/rules

    const tenantSettings = await autoReplyEngine.getSettings();
    res.json({ success: true, settings: { ...safeConfig, ...tenantSettings } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/settings", async (req, res) => {
  try {
    const updates = req.body || {};
    const tenantFields = ["botEnabled", "aiMode", "microMindApiUrl", "googleSheetWebhookUrl"];
    const tenantUpdates = {};
    const globalUpdates = {};
    for (const key of Object.keys(updates)) {
      if (tenantFields.includes(key)) tenantUpdates[key] = updates[key];
      else globalUpdates[key] = updates[key];
    }

    if (Object.keys(tenantUpdates).length > 0) {
      await crmDB.setBotSettings(tenantUpdates);
    }

    if (Object.keys(globalUpdates).length > 0) {
      const configPath = path.join(__dirname, "..", "config.json");
      const current = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      if (globalUpdates.emailPass === "••••••••") delete globalUpdates.emailPass;
      const updated = { ...current, ...globalUpdates };
      fs.writeFileSync(configPath, JSON.stringify(updated, null, 2), "utf-8");
    }

    const config = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf-8"));
    const safeConfig = { ...config };
    if (safeConfig.emailPass) safeConfig.emailPass = "••••••••";
    delete safeConfig.autoReplyRules;
    const tenantSettings = await autoReplyEngine.getSettings();
    res.json({ success: true, settings: { ...safeConfig, ...tenantSettings } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==========================================================
// 7. ReserveFlow Appointments & Booking Engine
// ==========================================================
app.get("/api/service", (req, res) => {
  res.json({ success: true, service: BookingEngine.getConfig() });
});

app.get("/api/availability", async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: "Date parameter is required (YYYY-MM-DD)" });
    const availability = await BookingEngine.getAvailableSlots(date);
    res.json(availability);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/bookings", async (req, res) => {
  try {
    const client = whatsapp.getClient(req.userId);
    const booking = await BookingEngine.createBooking(req.body);
    io.to(`user:${req.userId}`).emit("new_booking", booking);

    const dateFormatted = new Date(booking.startTime).toLocaleDateString("ar-EG", {
      timeZone: "Africa/Cairo", weekday: "long", year: "numeric", month: "long", day: "numeric"
    });
    const timeFormatted = new Date(booking.startTime).toLocaleTimeString("ar-EG", {
      timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit"
    });

    try {
      if (client.isConnected && booking.customerPhone) {
        const msg = `🎉 تم تأكيد حجز موعدك بنجاح يا ${booking.customerName}!\n\n📋 *تفاصيل التذكرة والموعد:*\n- كود الحجز: *${booking.referenceCode}*\n- التاريخ: ${dateFormatted}\n- الوقت: ${timeFormatted} (بتوقيت القاهرة)\n- رمز الإلغاء: ${booking.cancelToken}\n\nشكراً لتواصلك معنا! ✨`;
        await client.sendMessage(booking.customerPhone, msg);
      }
    } catch (msgErr) {
      console.warn("⚠️ WhatsApp booking notification error:", msgErr.message);
    }

    try {
      if (booking.customerEmail) {
        await EmailNotifier.sendBookingConfirmation(booking);
      }
    } catch (mailErr) {
      console.warn("⚠️ Email booking notification error:", mailErr.message);
    }

    res.status(201).json({ success: true, booking });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.get("/api/admin/bookings", async (req, res) => {
  try {
    const bookings = await BookingEngine.getAllBookings();
    res.json({ success: true, bookings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/bookings/:referenceCode/cancel", async (req, res) => {
  try {
    const { cancelToken } = req.body;
    const booking = await BookingEngine.cancelBooking(req.params.referenceCode, cancelToken);
    io.to(`user:${req.userId}`).emit("booking_cancelled", booking);
    if (booking && (booking.customerEmail || booking.customer_email)) {
      try {
        await EmailNotifier.sendCancellationNotification(booking);
      } catch (mailErr) {
        console.warn("⚠️ [EmailNotifier] Cancellation email error:", mailErr.message);
      }
    }
    res.json({ success: true, booking });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/tools/book-appointment", async (req, res) => {
  try {
    const { customerName, customerPhone, customerEmail, startTime, notes, contactJid } = req.body;
    const client = whatsapp.getClient(req.userId);
    const booking = await BookingEngine.createBooking({
      customerName,
      customerPhone: customerPhone || (contactJid ? contactJid.split("@")[0] : ""),
      customerEmail,
      startTime,
      notes,
      contactJid
    });
    io.to(`user:${req.userId}`).emit("new_booking", booking);

    if (client.isConnected && booking.customerPhone) {
      const dateFormatted = new Date(booking.startTime).toLocaleDateString("ar-EG", { timeZone: "Africa/Cairo", weekday: "long", year: "numeric", month: "long", day: "numeric" });
      const timeFormatted = new Date(booking.startTime).toLocaleTimeString("ar-EG", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit" });
      const msg = `🎉 تم تأكيد حجز موعدك بنجاح يا ${booking.customerName}!\n\n📋 *تفاصيل التذكرة والموعد:*\n- كود الحجز: *${booking.referenceCode}*\n- التاريخ: ${dateFormatted}\n- الوقت: ${timeFormatted} (بتوقيت القاهرة)\n- رمز الإلغاء: ${booking.cancelToken}\n\nشكراً لتواصلك معنا! ✨`;
      await client.sendMessage(booking.customerPhone, msg);
    }
    if (booking.customerEmail) {
      await EmailNotifier.sendBookingConfirmation(booking);
    }

    res.json({ success: true, booking });
  } catch (err) {
    console.error("⚠️ [MicroMind Tool Booking Error]:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = { server, app, io };
