const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const whatsapp = require("./whatsapp");
const autoReplyEngine = require("./autoReply");
const crmDB = require("./database");
const AutomationTools = require("./automationTools");
const BookingEngine = require("./bookingEngine");
const EmailNotifier = require("./emailNotifier");
const lidMapper = require("./lidMapper");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "public", "uploads")));

// Link WhatsApp client events to Socket.io
whatsapp.setEventEmitter((event, data) => {
  io.emit(event, data);
});

// Socket connection
io.on("connection", async (socket) => {
  // Send current state and CRM data to newly connected client
  try {
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
    socket.emit("initial_state", {
      state: whatsapp.getState(),
      rules: autoReplyEngine.getRules(),
      messages: whatsapp.getMessages(),
      contacts,
      analytics,
    });
  } catch (err) {
    socket.emit("initial_state", {
      state: whatsapp.getState(),
      rules: autoReplyEngine.getRules(),
      messages: whatsapp.getMessages(),
      contacts: [],
    });
  }
});

// ==========================================
// 1. Core WhatsApp & Bot Status Endpoints
// ==========================================
app.get("/api/status", (req, res) => {
  res.json(whatsapp.getState());
});

app.get("/api/messages", (req, res) => {
  res.json(whatsapp.getMessages());
});

app.get("/api/rules", (req, res) => {
  res.json({
    botEnabled: autoReplyEngine.isBotEnabled(),
    rules: autoReplyEngine.getRules(),
  });
});

app.post("/api/rules", (req, res) => {
  const { keyword, matchType, response } = req.body;
  if (!keyword || !response) {
    return res.status(400).json({ error: "Keyword and Response are required." });
  }
  const newRule = autoReplyEngine.addRule({ keyword, matchType, response });
  io.emit("rules_updated", {
    botEnabled: autoReplyEngine.isBotEnabled(),
    rules: autoReplyEngine.getRules(),
  });
  res.json(newRule);
});

app.put("/api/rules/:id", (req, res) => {
  const updated = autoReplyEngine.updateRule(req.params.id, req.body);
  if (!updated) {
    return res.status(404).json({ error: "Rule not found." });
  }
  io.emit("rules_updated", {
    botEnabled: autoReplyEngine.isBotEnabled(),
    rules: autoReplyEngine.getRules(),
  });
  res.json(updated);
});

app.delete("/api/rules/:id", (req, res) => {
  const deleted = autoReplyEngine.deleteRule(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Rule not found." });
  }
  io.emit("rules_updated", {
    botEnabled: autoReplyEngine.isBotEnabled(),
    rules: autoReplyEngine.getRules(),
  });
  res.json({ success: true });
});

app.post("/api/bot/toggle", (req, res) => {
  const { enabled } = req.body;
  const current = autoReplyEngine.setBotEnabled(enabled !== undefined ? enabled : !autoReplyEngine.isBotEnabled());
  io.emit("rules_updated", {
    botEnabled: current,
    rules: autoReplyEngine.getRules(),
  });
  res.json({ botEnabled: current });
});

app.post("/api/send", async (req, res) => {
  const { to, text } = req.body;
  if (!to || !text) {
    return res.status(400).json({ error: "Recipient (to) and text are required." });
  }
  try {
    const result = await whatsapp.sendMessage(to, text);
    res.json({ success: true, message: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/logout", async (req, res) => {
  try {
    await whatsapp.logout();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 2. CRM & Smart Inbox Endpoints
// ==========================================
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
      return {
        ...c,
        phone: cleanPhone,
      };
    });
    res.json({ success: true, contacts: mapped });
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

    // Try to fetch latest avatar if missing
    if (!contact.avatar_url && whatsapp.isConnected) {
      const avatarUrl = await whatsapp.getProfilePicture(jid);
      if (avatarUrl) {
        await crmDB.updateContactAvatar(jid, avatarUrl);
        contact.avatar_url = avatarUrl;
        io.emit("contact_avatar_updated", { jid, avatar_url: avatarUrl });
      }
    }

    // Try to fetch WhatsApp status/bio if missing
    if (!contact.status_bio && whatsapp.isConnected) {
      const bio = await whatsapp.getContactStatus(jid);
      if (bio) {
        await crmDB.updateContactBio(jid, bio);
        contact.status_bio = bio;
      }
    }

    const cleanPhone = resolvedPhone;

    // Fetch related Orders
    let orders = [];
    try {
      if (crmDB.isPostgres) {
        const oRes = await crmDB.pgPool.query(
          "SELECT * FROM orders_leads WHERE contact_jid = $1 OR (phone != '' AND phone = $2) ORDER BY id DESC LIMIT 10",
          [jid, cleanPhone]
        );
        orders = oRes.rows;
      } else {
        orders = crmDB.sqliteDb.prepare(
          "SELECT * FROM orders_leads WHERE contact_jid = ? OR (phone != '' AND phone = ?) ORDER BY id DESC LIMIT 10"
        ).all(jid, cleanPhone);
      }
    } catch (e) {}

    // Fetch related Bookings
    let bookings = [];
    try {
      if (crmDB.isPostgres) {
        const bRes = await crmDB.pgPool.query(
          "SELECT * FROM bookings_appointments WHERE contact_jid = $1 OR (customer_phone != '' AND customer_phone = $2) ORDER BY id DESC LIMIT 10",
          [jid, cleanPhone]
        );
        bookings = bRes.rows;
      } else {
        bookings = crmDB.sqliteDb.prepare(
          "SELECT * FROM bookings_appointments WHERE contact_jid = ? OR (customer_phone != '' AND customer_phone = ?) ORDER BY id DESC LIMIT 10"
        ).all(jid, cleanPhone);
      }
    } catch (e) {}

    // Fetch Shared Media
    let sharedMedia = [];
    try {
      if (crmDB.isPostgres) {
        const mRes = await crmDB.pgPool.query(
          "SELECT id, text, media_type, media_url, timestamp, from_me FROM messages WHERE contact_jid = $1 AND media_url IS NOT NULL AND media_url != '' ORDER BY timestamp DESC LIMIT 30",
          [jid]
        );
        sharedMedia = mRes.rows;
      } else {
        sharedMedia = crmDB.sqliteDb.prepare(
          "SELECT id, text, media_type, media_url, timestamp, from_me FROM messages WHERE contact_jid = ? AND media_url IS NOT NULL AND media_url != '' ORDER BY timestamp DESC LIMIT 30"
        ).all(jid);
      }
    } catch (e) {}

    // Fetch Shared Group Messages sent by this contact across all groups
    let sharedGroupMessages = [];
    try {
      sharedGroupMessages = await crmDB.getSharedGroupsMessages(jid, 50);
    } catch (e) {}

    // If this is a Group, fetch full WhatsApp Group Metadata & Participants
    let groupDetails = null;
    if (isGroup && whatsapp) {
      groupDetails = await whatsapp.getGroupDetails(jid);
      if (groupDetails && groupDetails.participants) {
        try {
          const participantJids = groupDetails.participants.map(p => p.id);
          if (participantJids.length > 0) {
            let knownContacts = [];
            if (crmDB.isPostgres) {
              const kcRes = await crmDB.pgPool.query(
                "SELECT jid, name, phone, avatar_url FROM contacts WHERE jid = ANY($1)",
                [participantJids]
              );
              knownContacts = kcRes.rows;
            } else {
              const placeholders = participantJids.map(() => "?").join(",");
              knownContacts = crmDB.sqliteDb.prepare(
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

// Get all messages sent by this contact in all shared WhatsApp groups
app.get("/api/contacts/:jid/group-activity", async (req, res) => {
  try {
    const jid = decodeURIComponent(req.params.jid);
    const messages = await crmDB.getSharedGroupsMessages(jid);
    res.json({ success: true, jid, messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Human Takeover: Toggle Bot Paused per Contact
app.post("/api/contacts/:jid/toggle-bot", async (req, res) => {
  try {
    const jid = decodeURIComponent(req.params.jid);
    const { paused } = req.body;
    await crmDB.toggleBotPaused(jid, !!paused);
    io.emit("contact_updated", { jid, bot_paused: paused ? 1 : 0 });
    res.json({ success: true, jid, bot_paused: paused ? 1 : 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update Contact Profile (Name, Phone, City, Governorate, Address, Status Tag, Notes)
app.post("/api/contacts/:jid/profile", async (req, res) => {
  try {
    const jid = decodeURIComponent(req.params.jid);
    const { name, phone, city, governorate, address, status_tag, custom_notes } = req.body;
    await crmDB.updateContactProfile(jid, { name, phone, city, governorate, address, status_tag, custom_notes });
    const updated = await crmDB.getContact(jid);
    io.emit("contact_updated", updated || { jid, name, phone, status_tag, custom_notes });
    res.json({ success: true, contact: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update Contact Status Tag (new, interested, ordered, vip, support, closed)
app.post("/api/contacts/:jid/tag", async (req, res) => {
  try {
    const jid = decodeURIComponent(req.params.jid);
    const { tag } = req.body;
    await crmDB.updateContactTag(jid, tag);
    io.emit("contact_updated", { jid, status_tag: tag });
    res.json({ success: true, jid, status_tag: tag });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update Contact Custom Notes
app.post("/api/contacts/:jid/notes", async (req, res) => {
  try {
    const jid = decodeURIComponent(req.params.jid);
    const { notes } = req.body;
    await crmDB.updateContactNotes(jid, notes);
    io.emit("contact_updated", { jid, custom_notes: notes });
    res.json({ success: true, jid, custom_notes: notes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark Contact as Read
app.post("/api/contacts/:jid/read", async (req, res) => {
  try {
    const jid = decodeURIComponent(req.params.jid);
    await crmDB.markContactRead(jid);
    io.emit("contact_read", { jid });
    res.json({ success: true, jid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send Manual Message from Dashboard
app.post("/api/contacts/:jid/send", async (req, res) => {
  try {
    const jid = decodeURIComponent(req.params.jid);
    const { text, autoPauseBot } = req.body;
    if (!text) return res.status(400).json({ error: "Text is required." });

    // If admin replies, optionally auto-pause bot (Human takeover) so AI doesn't interfere
    if (autoPauseBot) {
      await crmDB.toggleBotPaused(jid, 1);
      io.emit("contact_updated", { jid, bot_paused: 1 });
    }

    const sent = await whatsapp.sendMessage(jid, text, false);
    res.json({ success: true, message: sent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send Natural Arabic Voice Note
app.post("/api/contacts/:jid/send-voice", async (req, res) => {
  try {
    const jid = decodeURIComponent(req.params.jid);
    const { text, lang } = req.body;
    if (!text) return res.status(400).json({ error: "Text is required." });

    const result = await AutomationTools.sendVoiceNote(whatsapp, jid, text, lang || "ar");
    if (result.success) {
      // Save message to CRM DB
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
      io.emit("new_message", msgData);
      res.json({ success: true, message: "Voice note sent", mediaUrl: result.mediaUrl });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 3. Leads & Orders Management
// ==========================================
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
    io.emit("new_order", result);
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

// ==========================================
// 4. Marketing Campaigns & Broadcast Engine
// ==========================================
app.get("/api/campaigns", async (req, res) => {
  try {
    const campaigns = await crmDB.getCampaigns();
    res.json({ success: true, campaigns });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/campaigns", async (req, res) => {
  try {
    const { title, template, contacts, delaySeconds } = req.body;
    if (!title || !template || !Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ error: "Title, template, and contacts array are required." });
    }

    const result = await AutomationTools.runCampaign(whatsapp, {
      title,
      template,
      contacts,
      delaySeconds: Number(delaySeconds) || 8,
      ioEmitter: (evt, payload) => io.emit(evt, payload),
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 5. Analytics & Dashboard Stats
// ==========================================
app.get("/api/analytics", async (req, res) => {
  try {
    const analytics = await crmDB.getAnalytics();
    res.json({ success: true, analytics });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 6. MicroMind AI Custom Tools Endpoints (Cloudflare Webhook)
// ==========================================
app.post("/api/tools/order", async (req, res) => {
  try {
    console.log("⚡ [MicroMind Tool] Received record_order request:", req.body);
    const { customerName, phone, orderDetails, address, totalPrice, contactJid } = req.body;
    const result = await AutomationTools.recordOrderLead({
      contactJid: contactJid || (phone ? `${phone.replace(/\D/g, "")}@s.whatsapp.net` : ""),
      customerName,
      phone,
      orderDetails,
      address,
      totalPrice,
    });
    io.emit("new_order", result);
    res.json(result);
  } catch (err) {
    console.error("⚠️ [MicroMind Tool Error]:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/tools/voice", async (req, res) => {
  try {
    console.log("⚡ [MicroMind Tool] Received send_voice request:", req.body);
    const { to, text, lang } = req.body;
    const result = await AutomationTools.sendVoiceNote(whatsapp, to, text, lang || "ar");
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
      io.emit("contact_updated", { jid: contactJid, bot_paused: 1 });
      console.log(`🙋 [Human Takeover] Activated for ${contactJid}`);
      return res.json({ success: true, message: "Human takeover activated" });
    }
    res.status(400).json({ error: "contactJid is required" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/api/settings", (req, res) => {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf-8"));
    // Mask password
    const safeConfig = { ...config };
    if (safeConfig.emailPass) safeConfig.emailPass = "••••••••";
    res.json({ success: true, settings: safeConfig });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/settings", (req, res) => {
  try {
    const configPath = path.join(__dirname, "..", "config.json");
    const current = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const updates = req.body;

    if (updates.emailPass === "••••••••") {
      delete updates.emailPass;
    }

    const updated = { ...current, ...updates };
    fs.writeFileSync(configPath, JSON.stringify(updated, null, 2), "utf-8");
    res.json({ success: true, settings: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// ==========================================
// 5. ReserveFlow Appointments & Booking Engine
// ==========================================
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
    const booking = await BookingEngine.createBooking(req.body);
    io.emit("new_booking", booking);

    const dateFormatted = new Date(booking.startTime).toLocaleDateString("ar-EG", {
      timeZone: "Africa/Cairo",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric"
    });
    const timeFormatted = new Date(booking.startTime).toLocaleTimeString("ar-EG", {
      timeZone: "Africa/Cairo",
      hour: "2-digit",
      minute: "2-digit"
    });

    // 1. Send confirmation WhatsApp message
    try {
      if (whatsapp.isConnected && booking.customerPhone) {
        const msg = `🎉 تم تأكيد حجز موعدك بنجاح يا ${booking.customerName}!\n\n📋 *تفاصيل التذكرة والموعد:*\n- كود الحجز: *${booking.referenceCode}*\n- التاريخ: ${dateFormatted}\n- الوقت: ${timeFormatted} (بتوقيت القاهرة)\n- رمز الإلغاء: ${booking.cancelToken}\n\nشكراً لتواصلك معنا! ✨`;
        await whatsapp.sendMessage(booking.customerPhone, msg);
        console.log(`📱 [WhatsApp] Booking confirmation sent to ${booking.customerPhone}`);
      } else {
        console.log(`ℹ️ [WhatsApp] Client is not connected. WhatsApp booking message skipped.`);
      }
    } catch (msgErr) {
      console.warn("⚠️ WhatsApp booking notification error:", msgErr.message);
    }

    // 2. Send confirmation Email via EmailNotifier
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
    io.emit("booking_cancelled", booking);
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

// MicroMind / Automation Tool Endpoint for Booking
app.post("/api/tools/book-appointment", async (req, res) => {
  try {
    console.log("⚡ [MicroMind Tool] Received book_appointment request:", req.body);
    const { customerName, customerPhone, customerEmail, startTime, notes, contactJid } = req.body;
    const booking = await BookingEngine.createBooking({
      customerName,
      customerPhone: customerPhone || (contactJid ? contactJid.split("@")[0] : ""),
      customerEmail,
      startTime,
      notes,
      contactJid
    });
    io.emit("new_booking", booking);

    // Send WhatsApp & Email
    if (whatsapp.isConnected && booking.customerPhone) {
      const dateFormatted = new Date(booking.startTime).toLocaleDateString("ar-EG", { timeZone: "Africa/Cairo", weekday: "long", year: "numeric", month: "long", day: "numeric" });
      const timeFormatted = new Date(booking.startTime).toLocaleTimeString("ar-EG", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit" });
      const msg = `🎉 تم تأكيد حجز موعدك بنجاح يا ${booking.customerName}!\n\n📋 *تفاصيل التذكرة والموعد:*\n- كود الحجز: *${booking.referenceCode}*\n- التاريخ: ${dateFormatted}\n- الوقت: ${timeFormatted} (بتوقيت القاهرة)\n- رمز الإلغاء: ${booking.cancelToken}\n\nشكراً لتواصلك معنا! ✨`;
      await whatsapp.sendMessage(booking.customerPhone, msg);
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

module.exports = { server, app };
