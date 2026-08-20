const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const { Pool } = require("pg");
const lidMapper = require("./lidMapper");

const DATA_DIR = path.join(__dirname, "..", "data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const CONFIG_PATH = path.join(__dirname, "..", "config.json");

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    }
  } catch (e) {
    console.error("[DB] Error loading config:", e);
  }
  return {};
}

class CRMDatabase {
  constructor() {
    this.config = loadConfig();
    this.pgPool = null;
    this.sqliteDb = null;
    this.isPostgres = false;
    this.init();
  }

  init() {
    const pgUrl = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || this.config.postgresUrl;
    if (pgUrl && (pgUrl.startsWith("postgres://") || pgUrl.startsWith("postgresql://"))) {
      try {
        this.pgPool = new Pool({
          connectionString: pgUrl,
          ssl: { rejectUnauthorized: false }, // Required for Neon.tech
          max: 10,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 10000,
        });

        // Prevent idle client termination crashes from Neon serverless sleep
        this.pgPool.on("error", (err) => {
          console.warn("⚠️ [Postgres Pool Notice]:", err.message);
        });

        this.isPostgres = true;
        console.log("🐘 [Database] Connected to Neon PostgreSQL successfully!");
        this.initPostgresTables();
        return;
      } catch (err) {
        console.error("⚠️ [Database] Failed connecting to Postgres, falling back to SQLite:", err.message);
      }
    }

    // Default: SQLite
    const DB_PATH = path.join(DATA_DIR, "crm.db");
    this.sqliteDb = new Database(DB_PATH);
    this.sqliteDb.pragma("journal_mode = WAL");
    this.isPostgres = false;
    console.log("💾 [Database] Using SQLite database (data/crm.db)");
    this.initSqliteTables();
  }

  initSqliteTables() {
    this.sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS contacts (
        jid TEXT PRIMARY KEY,
        name TEXT,
        phone TEXT,
        status_tag TEXT DEFAULT 'new',
        lead_score INTEGER DEFAULT 0,
        total_spent REAL DEFAULT 0.0,
        total_orders_count INTEGER DEFAULT 0,
        bot_paused INTEGER DEFAULT 0,
        assigned_agent TEXT,
        city TEXT,
        governorate TEXT,
        address TEXT,
        custom_notes TEXT DEFAULT '',
        custom_fields TEXT DEFAULT '{}',
        last_message TEXT DEFAULT '',
        last_message_time INTEGER DEFAULT 0,
        unread_count INTEGER DEFAULT 0,
        created_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        contact_jid TEXT NOT NULL,
        sender_name TEXT,
        text TEXT,
        media_type TEXT,
        media_url TEXT,
        from_me INTEGER DEFAULT 0,
        auto_replied INTEGER DEFAULT 0,
        timestamp INTEGER
      );

      CREATE TABLE IF NOT EXISTS orders_leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contact_jid TEXT,
        customer_name TEXT,
        phone TEXT,
        order_details TEXT,
        address TEXT,
        total_price TEXT,
        status TEXT DEFAULT 'pending',
        google_sheet_synced INTEGER DEFAULT 0,
        created_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY,
        title TEXT,
        message_template TEXT,
        target_count INTEGER DEFAULT 0,
        sent_count INTEGER DEFAULT 0,
        failed_count INTEGER DEFAULT 0,
        delay_seconds INTEGER DEFAULT 8,
        status TEXT DEFAULT 'completed',
        created_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS campaign_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id TEXT,
        phone TEXT,
        status TEXT,
        error_message TEXT,
        sent_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS products_catalog (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sku TEXT UNIQUE,
        title TEXT NOT NULL,
        description TEXT,
        price REAL DEFAULT 0.0,
        discount_price REAL,
        stock_quantity INTEGER DEFAULT 100,
        category TEXT,
        image_url TEXT,
        is_available INTEGER DEFAULT 1,
        created_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS ai_memory_context (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contact_jid TEXT NOT NULL,
        memory_type TEXT DEFAULT 'preference',
        memory_key TEXT NOT NULL,
        memory_value TEXT NOT NULL,
        confidence_score REAL DEFAULT 1.0,
        updated_at INTEGER,
        UNIQUE(contact_jid, memory_key)
      );

      CREATE TABLE IF NOT EXISTS bookings_appointments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reference_code TEXT UNIQUE,
        start_time TEXT,
        end_time TEXT,
        slot_end_time TEXT,
        customer_name TEXT,
        customer_email TEXT,
        customer_phone TEXT,
        notes TEXT DEFAULT '',
        status TEXT DEFAULT 'CONFIRMED',
        cancel_token TEXT,
        contact_jid TEXT,
        created_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS bot_rules_faqs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT DEFAULT 'general',
        trigger_keywords TEXT DEFAULT '[]',
        match_type TEXT DEFAULT 'contains',
        response_text TEXT NOT NULL,
        response_media_url TEXT,
        action_type TEXT DEFAULT 'reply',
        is_active INTEGER DEFAULT 1,
        hits_count INTEGER DEFAULT 0,
        created_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS audit_activity_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        contact_jid TEXT,
        details TEXT DEFAULT '{}',
        ip_address TEXT,
        created_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_jid, timestamp);
      CREATE INDEX IF NOT EXISTS idx_contacts_time ON contacts(last_message_time DESC);
      CREATE INDEX IF NOT EXISTS idx_ai_memory_jid ON ai_memory_context(contact_jid);
    `);

    // Safe migration if table existed previously without media_url
    try {
      this.sqliteDb.exec("ALTER TABLE contacts ADD COLUMN avatar_url TEXT;");
      this.sqliteDb.exec("ALTER TABLE contacts ADD COLUMN status_bio TEXT;");
    } catch (e) {}

    try {
      this.sqliteDb.exec("ALTER TABLE contacts ADD COLUMN lead_score INTEGER DEFAULT 0;");
      this.sqliteDb.exec("ALTER TABLE contacts ADD COLUMN total_spent REAL DEFAULT 0.0;");
      this.sqliteDb.exec("ALTER TABLE contacts ADD COLUMN total_orders_count INTEGER DEFAULT 0;");
      this.sqliteDb.exec("ALTER TABLE contacts ADD COLUMN city TEXT;");
      this.sqliteDb.exec("ALTER TABLE contacts ADD COLUMN governorate TEXT;");
      this.sqliteDb.exec("ALTER TABLE contacts ADD COLUMN address TEXT;");
      this.sqliteDb.exec("ALTER TABLE contacts ADD COLUMN custom_fields TEXT DEFAULT '{}';");
      this.sqliteDb.exec("ALTER TABLE contacts ADD COLUMN avatar_url TEXT;");
      this.sqliteDb.exec("ALTER TABLE contacts ADD COLUMN status_bio TEXT;");
      this.sqliteDb.exec("ALTER TABLE contacts ADD COLUMN is_group INTEGER DEFAULT 0;");
      this.sqliteDb.exec("ALTER TABLE messages ADD COLUMN participant_jid TEXT;");
    } catch (e) {}
  }

  async initPostgresTables() {
    if (!this.pgPool) return;
    try {
      await this.pgPool.query(`
        CREATE TABLE IF NOT EXISTS contacts (
          jid TEXT PRIMARY KEY,
          name TEXT,
          phone TEXT,
          avatar_url TEXT,
          status_bio TEXT,
          is_group INT DEFAULT 0,
          status_tag VARCHAR(50) DEFAULT 'new',
          lead_score INT DEFAULT 0,
          total_spent NUMERIC(12, 2) DEFAULT 0.00,
          total_orders_count INT DEFAULT 0,
          bot_paused INT DEFAULT 0,
          assigned_agent TEXT,
          city TEXT,
          governorate TEXT,
          address TEXT,
          custom_notes TEXT DEFAULT '',
          custom_fields JSONB DEFAULT '{}'::jsonb,
          last_message TEXT DEFAULT '',
          last_message_time BIGINT DEFAULT 0,
          unread_count INT DEFAULT 0,
          created_at BIGINT
        );

        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          contact_jid TEXT NOT NULL,
          participant_jid TEXT,
          sender_name TEXT,
          text TEXT,
          media_type VARCHAR(50) DEFAULT 'text',
          media_url TEXT,
          media_meta JSONB DEFAULT '{}'::jsonb,
          from_me INT DEFAULT 0,
          auto_replied INT DEFAULT 0,
          ai_model TEXT,
          ai_tokens_used INT DEFAULT 0,
          sentiment VARCHAR(20) DEFAULT 'neutral',
          intent VARCHAR(50),
          timestamp BIGINT
        );

        CREATE TABLE IF NOT EXISTS orders_leads (
          id SERIAL PRIMARY KEY,
          order_number TEXT,
          contact_jid TEXT,
          customer_name TEXT,
          phone TEXT,
          order_details TEXT,
          items JSONB DEFAULT '[]'::jsonb,
          total_price TEXT DEFAULT '0',
          currency VARCHAR(10) DEFAULT 'EGP',
          payment_method VARCHAR(50) DEFAULT 'cash_on_delivery',
          payment_status VARCHAR(50) DEFAULT 'unpaid',
          address TEXT,
          city TEXT,
          governorate TEXT,
          status VARCHAR(50) DEFAULT 'pending',
          source VARCHAR(50) DEFAULT 'whatsapp_ai',
          google_sheet_synced INT DEFAULT 0,
          admin_notes TEXT DEFAULT '',
          created_at BIGINT
        );

        CREATE TABLE IF NOT EXISTS products_catalog (
          id SERIAL PRIMARY KEY,
          sku VARCHAR(100) UNIQUE,
          title TEXT NOT NULL,
          description TEXT,
          price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
          discount_price NUMERIC(10, 2),
          stock_quantity INT DEFAULT 100,
          category VARCHAR(100),
          image_url TEXT,
          is_available BOOLEAN DEFAULT true,
          created_at BIGINT DEFAULT (EXTRACT(epoch FROM NOW()) * 1000)
        );

        CREATE TABLE IF NOT EXISTS ai_memory_context (
          id SERIAL PRIMARY KEY,
          contact_jid TEXT NOT NULL,
          memory_type VARCHAR(50) DEFAULT 'preference',
          memory_key TEXT NOT NULL,
          memory_value TEXT NOT NULL,
          confidence_score FLOAT DEFAULT 1.0,
          updated_at BIGINT DEFAULT (EXTRACT(epoch FROM NOW()) * 1000),
          UNIQUE(contact_jid, memory_key)
        );

        CREATE TABLE IF NOT EXISTS bookings_appointments (
          id SERIAL PRIMARY KEY,
          reference_code VARCHAR(50) UNIQUE,
          start_time TEXT,
          end_time TEXT,
          slot_end_time TEXT,
          customer_name TEXT,
          customer_email TEXT,
          customer_phone TEXT,
          notes TEXT DEFAULT '',
          status VARCHAR(50) DEFAULT 'CONFIRMED',
          cancel_token TEXT,
          contact_jid TEXT,
          created_at BIGINT
        );

        CREATE TABLE IF NOT EXISTS campaigns (
          id TEXT PRIMARY KEY,
          title TEXT,
          message_template TEXT,
          media_url TEXT,
          audience_filter VARCHAR(50) DEFAULT 'all',
          target_count INT DEFAULT 0,
          sent_count INT DEFAULT 0,
          failed_count INT DEFAULT 0,
          delay_seconds INT DEFAULT 8,
          status VARCHAR(50) DEFAULT 'completed',
          created_at BIGINT
        );

        CREATE TABLE IF NOT EXISTS campaign_logs (
          id SERIAL PRIMARY KEY,
          campaign_id TEXT,
          phone TEXT,
          status VARCHAR(50),
          error_message TEXT,
          sent_at BIGINT
        );

        CREATE TABLE IF NOT EXISTS bot_rules_faqs (
          id SERIAL PRIMARY KEY,
          category VARCHAR(100) DEFAULT 'general',
          trigger_keywords JSONB DEFAULT '[]'::jsonb,
          match_type VARCHAR(50) DEFAULT 'contains',
          response_text TEXT NOT NULL,
          response_media_url TEXT,
          action_type VARCHAR(50) DEFAULT 'reply',
          is_active BOOLEAN DEFAULT true,
          hits_count INT DEFAULT 0,
          created_at BIGINT DEFAULT (EXTRACT(epoch FROM NOW()) * 1000)
        );

        CREATE TABLE IF NOT EXISTS audit_activity_logs (
          id SERIAL PRIMARY KEY,
          actor VARCHAR(50) NOT NULL,
          action TEXT NOT NULL,
          contact_jid TEXT,
          details JSONB DEFAULT '{}'::jsonb,
          ip_address VARCHAR(50),
          created_at BIGINT DEFAULT (EXTRACT(epoch FROM NOW()) * 1000)
        );

        CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_jid, timestamp);
        CREATE INDEX IF NOT EXISTS idx_contacts_time ON contacts(last_message_time DESC);
        CREATE INDEX IF NOT EXISTS idx_ai_memory_jid ON ai_memory_context(contact_jid);
        CREATE INDEX IF NOT EXISTS idx_orders_status ON orders_leads(status);
      `);
      console.log("🐘 [Database] PostgreSQL enterprise tables initialized successfully.");
      await this.migrateLidContacts();
      await this.mergeDuplicateContacts();
    } catch (e) {
      console.error("[Database] Error creating Postgres tables:", e.message);
    }
  }

  async mergeDuplicateContacts() {
    try {
      if (this.isPostgres && this.pgPool) {
        const res = await this.pgPool.query("SELECT * FROM contacts WHERE is_group = 0 OR is_group IS NULL");
        const contacts = res.rows;
        const phoneMap = new Map();
        for (const c of contacts) {
          if (c.jid && c.jid.endsWith("@g.us")) continue;
          let cleanPhone = c.phone || lidMapper.resolveLidToPhone(c.jid) || (c.jid.endsWith("@s.whatsapp.net") ? c.jid.split("@")[0].replace(/\D/g, "") : "");
          if (!cleanPhone || cleanPhone.length < 8) continue;
          if (cleanPhone.startsWith("01") && cleanPhone.length === 11) cleanPhone = "2" + cleanPhone;

          if (!phoneMap.has(cleanPhone)) phoneMap.set(cleanPhone, []);
          phoneMap.get(cleanPhone).push(c);
        }

        for (const [phone, list] of phoneMap.entries()) {
          if (list.length > 1) {
            list.sort((a, b) => Number(b.last_message_time || 0) - Number(a.last_message_time || 0));
            const primary = list[0];
            const secondaries = list.slice(1);
            let bestName = primary.name;
            for (const c of list) {
              if (c.name && c.name !== c.phone && c.name !== c.jid && !c.name.startsWith("+")) {
                bestName = c.name;
                break;
              }
            }
            const secJids = secondaries.map(s => s.jid);
            await this.pgPool.query("UPDATE messages SET contact_jid = $1 WHERE contact_jid = ANY($2)", [primary.jid, secJids]);
            await this.pgPool.query("UPDATE contacts SET name = $1, phone = $2 WHERE jid = $3", [bestName, phone, primary.jid]);
            await this.pgPool.query("DELETE FROM contacts WHERE jid = ANY($1)", [secJids]);
          }
        }
      }
    } catch (e) {
      console.warn("[Database] mergeDuplicateContacts notice:", e.message);
    }
  }

  async migrateLidContacts() {
    try {
      if (this.isPostgres && this.pgPool) {
        const res = await this.pgPool.query("SELECT jid, phone FROM contacts WHERE jid LIKE '%@lid%' OR (phone IS NOT NULL AND LENGTH(phone) >= 14)");
        for (const row of res.rows) {
          const realPhone = lidMapper.resolveLidToPhone(row.jid);
          if (realPhone && realPhone !== row.phone) {
            await this.pgPool.query("UPDATE contacts SET phone = $1 WHERE jid = $2", [realPhone, row.jid]);
          }
        }
      } else if (this.sqliteDb) {
        const rows = this.sqliteDb.prepare("SELECT jid, phone FROM contacts WHERE jid LIKE '%@lid%' OR (phone IS NOT NULL AND LENGTH(phone) >= 14)").all();
        const updateStmt = this.sqliteDb.prepare("UPDATE contacts SET phone = ? WHERE jid = ?");
        for (const row of rows) {
          const realPhone = lidMapper.resolveLidToPhone(row.jid);
          if (realPhone && realPhone !== row.phone) {
            updateStmt.run(realPhone, row.jid);
          }
        }
      }
    } catch (e) {
      console.warn("[Database] migrateLidContacts notice:", e.message);
    }
  }

  // --- Contacts ---
  async upsertContact(jid, name, phone, lastMsg = "", timestamp = Date.now(), isIncoming = false, isGroup = null) {
    const isGrp = isGroup !== null ? (isGroup ? 1 : 0) : (jid.endsWith("@g.us") ? 1 : 0);
    let cleanPhone = "";
    if (!isGrp) {
      cleanPhone = lidMapper.resolveLidToPhone(phone || jid) || (phone ? phone.replace(/\D/g, "") : "");
    }
    const cleanName = (name && name !== jid && name !== phone && name !== cleanPhone) ? name : null;

    if (this.isPostgres) {
      try {
        await this.pgPool.query(
          `INSERT INTO contacts (jid, name, phone, is_group, status_tag, bot_paused, custom_notes, last_message, last_message_time, unread_count, created_at)
           VALUES ($1, $2, $3, $4, 'new', 0, '', $5, $6, $7, $8)
           ON CONFLICT (jid) DO UPDATE SET
             name = CASE 
               WHEN contacts.name IS NOT NULL AND contacts.name != '' AND contacts.name != contacts.phone AND contacts.name != contacts.jid 
               THEN contacts.name 
               WHEN EXCLUDED.name IS NOT NULL AND EXCLUDED.name != '' 
               THEN EXCLUDED.name 
               ELSE contacts.name 
             END,
             phone = CASE 
               WHEN contacts.phone IS NOT NULL AND contacts.phone != '' AND contacts.phone != contacts.jid AND LENGTH(contacts.phone) < 14
               THEN contacts.phone 
               WHEN EXCLUDED.phone IS NOT NULL AND EXCLUDED.phone != '' 
               THEN EXCLUDED.phone 
               ELSE contacts.phone 
             END,
             is_group = EXCLUDED.is_group,
             last_message = CASE WHEN EXCLUDED.last_message != '' THEN EXCLUDED.last_message ELSE contacts.last_message END,
             last_message_time = EXCLUDED.last_message_time,
             unread_count = contacts.unread_count + (CASE WHEN $7 = 1 THEN 1 ELSE 0 END)`,
          [jid, cleanName, cleanPhone, isGrp, lastMsg || "", timestamp || Date.now(), isIncoming ? 1 : 0, Date.now()]
        );
      } catch (err) {
        console.error("[DB] upsertContact Postgres error:", err.message);
      }
      return;
    }

    // SQLite
    const existing = this.sqliteDb.prepare("SELECT * FROM contacts WHERE jid = ?").get(jid);
    if (!existing) {
      this.sqliteDb.prepare(`
        INSERT INTO contacts (jid, name, phone, is_group, status_tag, bot_paused, custom_notes, last_message, last_message_time, unread_count, created_at)
        VALUES (?, ?, ?, ?, 'new', 0, '', ?, ?, ?, ?)
      `).run(jid, cleanName, cleanPhone, isGrp, lastMsg, timestamp, isIncoming ? 1 : 0, Date.now());
    } else {
      const hasCustomName = existing.name && existing.name !== existing.phone && existing.name !== existing.jid;
      const updatedName = hasCustomName ? existing.name : ((name && name !== cleanPhone) ? name : existing.name);
      const hasCustomPhone = existing.phone && existing.phone !== existing.jid && existing.phone.length < 14;
      const updatedPhone = hasCustomPhone ? existing.phone : (cleanPhone || existing.phone);
      const unread = isIncoming ? existing.unread_count + 1 : existing.unread_count;
      this.sqliteDb.prepare(`
        UPDATE contacts 
        SET name = ?, phone = ?, is_group = ?, last_message = ?, last_message_time = ?, unread_count = ?
        WHERE jid = ?
      `).run(updatedName, updatedPhone, isGrp, lastMsg || existing.last_message, timestamp, unread, jid);
    }
  }

  async updateContactProfile(jid, data) {
    const { name, phone, city, governorate, address, status_tag, custom_notes, avatar_url, status_bio } = data;
    if (this.isPostgres) {
      return this.pgPool.query(
        `UPDATE contacts SET
          name = COALESCE($1, name),
          phone = COALESCE($2, phone),
          city = COALESCE($3, city),
          governorate = COALESCE($4, governorate),
          address = COALESCE($5, address),
          status_tag = COALESCE($6, status_tag),
          custom_notes = COALESCE($7, custom_notes),
          avatar_url = COALESCE($8, avatar_url),
          status_bio = COALESCE($9, status_bio)
         WHERE jid = $10`,
        [name || null, phone || null, city || null, governorate || null, address || null, status_tag || null, custom_notes || null, avatar_url || null, status_bio || null, jid]
      );
    }
    // SQLite
    return this.sqliteDb.prepare(`
      UPDATE contacts SET
        name = COALESCE(?, name),
        phone = COALESCE(?, phone),
        city = COALESCE(?, city),
        governorate = COALESCE(?, governorate),
        address = COALESCE(?, address),
        status_tag = COALESCE(?, status_tag),
        custom_notes = COALESCE(?, custom_notes),
        avatar_url = COALESCE(?, avatar_url),
        status_bio = COALESCE(?, status_bio)
      WHERE jid = ?
    `).run(name || null, phone || null, city || null, governorate || null, address || null, status_tag || null, custom_notes || null, avatar_url || null, status_bio || null, jid);
  }

  async updateContactAvatar(jid, avatarUrl) {
    if (this.isPostgres) {
      return this.pgPool.query("UPDATE contacts SET avatar_url = $1 WHERE jid = $2", [avatarUrl, jid]);
    }
    return this.sqliteDb.prepare("UPDATE contacts SET avatar_url = ? WHERE jid = ?").run(avatarUrl, jid);
  }

  async updateContactBio(jid, bio) {
    if (this.isPostgres) {
      return this.pgPool.query("UPDATE contacts SET status_bio = $1 WHERE jid = $2", [bio, jid]);
    }
    return this.sqliteDb.prepare("UPDATE contacts SET status_bio = ? WHERE jid = ?").run(bio, jid);
  }

  async getContacts(search = "", tag = "") {
    if (this.isPostgres) {
      let query = "SELECT * FROM contacts WHERE 1=1";
      const params = [];
      let idx = 1;

      if (search) {
        query += ` AND (name ILIKE $${idx} OR phone ILIKE $${idx} OR last_message ILIKE $${idx})`;
        params.push(`%${search}%`);
        idx++;
      }
      if (tag && tag !== "all") {
        if (tag === "dms") {
          query += ` AND (is_group = 0 OR is_group IS NULL) AND jid NOT LIKE '%@g.us'`;
        } else if (tag === "groups") {
          query += ` AND (is_group = 1 OR jid LIKE '%@g.us')`;
        } else {
          query += ` AND status_tag = $${idx}`;
          params.push(tag);
          idx++;
        }
      }
      query += " ORDER BY last_message_time DESC";
      const res = await this.pgPool.query(query, params);
      return res.rows;
    }

    // SQLite
    let query = "SELECT * FROM contacts WHERE 1=1";
    const params = [];

    if (search) {
      query += " AND (name LIKE ? OR phone LIKE ? OR last_message LIKE ?)";
      const term = `%${search}%`;
      params.push(term, term, term);
    }
    if (tag && tag !== "all") {
      if (tag === "dms") {
        query += " AND (is_group = 0 OR is_group IS NULL) AND jid NOT LIKE '%@g.us'";
      } else if (tag === "groups") {
        query += " AND (is_group = 1 OR jid LIKE '%@g.us')";
      } else {
        query += " AND status_tag = ?";
        params.push(tag);
      }
    }

    query += " ORDER BY last_message_time DESC";
    return this.sqliteDb.prepare(query).all(...params);
  }

  async getContact(jid) {
    if (this.isPostgres) {
      const res = await this.pgPool.query("SELECT * FROM contacts WHERE jid = $1", [jid]);
      return res.rows[0] || null;
    }
    return this.sqliteDb.prepare("SELECT * FROM contacts WHERE jid = ?").get(jid) || null;
  }

  async updateContactTag(jid, tag) {
    if (this.isPostgres) {
      return this.pgPool.query("UPDATE contacts SET status_tag = $1 WHERE jid = $2", [tag, jid]);
    }
    return this.sqliteDb.prepare("UPDATE contacts SET status_tag = ? WHERE jid = ?").run(tag, jid);
  }

  async toggleBotPaused(jid, paused) {
    const val = paused ? 1 : 0;
    if (this.isPostgres) {
      return this.pgPool.query("UPDATE contacts SET bot_paused = $1 WHERE jid = $2", [val, jid]);
    }
    return this.sqliteDb.prepare("UPDATE contacts SET bot_paused = ? WHERE jid = ?").run(val, jid);
  }

  async updateContactNotes(jid, notes) {
    if (this.isPostgres) {
      return this.pgPool.query("UPDATE contacts SET custom_notes = $1 WHERE jid = $2", [notes, jid]);
    }
    return this.sqliteDb.prepare("UPDATE contacts SET custom_notes = ? WHERE jid = ?").run(notes, jid);
  }

  async markContactRead(jid) {
    if (this.isPostgres) {
      return this.pgPool.query("UPDATE contacts SET unread_count = 0 WHERE jid = $1", [jid]);
    }
    return this.sqliteDb.prepare("UPDATE contacts SET unread_count = 0 WHERE jid = ?").run(jid);
  }

  // --- Messages ---
  async saveMessage(msgData) {
    const { id, sender, participantJid, senderName, text, mediaType, mediaUrl, fromMe, autoReplied, timestamp } = msgData;
    const isGroup = sender && sender.endsWith("@g.us");
    
    // Ensure contact exists & update its last message
    await this.upsertContact(
      sender,
      isGroup ? null : (fromMe ? null : senderName),
      null,
      isGroup && !fromMe && senderName ? `${senderName}: ${text || `[${mediaType || "Media"}]`}` : (text || `[${mediaType || "Media"}]`),
      timestamp || Date.now(),
      !fromMe,
      isGroup ? 1 : 0
    );

    if (this.isPostgres) {
      return this.pgPool.query(`
        INSERT INTO messages (id, contact_jid, participant_jid, sender_name, text, media_type, media_url, from_me, auto_replied, timestamp)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO UPDATE SET text = EXCLUDED.text, media_url = EXCLUDED.media_url, auto_replied = EXCLUDED.auto_replied
      `, [
        id || Date.now().toString(),
        sender,
        participantJid || (fromMe ? "me" : sender),
        senderName || "",
        text || "",
        mediaType || "",
        mediaUrl || "",
        fromMe ? 1 : 0,
        autoReplied ? 1 : 0,
        timestamp || Date.now()
      ]);
    }

    const stmt = this.sqliteDb.prepare(`
      INSERT OR REPLACE INTO messages (id, contact_jid, participant_jid, sender_name, text, media_type, media_url, from_me, auto_replied, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    return stmt.run(
      id || Date.now().toString(),
      sender,
      participantJid || (fromMe ? "me" : sender),
      senderName || "",
      text || "",
      mediaType || "",
      mediaUrl || "",
      fromMe ? 1 : 0,
      autoReplied ? 1 : 0,
      timestamp || Date.now()
    );
  }

  async getMessages(contactJid, limit = 100) {
    if (!contactJid) return [];
    
    // Resolve any alternate JIDs for this contact (LID vs Phone JID)
    const aliasJids = [contactJid];
    const isGroup = contactJid.endsWith("@g.us");
    if (!isGroup) {
      const cleanPhone = lidMapper.resolveLidToPhone(contactJid) || (contactJid.endsWith("@s.whatsapp.net") ? contactJid.split("@")[0].replace(/\D/g, "") : "");
      if (cleanPhone) {
        aliasJids.push(`${cleanPhone}@s.whatsapp.net`);
        if (cleanPhone.startsWith("20")) {
          aliasJids.push(`0${cleanPhone.substring(2)}@s.whatsapp.net`);
        } else if (cleanPhone.startsWith("01")) {
          aliasJids.push(`2${cleanPhone}@s.whatsapp.net`);
        }
        const lid = lidMapper.resolvePhoneToLid(cleanPhone);
        if (lid) {
          aliasJids.push(`${lid}@lid`);
        }
      }
    }

    const uniqueJids = Array.from(new Set(aliasJids));

    if (this.isPostgres) {
      const res = await this.pgPool.query(`
        SELECT * FROM (
          SELECT * FROM messages 
          WHERE contact_jid = ANY($1) 
          ORDER BY timestamp DESC 
          LIMIT $2
        ) sub ORDER BY timestamp ASC
      `, [uniqueJids, limit]);
      return res.rows;
    }

    const placeholders = uniqueJids.map(() => "?").join(",");
    return this.sqliteDb.prepare(`
      SELECT * FROM (
        SELECT * FROM messages 
        WHERE contact_jid IN (${placeholders}) 
        ORDER BY timestamp DESC 
        LIMIT ?
      ) ORDER BY timestamp ASC
    `).all(...uniqueJids, limit);
  }

  // Get all messages sent by a contact across all shared WhatsApp groups
  async getSharedGroupsMessages(contactJid, limit = 50) {
    if (!contactJid) return [];
    const cleanPhone = (contactJid.endsWith("@s.whatsapp.net") ? contactJid.split("@")[0].replace(/\D/g, "") : "");
    const phonePattern = cleanPhone ? `%${cleanPhone}%` : "%";

    if (this.isPostgres) {
      const res = await this.pgPool.query(`
        SELECT 
          m.id,
          m.contact_jid AS group_jid,
          COALESCE(c.name, 'مجموعة واتساب') AS group_name,
          c.avatar_url AS group_avatar,
          m.sender_name,
          m.participant_jid,
          m.text,
          m.media_type,
          m.media_url,
          m.timestamp
        FROM messages m
        LEFT JOIN contacts c ON c.jid = m.contact_jid
        WHERE m.contact_jid LIKE '%@g.us'
          AND (m.participant_jid = $1 OR m.participant_jid LIKE $2)
        ORDER BY m.timestamp DESC
        LIMIT $3
      `, [contactJid, phonePattern, limit]);
      return res.rows;
    }

    // SQLite
    return this.sqliteDb.prepare(`
      SELECT 
        m.id,
        m.contact_jid AS group_jid,
        COALESCE(c.name, 'مجموعة واتساب') AS group_name,
        c.avatar_url AS group_avatar,
        m.sender_name,
        m.participant_jid,
        m.text,
        m.media_type,
        m.media_url,
        m.timestamp
      FROM messages m
      LEFT JOIN contacts c ON c.jid = m.contact_jid
      WHERE m.contact_jid LIKE '%@g.us'
        AND (m.participant_jid = ? OR m.participant_jid LIKE ?)
      ORDER BY m.timestamp DESC
      LIMIT ?
    `).all(contactJid, phonePattern, limit);
  }

  // --- Leads & Orders ---
  async saveOrderLead(data) {
    const { contactJid, customerName, phone, orderDetails, address, totalPrice, googleSheetSynced } = data;
    const cleanPhone = (phone || "").replace(/\D/g, "") || (contactJid ? contactJid.split("@")[0].replace(/\D/g, "") : "");
    const cleanName = customerName || cleanPhone || "عميل";
    const jid = (contactJid && contactJid.trim()) ? contactJid.trim() : (cleanPhone ? `${cleanPhone}@s.whatsapp.net` : null);
    
    // Automatically ensure contact exists in contacts table
    if (jid) {
      try {
        await this.upsertContact(jid, cleanName, cleanPhone, `طلب جديد: ${orderDetails || ''}`);
      } catch (e) {}
    }

    const orderNum = `ORD-${Math.floor(100000 + Math.random() * 900000)}`;
    const parsedPrice = isNaN(parseFloat(totalPrice)) ? 0.00 : parseFloat(totalPrice);
    const nowTime = Date.now();

    if (this.isPostgres) {
      try {
        const res = await this.pgPool.query(`
          INSERT INTO orders_leads (order_number, contact_jid, customer_name, phone, order_details, address, total_price, status, google_sheet_synced, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9)
          RETURNING id, order_number
        `, [
          orderNum,
          jid,
          cleanName,
          cleanPhone,
          orderDetails || "طلب عام",
          address || "غير محدد",
          parsedPrice,
          googleSheetSynced ? 1 : 0,
          nowTime
        ]);
        if (jid) await this.updateContactTag(jid, "ordered");
        return res.rows[0]?.id || 1;
      } catch (err) {
        console.error("[Database] Postgres saveOrderLead error:", err.message);
        return 1;
      }
    }

    try {
      const stmt = this.sqliteDb.prepare(`
        INSERT INTO orders_leads (contact_jid, customer_name, phone, order_details, address, total_price, status, google_sheet_synced, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      `);

      const res = stmt.run(
        jid || "",
        cleanName,
        cleanPhone,
        orderDetails || "طلب عام",
        address || "غير محدد",
        String(parsedPrice),
        googleSheetSynced ? 1 : 0,
        nowTime
      );

      if (jid) await this.updateContactTag(jid, "ordered");
      return res.lastInsertRowid;
    } catch (err) {
      console.error("[Database] SQLite saveOrderLead error:", err.message);
      return 1;
    }
  }

  async getOrdersLeads() {
    if (this.isPostgres) {
      try {
        const res = await this.pgPool.query("SELECT * FROM orders_leads ORDER BY created_at DESC");
        return res.rows;
      } catch (e) {
        console.error("[Database] Postgres getOrdersLeads error:", e.message);
        return [];
      }
    }
    try {
      return this.sqliteDb.prepare("SELECT * FROM orders_leads ORDER BY created_at DESC").all();
    } catch (e) {
      console.error("[Database] SQLite getOrdersLeads error:", e.message);
      return [];
    }
  }

  async updateOrderStatus(id, status, googleSheetSynced = null) {
    if (this.isPostgres) {
      try {
        if (googleSheetSynced !== null) {
          return await this.pgPool.query("UPDATE orders_leads SET status = $1, google_sheet_synced = $2 WHERE id = $3", [status, googleSheetSynced ? 1 : 0, id]);
        }
        return await this.pgPool.query("UPDATE orders_leads SET status = $1 WHERE id = $2", [status, id]);
      } catch (e) {
        console.error("[Database] Postgres updateOrderStatus error:", e.message);
      }
      return;
    }

    try {
      if (googleSheetSynced !== null) {
        return this.sqliteDb.prepare("UPDATE orders_leads SET status = ?, google_sheet_synced = ? WHERE id = ?").run(status, googleSheetSynced ? 1 : 0, id);
      }
      return this.sqliteDb.prepare("UPDATE orders_leads SET status = ? WHERE id = ?").run(status, id);
    } catch (e) {
      console.error("[Database] SQLite updateOrderStatus error:", e.message);
    }
  }

  // --- Campaigns ---
  async createCampaign(title, template, targetCount, delaySeconds = 8) {
    const id = "camp_" + Date.now();
    if (this.isPostgres) {
      await this.pgPool.query(`
        INSERT INTO campaigns (id, title, message_template, target_count, sent_count, failed_count, delay_seconds, status, created_at)
        VALUES ($1, $2, $3, $4, 0, 0, $5, 'running', $6)
      `, [id, title, template, targetCount, delaySeconds, Date.now()]);
      return id;
    }

    this.sqliteDb.prepare(`
      INSERT INTO campaigns (id, title, message_template, target_count, sent_count, failed_count, delay_seconds, status, created_at)
      VALUES (?, ?, ?, ?, 0, 0, ?, 'running', ?)
    `).run(id, title, template, targetCount, delaySeconds, Date.now());
    return id;
  }

  async updateCampaignProgress(id, sentCount, failedCount, status) {
    if (this.isPostgres) {
      return this.pgPool.query(`
        UPDATE campaigns SET sent_count = $1, failed_count = $2, status = $3 WHERE id = $4
      `, [sentCount, failedCount, status, id]);
    }

    return this.sqliteDb.prepare(`
      UPDATE campaigns 
      SET sent_count = ?, failed_count = ?, status = ?
      WHERE id = ?
    `).run(sentCount, failedCount, status, id);
  }

  async logCampaignItem(campaignId, phone, status, errorMessage = "") {
    if (this.isPostgres) {
      return this.pgPool.query(`
        INSERT INTO campaign_logs (campaign_id, phone, status, error_message, sent_at)
        VALUES ($1, $2, $3, $4, $5)
      `, [campaignId, phone, status, errorMessage, Date.now()]);
    }

    return this.sqliteDb.prepare(`
      INSERT INTO campaign_logs (campaign_id, phone, status, error_message, sent_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(campaignId, phone, status, errorMessage, Date.now());
  }

  async getCampaigns() {
    if (this.isPostgres) {
      const res = await this.pgPool.query("SELECT * FROM campaigns ORDER BY created_at DESC");
      return res.rows;
    }
    return this.sqliteDb.prepare("SELECT * FROM campaigns ORDER BY created_at DESC").all();
  }

  // --- Analytics ---
  async getAnalytics() {
    if (this.isPostgres) {
      const c = await this.pgPool.query("SELECT COUNT(*) as count FROM contacts");
      const m = await this.pgPool.query("SELECT COUNT(*) as count FROM messages");
      const inc = await this.pgPool.query("SELECT COUNT(*) as count FROM messages WHERE from_me = 0");
      const out = await this.pgPool.query("SELECT COUNT(*) as count FROM messages WHERE from_me = 1");
      const auto = await this.pgPool.query("SELECT COUNT(*) as count FROM messages WHERE auto_replied = 1");
      const ord = await this.pgPool.query("SELECT COUNT(*) as count FROM orders_leads");
      const tags = await this.pgPool.query("SELECT status_tag, COUNT(*) as count FROM contacts GROUP BY status_tag");

      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const vol = await this.pgPool.query(`
        SELECT to_char(to_timestamp(timestamp / 1000), 'YYYY-MM-DD') as day, COUNT(*) as count,
               SUM(CASE WHEN from_me = 0 THEN 1 ELSE 0 END) as incoming,
               SUM(CASE WHEN from_me = 1 THEN 1 ELSE 0 END) as outgoing
        FROM messages
        WHERE timestamp >= $1
        GROUP BY day
        ORDER BY day ASC
      `, [sevenDaysAgo]);

      return {
        totalContacts: Number(c.rows[0].count),
        totalMessages: Number(m.rows[0].count),
        totalIncoming: Number(inc.rows[0].count),
        totalOutgoing: Number(out.rows[0].count),
        totalAutoReplied: Number(auto.rows[0].count),
        totalOrders: Number(ord.rows[0].count),
        tagsBreakdown: tags.rows,
        dailyVolume: vol.rows,
      };
    }

    // SQLite
    const totalContacts = this.sqliteDb.prepare("SELECT COUNT(*) as count FROM contacts").get().count;
    const totalMessages = this.sqliteDb.prepare("SELECT COUNT(*) as count FROM messages").get().count;
    const totalIncoming = this.sqliteDb.prepare("SELECT COUNT(*) as count FROM messages WHERE from_me = 0").get().count;
    const totalOutgoing = this.sqliteDb.prepare("SELECT COUNT(*) as count FROM messages WHERE from_me = 1").get().count;
    const totalAutoReplied = this.sqliteDb.prepare("SELECT COUNT(*) as count FROM messages WHERE auto_replied = 1").get().count;
    const totalOrders = this.sqliteDb.prepare("SELECT COUNT(*) as count FROM orders_leads").get().count;

    const tagsBreakdown = this.sqliteDb.prepare(`
      SELECT status_tag, COUNT(*) as count 
      FROM contacts 
      GROUP BY status_tag
    `).all();

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const dailyVolume = this.sqliteDb.prepare(`
      SELECT date(timestamp / 1000, 'unixepoch', 'localtime') as day, COUNT(*) as count,
             SUM(CASE WHEN from_me = 0 THEN 1 ELSE 0 END) as incoming,
             SUM(CASE WHEN from_me = 1 THEN 1 ELSE 0 END) as outgoing
      FROM messages
      WHERE timestamp >= ?
      GROUP BY day
      ORDER BY day ASC
    `).all(sevenDaysAgo);

    return {
      totalContacts,
      totalMessages,
      totalIncoming,
      totalOutgoing,
      totalAutoReplied,
      totalOrders,
      tagsBreakdown,
      dailyVolume,
    };
  }

  // --- AI Memory Context ---
  async saveAiMemory(contactJid, key, value, memoryType = "preference", confidence = 1.0) {
    if (this.isPostgres) {
      return this.pgPool.query(`
        INSERT INTO ai_memory_context (contact_jid, memory_key, memory_value, memory_type, confidence_score, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (contact_jid, memory_key) 
        DO UPDATE SET memory_value = EXCLUDED.memory_value, memory_type = EXCLUDED.memory_type, updated_at = EXCLUDED.updated_at
      `, [contactJid, key, value, memoryType, confidence, Date.now()]);
    }

    return this.sqliteDb.prepare(`
      INSERT OR REPLACE INTO ai_memory_context (contact_jid, memory_key, memory_value, memory_type, confidence_score, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(contactJid, key, value, memoryType, confidence, Date.now());
  }

  async getAiMemory(contactJid) {
    if (this.isPostgres) {
      const res = await this.pgPool.query("SELECT * FROM ai_memory_context WHERE contact_jid = $1", [contactJid]);
      return res.rows;
    }
    return this.sqliteDb.prepare("SELECT * FROM ai_memory_context WHERE contact_jid = ?").all(contactJid);
  }

  // --- Products Catalog ---
  async getProducts() {
    if (this.isPostgres) {
      const res = await this.pgPool.query("SELECT * FROM products_catalog WHERE is_available = true ORDER BY id ASC");
      return res.rows;
    }
    return this.sqliteDb.prepare("SELECT * FROM products_catalog WHERE is_available = 1 ORDER BY id ASC").all();
  }

  async saveProduct(product) {
    const { sku, title, description, price, discountPrice, stock, category, imageUrl } = product;
    if (this.isPostgres) {
      return this.pgPool.query(`
        INSERT INTO products_catalog (sku, title, description, price, discount_price, stock_quantity, category, image_url, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (sku) DO UPDATE SET title = EXCLUDED.title, price = EXCLUDED.price, stock_quantity = EXCLUDED.stock_quantity
      `, [sku || `SKU-${Date.now()}`, title, description || "", price || 0, discountPrice || null, stock || 100, category || "general", imageUrl || "", Date.now()]);
    }

    return this.sqliteDb.prepare(`
      INSERT OR REPLACE INTO products_catalog (sku, title, description, price, discount_price, stock_quantity, category, image_url, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sku || `SKU-${Date.now()}`, title, description || "", price || 0, discountPrice || null, stock || 100, category || "general", imageUrl || "", Date.now());
  }

  // --- Bot Rules & FAQs ---
  async getBotRules() {
    if (this.isPostgres) {
      const res = await this.pgPool.query("SELECT * FROM bot_rules_faqs WHERE is_active = true ORDER BY id ASC");
      return res.rows;
    }
    return this.sqliteDb.prepare("SELECT * FROM bot_rules_faqs WHERE is_active = 1 ORDER BY id ASC").all();
  }
}

module.exports = new CRMDatabase();
