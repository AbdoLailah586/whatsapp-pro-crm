const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const Database = require("better-sqlite3");
const { Pool } = require("pg");
const lidMapper = require("./lidMapper");
const { LEGACY_TENANT, currentUserId, runAsTenant } = require("./tenant");

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

function pgSchemaFor(userId) {
  if (!userId || userId === LEGACY_TENANT) return "public";
  const clean = String(userId).replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return "t_" + clean;
}

class CRMDatabase {
  constructor() {
    this.config = loadConfig();
    this.pgPool = null;
    this._legacySqliteDb = null;
    this.isPostgres = false;

    // Multi-tenancy bookkeeping
    this._sqliteHandles = new Map(); // tenantKey -> better-sqlite3 Database
    this._pgSchemasInitialized = new Set(); // schema names already CREATE'd
    this._waAuthTableInitializedPg = false;

    this.init();
  }

  // ==========================================================
  // Boot / connection setup (runs once for the "legacy" tenant,
  // i.e. whatever database this app was already using before
  // multi-tenancy existed)
  // ==========================================================
  init() {
    const pgUrl = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
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

    // Default: SQLite (legacy/default tenant lives at the original path so nothing moves)
    const DB_PATH = path.join(DATA_DIR, "crm.db");
    this._legacySqliteDb = new Database(DB_PATH);
    this._legacySqliteDb.pragma("journal_mode = WAL");
    this._sqliteHandles.set(LEGACY_TENANT, this._legacySqliteDb);
    this.isPostgres = false;
    console.log("💾 [Database] Using SQLite database (data/crm.db)");
    this._createSqliteTables(this._legacySqliteDb);
    this._createPlatformUsersTableSqlite(this._legacySqliteDb);
  }

  // ==========================================================
  // Multi-tenant resolution
  // ==========================================================

  // The current tenant's SQLite handle (opens + migrates it lazily on first use)
  get db() {
    return this._getSqliteHandle(currentUserId());
  }

  _getSqliteHandle(userId) {
    const key = (!userId || userId === LEGACY_TENANT) ? LEGACY_TENANT : String(userId);
    if (this._sqliteHandles.has(key)) return this._sqliteHandles.get(key);

    const dir = path.join(DATA_DIR, "tenants", key);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const db = new Database(path.join(dir, "crm.db"));
    db.pragma("journal_mode = WAL");
    this._createSqliteTables(db);
    this._sqliteHandles.set(key, db);
    return db;
  }

  // Run a query against the CURRENT tenant's Postgres schema. Replaces
  // every old `this.pgPool.query(...)` call site (schema isolation means
  // the actual SQL text never needs a `WHERE user_id = ...` clause).
  async q(text, params) {
    const schema = pgSchemaFor(currentUserId());
    await this._ensurePgSchema(schema);
    const client = await this.pgPool.connect();
    try {
      // Transaction-scoped search_path: strictly isolated even with PgBouncer / Neon poolers
      await client.query("BEGIN");
      await client.query(`SET LOCAL search_path TO "${schema}"`);
      const res = await client.query(text, params);
      await client.query("COMMIT");
      return res;
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch (e) {}
      throw err;
    } finally {
      client.release();
    }
  }

  async _ensurePgSchema(schema) {
    if (this._pgSchemasInitialized.has(schema)) return;
    const client = await this.pgPool.connect();
    try {
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
      await client.query(`SET search_path TO "${schema}"`);
      await this._createPgTables(client);
      this._pgSchemasInitialized.add(schema);
    } finally {
      try { await client.query("RESET search_path"); } catch (e) {}
      client.release();
    }
  }

  // ==========================================================
  // Table creation (identical SQL for every tenant - only the
  // active schema/file differs)
  // ==========================================================
  _createSqliteTables(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS contacts (
        jid TEXT PRIMARY KEY,
        name TEXT,
        phone TEXT,
        is_group INTEGER DEFAULT 0,
        avatar_url TEXT,
        status_bio TEXT,
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
        participant_jid TEXT,
        sender_name TEXT,
        text TEXT,
        media_type TEXT,
        media_url TEXT,
        media_meta TEXT DEFAULT '{}',
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

      CREATE TABLE IF NOT EXISTS audience_presets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT DEFAULT 'groups',
        target_jids TEXT DEFAULT '[]',
        excluded_jids TEXT DEFAULT '[]',
        created_at INTEGER
      );

      -- Simple per-tenant auto-reply rules (keyword -> response), used by /api/rules
      CREATE TABLE IF NOT EXISTS auto_reply_rules (
        id TEXT PRIMARY KEY,
        keyword TEXT NOT NULL,
        match_type TEXT DEFAULT 'contains',
        response TEXT NOT NULL,
        active INTEGER DEFAULT 1,
        created_at INTEGER
      );

      -- Generic per-tenant key/value store: bot settings (botEnabled/aiMode/...), etc.
      CREATE TABLE IF NOT EXISTS tenant_kv (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      -- Dedicated WhatsApp (Baileys) session table with strict compound primary key
      CREATE TABLE IF NOT EXISTS baileys_auth_store (
        user_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, key)
      );
      CREATE INDEX IF NOT EXISTS idx_baileys_auth_user ON baileys_auth_store(user_id);

      CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_jid, timestamp);
      CREATE INDEX IF NOT EXISTS idx_contacts_time ON contacts(last_message_time DESC);
      CREATE INDEX IF NOT EXISTS idx_ai_memory_jid ON ai_memory_context(contact_jid);
    `);

    // Safe column migrations - check each column individually so duplicate errors never abort migration
    this._safeAddColumn(db, "contacts", "is_group", "INTEGER DEFAULT 0");
    this._safeAddColumn(db, "contacts", "avatar_url", "TEXT");
    this._safeAddColumn(db, "contacts", "status_bio", "TEXT");
    this._safeAddColumn(db, "contacts", "lead_score", "INTEGER DEFAULT 0");
    this._safeAddColumn(db, "contacts", "total_spent", "REAL DEFAULT 0.0");
    this._safeAddColumn(db, "contacts", "total_orders_count", "INTEGER DEFAULT 0");
    this._safeAddColumn(db, "contacts", "bot_paused", "INTEGER DEFAULT 0");
    this._safeAddColumn(db, "contacts", "assigned_agent", "TEXT");
    this._safeAddColumn(db, "contacts", "city", "TEXT");
    this._safeAddColumn(db, "contacts", "governorate", "TEXT");
    this._safeAddColumn(db, "contacts", "address", "TEXT");
    this._safeAddColumn(db, "contacts", "custom_notes", "TEXT DEFAULT ''");
    this._safeAddColumn(db, "contacts", "custom_fields", "TEXT DEFAULT '{}'");
    this._safeAddColumn(db, "contacts", "last_message", "TEXT DEFAULT ''");
    this._safeAddColumn(db, "contacts", "last_message_time", "INTEGER DEFAULT 0");
    this._safeAddColumn(db, "contacts", "unread_count", "INTEGER DEFAULT 0");

    this._safeAddColumn(db, "messages", "participant_jid", "TEXT");
    this._safeAddColumn(db, "messages", "media_url", "TEXT");
    this._safeAddColumn(db, "messages", "media_meta", "TEXT DEFAULT '{}'");
    this._safeAddColumn(db, "messages", "ai_model", "TEXT");
    this._safeAddColumn(db, "messages", "ai_tokens_used", "INTEGER DEFAULT 0");
    this._safeAddColumn(db, "messages", "sentiment", "TEXT");
    this._safeAddColumn(db, "messages", "intent", "TEXT");

    this._safeAddColumn(db, "orders_leads", "order_number", "TEXT");
    this._safeAddColumn(db, "orders_leads", "items", "TEXT DEFAULT '[]'");
    this._safeAddColumn(db, "orders_leads", "currency", "TEXT DEFAULT 'EGP'");
    this._safeAddColumn(db, "orders_leads", "payment_method", "TEXT DEFAULT 'cash_on_delivery'");
    this._safeAddColumn(db, "orders_leads", "payment_status", "TEXT DEFAULT 'unpaid'");
    this._safeAddColumn(db, "orders_leads", "city", "TEXT");
    this._safeAddColumn(db, "orders_leads", "governorate", "TEXT");
    this._safeAddColumn(db, "orders_leads", "source", "TEXT DEFAULT 'whatsapp_ai'");
  }

  _safeAddColumn(db, table, column, definition) {
    try {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all();
      if (!cols.some((c) => c.name.toLowerCase() === column.toLowerCase())) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
      }
    } catch (e) {}
  }

  // The single platform-wide users table. This is intentionally NOT
  // per-tenant (a login needs to find the account before we know which
  // tenant it is) - it always lives in the legacy SQLite file / the
  // Postgres "public" schema, regardless of how many tenant schemas exist.
  _createPlatformUsersTableSqlite(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS platform_users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        display_name TEXT,
        is_admin INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        expires_at INTEGER,
        phone TEXT,
        notes TEXT,
        created_at INTEGER
      );
    `);
    // Migration helpers if table already existed
    try { db.exec(`ALTER TABLE platform_users ADD COLUMN is_admin INTEGER DEFAULT 0;`); } catch (e) {}
    try { db.exec(`ALTER TABLE platform_users ADD COLUMN status TEXT DEFAULT 'active';`); } catch (e) {}
    try { db.exec(`ALTER TABLE platform_users ADD COLUMN expires_at INTEGER;`); } catch (e) {}
    try { db.exec(`ALTER TABLE platform_users ADD COLUMN phone TEXT;`); } catch (e) {}
    try { db.exec(`ALTER TABLE platform_users ADD COLUMN notes TEXT;`); } catch (e) {}
    try {
      db.prepare(`UPDATE platform_users SET is_admin = 1, status = 'active' WHERE id = 'legacy' OR email LIKE '%01554826209%' OR email LIKE '%abdolailah586%'`).run();
    } catch (e) {}
  }

  async initPostgresTables() {
    if (!this.pgPool) return;
    const client = await this.pgPool.connect();
    try {
      await client.query(`SET search_path TO public`);
      await this._createPgTables(client);
      await client.query(`
        CREATE TABLE IF NOT EXISTS platform_users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          display_name TEXT,
          is_admin BOOLEAN DEFAULT FALSE,
          status TEXT DEFAULT 'active',
          expires_at BIGINT,
          phone TEXT,
          notes TEXT,
          created_at BIGINT
        );
        ALTER TABLE public.platform_users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;
        ALTER TABLE public.platform_users ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
        ALTER TABLE public.platform_users ADD COLUMN IF NOT EXISTS expires_at BIGINT;
        ALTER TABLE public.platform_users ADD COLUMN IF NOT EXISTS phone TEXT;
        CREATE TABLE IF NOT EXISTS public.baileys_auth_store (
          user_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          updated_at BIGINT NOT NULL,
          PRIMARY KEY (user_id, key)
        );
        CREATE INDEX IF NOT EXISTS idx_baileys_auth_user ON public.baileys_auth_store(user_id);
      `);
      this._waAuthTableInitializedPg = true;
      this._pgSchemasInitialized.add("public");
      console.log("🐘 [Database] PostgreSQL enterprise tables & admin columns initialized successfully.");
    } catch (e) {
      console.error("[Database] Error creating Postgres tables:", e.message);
    } finally {
      try { await client.query("RESET search_path"); } catch (e) {}
      client.release();
    }
    await this.migrateLidContacts();
    await this.mergeDuplicateContacts();
  }

  async _createPgTables(client) {
    await client.query(`
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

      CREATE TABLE IF NOT EXISTS audience_presets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type VARCHAR(50) DEFAULT 'groups',
        target_jids TEXT DEFAULT '[]',
        excluded_jids TEXT DEFAULT '[]',
        created_at BIGINT DEFAULT (EXTRACT(epoch FROM NOW()) * 1000)
      );

      CREATE TABLE IF NOT EXISTS auto_reply_rules (
        id TEXT PRIMARY KEY,
        keyword TEXT NOT NULL,
        match_type VARCHAR(50) DEFAULT 'contains',
        response TEXT NOT NULL,
        active BOOLEAN DEFAULT true,
        created_at BIGINT
      );

      CREATE TABLE IF NOT EXISTS tenant_kv (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_jid, timestamp);
      CREATE INDEX IF NOT EXISTS idx_contacts_time ON contacts(last_message_time DESC);
      CREATE INDEX IF NOT EXISTS idx_ai_memory_jid ON ai_memory_context(contact_jid);
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders_leads(status);

      -- Ensure all columns exist even if tables were created previously
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS name TEXT;
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS phone TEXT;
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS avatar_url TEXT;
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS status_bio TEXT;
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS status_tag VARCHAR(50) DEFAULT 'new';
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_group INT DEFAULT 0;
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lead_stage VARCHAR(50) DEFAULT 'new';
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS total_spent NUMERIC(12, 2) DEFAULT 0.00;
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS total_orders_count INT DEFAULT 0;
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS bot_paused INT DEFAULT 0;
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS assigned_agent TEXT;
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS city TEXT;
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS governorate TEXT;
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS address TEXT;
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS custom_notes TEXT DEFAULT '';
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}'::jsonb;
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_message TEXT DEFAULT '';
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_message_time BIGINT DEFAULT 0;
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS unread_count INT DEFAULT 0;
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS created_at BIGINT;

      ALTER TABLE messages ADD COLUMN IF NOT EXISTS participant_jid TEXT;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_name TEXT;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS text TEXT;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_type VARCHAR(50) DEFAULT 'text';
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url TEXT;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_meta JSONB DEFAULT '{}'::jsonb;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS from_me INT DEFAULT 0;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS auto_replied INT DEFAULT 0;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS ai_model TEXT;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS ai_tokens_used INT DEFAULT 0;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS sentiment VARCHAR(20) DEFAULT 'neutral';
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS intent VARCHAR(50);
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS timestamp BIGINT;
    `);
  }

  async mergeDuplicateContacts() {
    try {
      if (this.isPostgres) {
        const res = await this.q("SELECT * FROM contacts WHERE is_group = 0 OR is_group IS NULL");
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
            await this.q("UPDATE messages SET contact_jid = $1 WHERE contact_jid = ANY($2)", [primary.jid, secJids]);
            await this.q("UPDATE contacts SET name = $1, phone = $2 WHERE jid = $3", [bestName, phone, primary.jid]);
            await this.q("DELETE FROM contacts WHERE jid = ANY($1)", [secJids]);
          }
        }
      }
    } catch (e) {
      console.warn("[Database] mergeDuplicateContacts notice:", e.message);
    }
  }

  async migrateLidContacts() {
    try {
      if (this.isPostgres) {
        const res = await this.q("SELECT jid, phone FROM contacts WHERE jid LIKE '%@lid%' OR (phone IS NOT NULL AND LENGTH(phone) >= 14)");
        for (const row of res.rows) {
          const realPhone = lidMapper.resolveLidToPhone(row.jid);
          if (realPhone && realPhone !== row.phone) {
            await this.q("UPDATE contacts SET phone = $1 WHERE jid = $2", [realPhone, row.jid]);
          }
        }
      } else if (this.db) {
        const rows = this.db.prepare("SELECT jid, phone FROM contacts WHERE jid LIKE '%@lid%' OR (phone IS NOT NULL AND LENGTH(phone) >= 14)").all();
        const updateStmt = this.db.prepare("UPDATE contacts SET phone = ? WHERE jid = ?");
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
        await this.q(
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
             last_message_time = GREATEST(COALESCE(contacts.last_message_time, 0), EXCLUDED.last_message_time),
             unread_count = contacts.unread_count + (CASE WHEN $7 = 1 THEN 1 ELSE 0 END)`,
          [jid, cleanName, cleanPhone, isGrp, lastMsg || "", timestamp || Date.now(), isIncoming ? 1 : 0, Date.now()]
        );
      } catch (err) {
        console.error("[DB] upsertContact Postgres error:", err.message);
      }
      return;
    }

    // SQLite
    const existing = this.db.prepare("SELECT * FROM contacts WHERE jid = ?").get(jid);
    if (!existing) {
      this.db.prepare(`
        INSERT INTO contacts (jid, name, phone, is_group, status_tag, bot_paused, custom_notes, last_message, last_message_time, unread_count, created_at)
        VALUES (?, ?, ?, ?, 'new', 0, '', ?, ?, ?, ?)
      `).run(jid, cleanName, cleanPhone, isGrp, lastMsg, timestamp, isIncoming ? 1 : 0, Date.now());
    } else {
      const hasCustomName = existing.name && existing.name !== existing.phone && existing.name !== existing.jid;
      const updatedName = hasCustomName ? existing.name : ((name && name !== cleanPhone) ? name : existing.name);
      const hasCustomPhone = existing.phone && existing.phone !== existing.jid && existing.phone.length < 14;
      const updatedPhone = hasCustomPhone ? existing.phone : (cleanPhone || existing.phone);
      const unread = isIncoming ? existing.unread_count + 1 : existing.unread_count;
      const finalTime = Math.max(Number(existing.last_message_time || 0), Number(timestamp || 0));
      this.db.prepare(`
        UPDATE contacts
        SET name = ?, phone = ?, is_group = ?, last_message = ?, last_message_time = ?, unread_count = ?
        WHERE jid = ?
      `).run(updatedName, updatedPhone, isGrp, lastMsg || existing.last_message, finalTime, unread, jid);
    }
  }

  async updateContactProfile(jid, data) {
    const { name, phone, city, governorate, address, status_tag, custom_notes, avatar_url, status_bio } = data;
    if (this.isPostgres) {
      return this.q(
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
    return this.db.prepare(`
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
      return this.q("UPDATE contacts SET avatar_url = $1 WHERE jid = $2", [avatarUrl, jid]);
    }
    return this.db.prepare("UPDATE contacts SET avatar_url = ? WHERE jid = ?").run(avatarUrl, jid);
  }

  async updateContactBio(jid, bio) {
    if (this.isPostgres) {
      return this.q("UPDATE contacts SET status_bio = $1 WHERE jid = $2", [bio, jid]);
    }
    return this.db.prepare("UPDATE contacts SET status_bio = ? WHERE jid = ?").run(bio, jid);
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
      const res = await this.q(query, params);
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
    return this.db.prepare(query).all(...params);
  }

  async getContact(jid) {
    if (this.isPostgres) {
      const res = await this.q("SELECT * FROM contacts WHERE jid = $1", [jid]);
      return res.rows[0] || null;
    }
    return this.db.prepare("SELECT * FROM contacts WHERE jid = ?").get(jid) || null;
  }

  async updateContactTag(jid, tag) {
    if (this.isPostgres) {
      return this.q("UPDATE contacts SET status_tag = $1 WHERE jid = $2", [tag, jid]);
    }
    return this.db.prepare("UPDATE contacts SET status_tag = ? WHERE jid = ?").run(tag, jid);
  }

  async toggleBotPaused(jid, paused) {
    const val = paused ? 1 : 0;
    if (this.isPostgres) {
      return this.q("UPDATE contacts SET bot_paused = $1 WHERE jid = $2", [val, jid]);
    }
    return this.db.prepare("UPDATE contacts SET bot_paused = ? WHERE jid = ?").run(val, jid);
  }

  async updateContactNotes(jid, notes) {
    if (this.isPostgres) {
      return this.q("UPDATE contacts SET custom_notes = $1 WHERE jid = $2", [notes, jid]);
    }
    return this.db.prepare("UPDATE contacts SET custom_notes = ? WHERE jid = ?").run(notes, jid);
  }

  async markContactRead(jid) {
    if (this.isPostgres) {
      return this.q("UPDATE contacts SET unread_count = 0 WHERE jid = $1", [jid]);
    }
    return this.db.prepare("UPDATE contacts SET unread_count = 0 WHERE jid = ?").run(jid);
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
      return this.q(`
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

    const stmt = this.db.prepare(`
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
      const res = await this.q(`
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
    return this.db.prepare(`
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
      const res = await this.q(`
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
    return this.db.prepare(`
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
        const res = await this.q(`
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
      const stmt = this.db.prepare(`
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
        const res = await this.q("SELECT * FROM orders_leads ORDER BY created_at DESC");
        return res.rows;
      } catch (e) {
        console.error("[Database] Postgres getOrdersLeads error:", e.message);
        return [];
      }
    }
    try {
      return this.db.prepare("SELECT * FROM orders_leads ORDER BY created_at DESC").all();
    } catch (e) {
      console.error("[Database] SQLite getOrdersLeads error:", e.message);
      return [];
    }
  }

  async updateOrderStatus(id, status, googleSheetSynced = null) {
    if (this.isPostgres) {
      try {
        if (googleSheetSynced !== null) {
          return await this.q("UPDATE orders_leads SET status = $1, google_sheet_synced = $2 WHERE id = $3", [status, googleSheetSynced ? 1 : 0, id]);
        }
        return await this.q("UPDATE orders_leads SET status = $1 WHERE id = $2", [status, id]);
      } catch (e) {
        console.error("[Database] Postgres updateOrderStatus error:", e.message);
      }
      return;
    }

    try {
      if (googleSheetSynced !== null) {
        return this.db.prepare("UPDATE orders_leads SET status = ?, google_sheet_synced = ? WHERE id = ?").run(status, googleSheetSynced ? 1 : 0, id);
      }
      return this.db.prepare("UPDATE orders_leads SET status = ? WHERE id = ?").run(status, id);
    } catch (e) {
      console.error("[Database] SQLite updateOrderStatus error:", e.message);
    }
  }

  // --- Campaigns ---
  async createCampaign(title, template, targetCount, delaySeconds = 8) {
    const id = "camp_" + crypto.randomUUID();
    if (this.isPostgres) {
      await this.q(`
        INSERT INTO campaigns (id, title, message_template, target_count, sent_count, failed_count, delay_seconds, status, created_at)
        VALUES ($1, $2, $3, $4, 0, 0, $5, 'running', $6)
      `, [id, title, template, targetCount, delaySeconds, Date.now()]);
      return id;
    }

    this.db.prepare(`
      INSERT INTO campaigns (id, title, message_template, target_count, sent_count, failed_count, delay_seconds, status, created_at)
      VALUES (?, ?, ?, ?, 0, 0, ?, 'running', ?)
    `).run(id, title, template, targetCount, delaySeconds, Date.now());
    return id;
  }

  async updateCampaignProgress(id, sentCount, failedCount, status) {
    if (this.isPostgres) {
      return this.q(`
        UPDATE campaigns SET sent_count = $1, failed_count = $2, status = $3 WHERE id = $4
      `, [sentCount, failedCount, status, id]);
    }

    return this.db.prepare(`
      UPDATE campaigns
      SET sent_count = ?, failed_count = ?, status = ?
      WHERE id = ?
    `).run(sentCount, failedCount, status, id);
  }

  async logCampaignItem(campaignId, phone, status, errorMessage = "") {
    if (this.isPostgres) {
      return this.q(`
        INSERT INTO campaign_logs (campaign_id, phone, status, error_message, sent_at)
        VALUES ($1, $2, $3, $4, $5)
      `, [campaignId, phone, status, errorMessage, Date.now()]);
    }

    return this.db.prepare(`
      INSERT INTO campaign_logs (campaign_id, phone, status, error_message, sent_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(campaignId, phone, status, errorMessage, Date.now());
  }

  async getCampaigns() {
    if (this.isPostgres) {
      const res = await this.q("SELECT * FROM campaigns ORDER BY created_at DESC");
      return res.rows;
    }
    return this.db.prepare("SELECT * FROM campaigns ORDER BY created_at DESC").all();
  }

  async updateCampaignStatusOnly(id, status) {
    if (this.isPostgres) {
      return this.q("UPDATE campaigns SET status = $1 WHERE id = $2", [status, id]);
    }
    return this.db.prepare("UPDATE campaigns SET status = ? WHERE id = ?").run(status, id);
  }

  async getCampaignLogs(campaignId) {
    if (this.isPostgres) {
      const res = await this.q("SELECT * FROM campaign_logs WHERE campaign_id = $1 ORDER BY sent_at DESC", [campaignId]);
      return res.rows;
    }
    return this.db.prepare("SELECT * FROM campaign_logs WHERE campaign_id = ? ORDER BY sent_at DESC").all(campaignId);
  }

  // --- Audience Presets ---
  async saveAudiencePreset({ id, name, type = "groups", targetJids = [], excludedJids = [] }) {
    const presetId = id || ("preset_" + Date.now());
    const targetStr = typeof targetJids === "string" ? targetJids : JSON.stringify(targetJids);
    const excludedStr = typeof excludedJids === "string" ? excludedJids : JSON.stringify(excludedJids);
    const now = Date.now();

    if (this.isPostgres) {
      await this.q(`
        INSERT INTO audience_presets (id, name, type, target_jids, excluded_jids, created_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          type = EXCLUDED.type,
          target_jids = EXCLUDED.target_jids,
          excluded_jids = EXCLUDED.excluded_jids
      `, [presetId, name, type, targetStr, excludedStr, now]);
      return { id: presetId, name, type, targetJids, excludedJids, createdAt: now };
    }

    this.db.prepare(`
      INSERT INTO audience_presets (id, name, type, target_jids, excluded_jids, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        name = excluded.name,
        type = excluded.type,
        target_jids = excluded.target_jids,
        excluded_jids = excluded.excluded_jids
    `).run(presetId, name, type, targetStr, excludedStr, now);
    return { id: presetId, name, type, targetJids, excludedJids, createdAt: now };
  }

  async getAudiencePresets() {
    let rows = [];
    if (this.isPostgres) {
      const res = await this.q("SELECT * FROM audience_presets ORDER BY created_at DESC");
      rows = res.rows;
    } else if (this.db) {
      rows = this.db.prepare("SELECT * FROM audience_presets ORDER BY created_at DESC").all();
    }

    return rows.map((r) => {
      let targetJids = [];
      let excludedJids = [];
      try {
        targetJids = typeof r.target_jids === "string" ? JSON.parse(r.target_jids) : (r.target_jids || []);
      } catch (e) {
        targetJids = [];
      }
      try {
        excludedJids = typeof r.excluded_jids === "string" ? JSON.parse(r.excluded_jids) : (r.excluded_jids || []);
      } catch (e) {
        excludedJids = [];
      }
      return {
        id: r.id,
        name: r.name,
        type: r.type,
        targetJids,
        excludedJids,
        createdAt: r.created_at,
      };
    });
  }

  async deleteAudiencePreset(id) {
    if (this.isPostgres) {
      return this.q("DELETE FROM audience_presets WHERE id = $1", [id]);
    }
    return this.db.prepare("DELETE FROM audience_presets WHERE id = ?").run(id);
  }


  // --- Analytics ---
  async getAnalytics() {
    if (this.isPostgres) {
      const c = await this.q("SELECT COUNT(*) as count FROM contacts");
      const m = await this.q("SELECT COUNT(*) as count FROM messages");
      const inc = await this.q("SELECT COUNT(*) as count FROM messages WHERE from_me = 0");
      const out = await this.q("SELECT COUNT(*) as count FROM messages WHERE from_me = 1");
      const auto = await this.q("SELECT COUNT(*) as count FROM messages WHERE auto_replied = 1");
      const ord = await this.q("SELECT COUNT(*) as count FROM orders_leads");
      const tags = await this.q("SELECT status_tag, COUNT(*) as count FROM contacts GROUP BY status_tag");

      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const vol = await this.q(`
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
    const totalContacts = this.db.prepare("SELECT COUNT(*) as count FROM contacts").get().count;
    const totalMessages = this.db.prepare("SELECT COUNT(*) as count FROM messages").get().count;
    const totalIncoming = this.db.prepare("SELECT COUNT(*) as count FROM messages WHERE from_me = 0").get().count;
    const totalOutgoing = this.db.prepare("SELECT COUNT(*) as count FROM messages WHERE from_me = 1").get().count;
    const totalAutoReplied = this.db.prepare("SELECT COUNT(*) as count FROM messages WHERE auto_replied = 1").get().count;
    const totalOrders = this.db.prepare("SELECT COUNT(*) as count FROM orders_leads").get().count;

    const tagsBreakdown = this.db.prepare(`
      SELECT status_tag, COUNT(*) as count
      FROM contacts
      GROUP BY status_tag
    `).all();

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const dailyVolume = this.db.prepare(`
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
      return this.q(`
        INSERT INTO ai_memory_context (contact_jid, memory_key, memory_value, memory_type, confidence_score, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (contact_jid, memory_key)
        DO UPDATE SET memory_value = EXCLUDED.memory_value, memory_type = EXCLUDED.memory_type, updated_at = EXCLUDED.updated_at
      `, [contactJid, key, value, memoryType, confidence, Date.now()]);
    }

    return this.db.prepare(`
      INSERT OR REPLACE INTO ai_memory_context (contact_jid, memory_key, memory_value, memory_type, confidence_score, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(contactJid, key, value, memoryType, confidence, Date.now());
  }

  async getAiMemory(contactJid) {
    if (this.isPostgres) {
      const res = await this.q("SELECT * FROM ai_memory_context WHERE contact_jid = $1", [contactJid]);
      return res.rows;
    }
    return this.db.prepare("SELECT * FROM ai_memory_context WHERE contact_jid = ?").all(contactJid);
  }

  // --- Products Catalog ---
  async getProducts() {
    if (this.isPostgres) {
      const res = await this.q("SELECT * FROM products_catalog WHERE is_available = true ORDER BY id ASC");
      return res.rows;
    }
    return this.db.prepare("SELECT * FROM products_catalog WHERE is_available = 1 ORDER BY id ASC").all();
  }

  async saveProduct(product) {
    const { sku, title, description, price, discountPrice, stock, category, imageUrl } = product;
    if (this.isPostgres) {
      return this.q(`
        INSERT INTO products_catalog (sku, title, description, price, discount_price, stock_quantity, category, image_url, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (sku) DO UPDATE SET title = EXCLUDED.title, price = EXCLUDED.price, stock_quantity = EXCLUDED.stock_quantity
      `, [sku || `SKU-${Date.now()}`, title, description || "", price || 0, discountPrice || null, stock || 100, category || "general", imageUrl || "", Date.now()]);
    }

    return this.db.prepare(`
      INSERT OR REPLACE INTO products_catalog (sku, title, description, price, discount_price, stock_quantity, category, image_url, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sku || `SKU-${Date.now()}`, title, description || "", price || 0, discountPrice || null, stock || 100, category || "general", imageUrl || "", Date.now());
  }

  // --- Bot Rules & FAQs (legacy/unused table, kept for compatibility) ---
  async getBotRulesLegacyTable() {
    if (this.isPostgres) {
      const res = await this.q("SELECT * FROM bot_rules_faqs WHERE is_active = true ORDER BY id ASC");
      return res.rows;
    }
    return this.db.prepare("SELECT * FROM bot_rules_faqs WHERE is_active = 1 ORDER BY id ASC").all();
  }

  // --- Auto-reply rules (per tenant, used by /api/rules) ---
  async getAutoReplyRules() {
    if (this.isPostgres) {
      const res = await this.q("SELECT * FROM auto_reply_rules ORDER BY created_at ASC");
      return res.rows.map(r => ({ id: r.id, keyword: r.keyword, matchType: r.match_type, response: r.response, active: !!r.active }));
    }
    const rows = this.db.prepare("SELECT * FROM auto_reply_rules ORDER BY created_at ASC").all();
    return rows.map(r => ({ id: r.id, keyword: r.keyword, matchType: r.match_type, response: r.response, active: !!r.active }));
  }

  async addAutoReplyRule({ id, keyword, matchType, response, active = true }) {
    const ruleId = id || Date.now().toString();
    const now = Date.now();
    if (this.isPostgres) {
      await this.q(
        `INSERT INTO auto_reply_rules (id, keyword, match_type, response, active, created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
        [ruleId, keyword, matchType || "contains", response, active !== false, now]
      );
    } else {
      this.db.prepare(
        `INSERT INTO auto_reply_rules (id, keyword, match_type, response, active, created_at) VALUES (?,?,?,?,?,?)`
      ).run(ruleId, keyword, matchType || "contains", response, active !== false ? 1 : 0, now);
    }
    return { id: ruleId, keyword, matchType: matchType || "contains", response, active: active !== false };
  }

  async updateAutoReplyRule(id, fields) {
    const existing = this.isPostgres
      ? (await this.q("SELECT * FROM auto_reply_rules WHERE id = $1", [id])).rows[0]
      : this.db.prepare("SELECT * FROM auto_reply_rules WHERE id = ?").get(id);
    if (!existing) return null;

    const keyword = fields.keyword !== undefined ? fields.keyword : existing.keyword;
    const matchType = fields.matchType !== undefined ? fields.matchType : existing.match_type;
    const response = fields.response !== undefined ? fields.response : existing.response;
    const active = fields.active !== undefined ? !!fields.active : !!existing.active;

    if (this.isPostgres) {
      await this.q(
        "UPDATE auto_reply_rules SET keyword=$1, match_type=$2, response=$3, active=$4 WHERE id=$5",
        [keyword, matchType, response, active, id]
      );
    } else {
      this.db.prepare(
        "UPDATE auto_reply_rules SET keyword=?, match_type=?, response=?, active=? WHERE id=?"
      ).run(keyword, matchType, response, active ? 1 : 0, id);
    }
    return { id, keyword, matchType, response, active };
  }

  async deleteAutoReplyRule(id) {
    if (this.isPostgres) {
      const res = await this.q("DELETE FROM auto_reply_rules WHERE id = $1", [id]);
      return res.rowCount > 0;
    }
    const res = this.db.prepare("DELETE FROM auto_reply_rules WHERE id = ?").run(id);
    return res.changes > 0;
  }

  // --- Generic per-tenant key/value store ---
  async kvGet(key) {
    if (this.isPostgres) {
      const res = await this.q("SELECT value FROM tenant_kv WHERE key = $1", [key]);
      return res.rows[0] ? res.rows[0].value : null;
    }
    const row = this.db.prepare("SELECT value FROM tenant_kv WHERE key = ?").get(key);
    return row ? row.value : null;
  }

  async kvSet(key, value) {
    if (this.isPostgres) {
      return this.q(
        `INSERT INTO tenant_kv (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, value]
      );
    }
    return this.db.prepare(
      `INSERT INTO tenant_kv (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`
    ).run(key, value);
  }

  async kvDelete(key) {
    if (this.isPostgres) return this.q("DELETE FROM tenant_kv WHERE key = $1", [key]);
    return this.db.prepare("DELETE FROM tenant_kv WHERE key = ?").run(key);
  }

  async kvDeletePrefix(prefix) {
    if (this.isPostgres) return this.q("DELETE FROM tenant_kv WHERE key LIKE $1", [prefix + "%"]);
    return this.db.prepare("DELETE FROM tenant_kv WHERE key LIKE ?").run(prefix + "%");
  }

  async getBotSettings() {
    const raw = await this.kvGet("bot_settings");
    const defaults = { botEnabled: true, aiMode: "", microMindApiUrl: "", googleSheetWebhookUrl: "" };
    if (!raw) return defaults;
    try {
      return { ...defaults, ...JSON.parse(raw) };
    } catch (e) {
      return defaults;
    }
  }

  async setBotSettings(partial) {
    const current = await this.getBotSettings();
    const updated = { ...current, ...partial };
    await this.kvSet("bot_settings", JSON.stringify(updated));
    return updated;
  }

  // ==========================================================
  // WhatsApp (Baileys) auth-state storage
  // ----------------------------------------------------------
  // Guaranteed 100% strict isolation: `user_id` is an explicit
  // SQL parameter in the compound primary key (user_id, key).
  // Completely immune to AsyncLocalStorage loss, PgBouncer pooler
  // switching, or schema fallback bugs.
  // ==========================================================

  async initWaAuthTablePg() {
    if (this._waAuthTableInitializedPg) return;
    try {
      await this.pgPool.query(`
        CREATE TABLE IF NOT EXISTS public.baileys_auth_store (
          user_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          updated_at BIGINT NOT NULL,
          PRIMARY KEY (user_id, key)
        );
        CREATE INDEX IF NOT EXISTS idx_baileys_auth_user ON public.baileys_auth_store(user_id);
      `);
      this._waAuthTableInitializedPg = true;
    } catch (e) {
      console.warn("[Database] initWaAuthTablePg notice:", e.message);
    }
  }

  _ensureWaAuthTableSqlite(db) {
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS baileys_auth_store (
          user_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, key)
        );
        CREATE INDEX IF NOT EXISTS idx_baileys_auth_user ON baileys_auth_store(user_id);
      `);
    } catch (e) {}
  }

  async getAuthBlob(userId, key) {
    const uid = String(userId || LEGACY_TENANT);
    if (this.isPostgres) {
      await this.initWaAuthTablePg();
      const res = await this.pgPool.query(
        "SELECT value FROM public.baileys_auth_store WHERE user_id = $1 AND key = $2",
        [uid, key]
      );
      if (res.rows[0]) return res.rows[0].value;

      // Backward compatibility fallback to migrate old tenant_kv row if present
      try {
        const legacyRes = await this.pgPool.query(
          `SELECT value FROM "${pgSchemaFor(uid)}".tenant_kv WHERE key = $1`,
          [`wa_auth:${key}`]
        );
        if (legacyRes.rows[0] && legacyRes.rows[0].value) {
          await this.setAuthBlob(uid, key, legacyRes.rows[0].value);
          return legacyRes.rows[0].value;
        }
      } catch (e) {}
      return null;
    }

    const db = this._legacySqliteDb || this.db;
    this._ensureWaAuthTableSqlite(db);
    const row = db.prepare("SELECT value FROM baileys_auth_store WHERE user_id = ? AND key = ?").get(uid, key);
    if (row) return row.value;

    // Backward compatibility fallback to migrate old SQLite row if present
    try {
      const oldHandle = this._getSqliteHandle(uid);
      const oldRow = oldHandle.prepare("SELECT value FROM tenant_kv WHERE key = ?").get(`wa_auth:${key}`);
      if (oldRow && oldRow.value) {
        await this.setAuthBlob(uid, key, oldRow.value);
        return oldRow.value;
      }
    } catch (e) {}
    return null;
  }

  async getAuthBlobs(userId, keys) {
    if (!keys || keys.length === 0) return {};
    const uid = String(userId || LEGACY_TENANT);
    const result = {};

    if (this.isPostgres) {
      await this.initWaAuthTablePg();
      const res = await this.pgPool.query(
        "SELECT key, value FROM public.baileys_auth_store WHERE user_id = $1 AND key = ANY($2)",
        [uid, keys]
      );
      for (const row of res.rows) {
        result[row.key] = row.value;
      }
      return result;
    }

    const db = this._legacySqliteDb || this.db;
    this._ensureWaAuthTableSqlite(db);
    const CHUNK_SIZE = 500;
    for (let i = 0; i < keys.length; i += CHUNK_SIZE) {
      const chunk = keys.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => "?").join(",");
      const rows = db.prepare(`SELECT key, value FROM baileys_auth_store WHERE user_id = ? AND key IN (${placeholders})`).all(uid, ...chunk);
      for (const r of rows) {
        result[r.key] = r.value;
      }
    }
    return result;
  }

  async setAuthBlob(userId, key, value) {
    const uid = String(userId || LEGACY_TENANT);
    const now = Date.now();
    if (this.isPostgres) {
      await this.initWaAuthTablePg();
      return this.pgPool.query(
        `INSERT INTO public.baileys_auth_store (user_id, key, value, updated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        [uid, key, value, now]
      );
    }
    const db = this._legacySqliteDb || this.db;
    this._ensureWaAuthTableSqlite(db);
    return db.prepare(
      `INSERT INTO baileys_auth_store (user_id, key, value, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).run(uid, key, value, now);
  }

  async setAuthBlobs(userId, entries) {
    if (!entries || entries.length === 0) return;
    const uid = String(userId || LEGACY_TENANT);
    const now = Date.now();

    if (this.isPostgres) {
      await this.initWaAuthTablePg();
      const client = await this.pgPool.connect();
      try {
        await client.query("BEGIN");
        for (const { key, value } of entries) {
          await client.query(
            `INSERT INTO public.baileys_auth_store (user_id, key, value, updated_at)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
            [uid, key, value, now]
          );
        }
        await client.query("COMMIT");
      } catch (err) {
        try { await client.query("ROLLBACK"); } catch (e) {}
        throw err;
      } finally {
        client.release();
      }
      return;
    }

    const db = this._legacySqliteDb || this.db;
    this._ensureWaAuthTableSqlite(db);
    const insertStmt = db.prepare(
      `INSERT INTO baileys_auth_store (user_id, key, value, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    );
    const tx = db.transaction((items) => {
      for (const { key, value } of items) {
        insertStmt.run(uid, key, value, now);
      }
    });
    tx(entries);
  }

  async deleteAuthBlob(userId, key) {
    const uid = String(userId || LEGACY_TENANT);
    if (this.isPostgres) {
      await this.initWaAuthTablePg();
      return this.pgPool.query(
        "DELETE FROM public.baileys_auth_store WHERE user_id = $1 AND key = $2",
        [uid, key]
      );
    }
    const db = this._legacySqliteDb || this.db;
    this._ensureWaAuthTableSqlite(db);
    return db.prepare("DELETE FROM baileys_auth_store WHERE user_id = ? AND key = ?").run(uid, key);
  }

  async deleteAuthBlobs(userId, keys) {
    if (!keys || keys.length === 0) return;
    const uid = String(userId || LEGACY_TENANT);
    if (this.isPostgres) {
      await this.initWaAuthTablePg();
      return this.pgPool.query(
        "DELETE FROM public.baileys_auth_store WHERE user_id = $1 AND key = ANY($2)",
        [uid, keys]
      );
    }
    const db = this._legacySqliteDb || this.db;
    this._ensureWaAuthTableSqlite(db);
    const CHUNK_SIZE = 500;
    for (let i = 0; i < keys.length; i += CHUNK_SIZE) {
      const chunk = keys.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => "?").join(",");
      db.prepare(`DELETE FROM baileys_auth_store WHERE user_id = ? AND key IN (${placeholders})`).run(uid, ...chunk);
    }
  }

  async clearAuthBlobs(userId) {
    const uid = String(userId || LEGACY_TENANT);
    if (this.isPostgres) {
      await this.initWaAuthTablePg();
      await this.pgPool.query(
        "DELETE FROM public.baileys_auth_store WHERE user_id = $1",
        [uid]
      );
      try {
        await this.pgPool.query(
          `DELETE FROM "${pgSchemaFor(uid)}".tenant_kv WHERE key LIKE 'wa_auth:%'`
        );
      } catch (e) {}
      return;
    }
    const db = this._legacySqliteDb || this.db;
    this._ensureWaAuthTableSqlite(db);
    db.prepare("DELETE FROM baileys_auth_store WHERE user_id = ?").run(uid);
    try {
      db.prepare("DELETE FROM tenant_kv WHERE key LIKE ?").run("wa_auth:%");
      if (this._sqliteHandles && this._sqliteHandles.has(uid)) {
        this._sqliteHandles.get(uid).prepare("DELETE FROM tenant_kv WHERE key LIKE ?").run("wa_auth:%");
      }
    } catch (e) {}
  }

  // ==========================================================
  // Platform users (accounts). Always the legacy/public database -
  // never per-tenant, since a login has to find the account first.
  // ==========================================================
  async countUsers() {
    if (this.isPostgres) {
      const res = await this.pgPool.query("SELECT COUNT(*) as count FROM public.platform_users");
      return Number(res.rows[0]?.count || 0);
    }
    return this._legacySqliteDb.prepare("SELECT COUNT(*) as count FROM platform_users").get().count;
  }

  async createUser({ id, email, passwordHash, displayName, isAdmin = false, status = "active", expiresAt = null, phone = "", notes = "" }) {
    const now = Date.now();
    const cleanEmail = email.toLowerCase().trim();
    if (this.isPostgres) {
      const client = await this.pgPool.connect();
      try {
        await client.query(
          "INSERT INTO public.platform_users (id, email, password_hash, display_name, is_admin, status, expires_at, phone, notes, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [id, cleanEmail, passwordHash, displayName || "", !!isAdmin, status || "active", expiresAt || null, phone || "", notes || "", now]
        );
      } finally {
        client.release();
      }
    } else {
      this._legacySqliteDb.prepare(
        "INSERT INTO platform_users (id, email, password_hash, display_name, is_admin, status, expires_at, phone, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)"
      ).run(id, cleanEmail, passwordHash, displayName || "", isAdmin ? 1 : 0, status || "active", expiresAt || null, phone || "", notes || "", now);
    }
    return { id, email: cleanEmail, displayName: displayName || "", isAdmin: !!isAdmin, status, expiresAt, phone, notes, createdAt: now };
  }

  async getAllUsers() {
    if (this.isPostgres) {
      const client = await this.pgPool.connect();
      try {
        const res = await client.query(
          "SELECT id, email, display_name, is_admin, status, expires_at, phone, notes, created_at FROM public.platform_users ORDER BY created_at DESC"
        );
        return res.rows.map(r => ({
          ...r,
          is_admin: !!r.is_admin,
          expires_at: r.expires_at ? Number(r.expires_at) : null,
          created_at: Number(r.created_at)
        }));
      } finally {
        client.release();
      }
    }
    const rows = this._legacySqliteDb.prepare(
      "SELECT id, email, display_name, is_admin, status, expires_at, phone, notes, created_at FROM platform_users ORDER BY created_at DESC"
    ).all();
    return rows.map(r => ({
      ...r,
      is_admin: !!r.is_admin,
      expires_at: r.expires_at ? Number(r.expires_at) : null,
      created_at: Number(r.created_at)
    }));
  }

  async updateUser(id, updates = {}) {
    const user = await this.getUserById(id);
    if (!user) return null;

    const fields = [];
    const values = [];
    let idx = 1;

    if (updates.displayName !== undefined) {
      fields.push(this.isPostgres ? `display_name = $${idx++}` : "display_name = ?");
      values.push(updates.displayName);
    }
    if (updates.passwordHash) {
      fields.push(this.isPostgres ? `password_hash = $${idx++}` : "password_hash = ?");
      values.push(updates.passwordHash);
    }
    if (updates.status !== undefined) {
      fields.push(this.isPostgres ? `status = $${idx++}` : "status = ?");
      values.push(updates.status);
    }
    if (updates.expiresAt !== undefined) {
      fields.push(this.isPostgres ? `expires_at = $${idx++}` : "expires_at = ?");
      values.push(updates.expiresAt);
    }
    if (updates.phone !== undefined) {
      fields.push(this.isPostgres ? `phone = $${idx++}` : "phone = ?");
      values.push(updates.phone);
    }
    if (updates.notes !== undefined) {
      fields.push(this.isPostgres ? `notes = $${idx++}` : "notes = ?");
      values.push(updates.notes);
    }
    if (updates.isAdmin !== undefined) {
      fields.push(this.isPostgres ? `is_admin = $${idx++}` : "is_admin = ?");
      values.push(this.isPostgres ? !!updates.isAdmin : (updates.isAdmin ? 1 : 0));
    }

    if (fields.length === 0) return user;

    if (this.isPostgres) {
      values.push(id);
      const client = await this.pgPool.connect();
      try {
        await client.query(`UPDATE public.platform_users SET ${fields.join(", ")} WHERE id = $${idx}`, values);
      } finally {
        client.release();
      }
    } else {
      values.push(id);
      this._legacySqliteDb.prepare(`UPDATE platform_users SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    }
    return this.getUserById(id);
  }

  async renewUser(id, days = 30) {
    const user = await this.getUserById(id);
    if (!user) return null;
    const now = Date.now();
    const currentExpiry = user.expires_at ? Number(user.expires_at) : now;
    const base = currentExpiry > now ? currentExpiry : now;
    const newExpiry = base + Number(days) * 24 * 60 * 60 * 1000;
    return this.updateUser(id, { expiresAt: newExpiry, status: "active" });
  }

  async deleteUser(id) {
    if (id === "legacy") return false;
    if (this.isPostgres) {
      const client = await this.pgPool.connect();
      try {
        const res = await client.query("DELETE FROM public.platform_users WHERE id = $1 AND id != 'legacy'", [id]);
        return res.rowCount > 0;
      } finally {
        client.release();
      }
    }
    const info = this._legacySqliteDb.prepare("DELETE FROM platform_users WHERE id = ? AND id != 'legacy'").run(id);
    return info.changes > 0;
  }

  async getUserByEmail(identifier) {
    if (!identifier) return null;
    const clean = String(identifier).toLowerCase().trim();
    if (this.isPostgres) {
      const client = await this.pgPool.connect();
      try {
        const res = await client.query(
          "SELECT * FROM public.platform_users WHERE LOWER(email) = $1 OR id = $1 OR LOWER(email) LIKE $2 OR LOWER(display_name) = $1",
          [clean, `${clean}@%`]
        );
        return res.rows[0] || null;
      } finally {
        client.release();
      }
    }
    return (
      this._legacySqliteDb
        .prepare(
          "SELECT * FROM platform_users WHERE LOWER(email) = ? OR id = ? OR LOWER(email) LIKE ? OR LOWER(display_name) = ?"
        )
        .get(clean, clean, `${clean}@%`, clean) || null
    );
  }

  async getUserById(id) {
    if (!id) return null;
    if (this.isPostgres) {
      const client = await this.pgPool.connect();
      try {
        const res = await client.query("SELECT * FROM public.platform_users WHERE id = $1", [id]);
        return res.rows[0] || null;
      } finally {
        client.release();
      }
    }
    return this._legacySqliteDb.prepare("SELECT * FROM platform_users WHERE id = ?").get(id) || null;
  }
}

module.exports = new CRMDatabase();
module.exports.pgSchemaFor = pgSchemaFor;
