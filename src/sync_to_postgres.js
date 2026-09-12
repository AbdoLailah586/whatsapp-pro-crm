const Database = require("better-sqlite3");
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

const configPath = path.join(__dirname, "..", "config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const sqlitePath = path.join(__dirname, "..", "data", "crm.db");

const sqlite = new Database(sqlitePath);
const pg = new Pool({
  connectionString: config.postgresUrl,
  ssl: { rejectUnauthorized: false },
});

(async () => {
  try {
    console.log("Connecting to PostgreSQL...");
    await pg.query("SELECT 1");
    console.log("Connected successfully!");

    // 1. Drop existing mismatched tables safely
    console.log("Rebuilding PostgreSQL tables to match WhatsApp Pro schema...");
    await pg.query(`
      DROP TABLE IF EXISTS audit_activity_logs CASCADE;
      DROP TABLE IF EXISTS bot_rules_faqs CASCADE;
      DROP TABLE IF EXISTS bookings_appointments CASCADE;
      DROP TABLE IF EXISTS ai_memory_context CASCADE;
      DROP TABLE IF EXISTS campaign_logs CASCADE;
      DROP TABLE IF EXISTS campaigns CASCADE;
      DROP TABLE IF EXISTS orders_leads CASCADE;
      DROP TABLE IF EXISTS products_catalog CASCADE;
      DROP TABLE IF EXISTS messages CASCADE;
      DROP TABLE IF EXISTS contacts CASCADE;
    `);

    // 2. Create tables exactly matching WhatsApp Pro
    await pg.query(`
      CREATE TABLE contacts (
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

      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        contact_jid TEXT NOT NULL REFERENCES contacts(jid) ON DELETE CASCADE,
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

      CREATE TABLE orders_leads (
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

      CREATE TABLE products_catalog (
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

      CREATE TABLE ai_memory_context (
        id SERIAL PRIMARY KEY,
        contact_jid TEXT NOT NULL,
        memory_type VARCHAR(50) DEFAULT 'preference',
        memory_key TEXT NOT NULL,
        memory_value TEXT NOT NULL,
        confidence_score FLOAT DEFAULT 1.0,
        updated_at BIGINT DEFAULT (EXTRACT(epoch FROM NOW()) * 1000),
        UNIQUE(contact_jid, memory_key)
      );

      CREATE TABLE bookings_appointments (
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

      CREATE TABLE campaigns (
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

      CREATE TABLE campaign_logs (
        id SERIAL PRIMARY KEY,
        campaign_id TEXT,
        phone TEXT,
        status VARCHAR(50),
        error_message TEXT,
        sent_at BIGINT
      );

      CREATE TABLE bot_rules_faqs (
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

      CREATE TABLE audit_activity_logs (
        id SERIAL PRIMARY KEY,
        actor VARCHAR(50) NOT NULL,
        action TEXT NOT NULL,
        contact_jid TEXT,
        details JSONB DEFAULT '{}'::jsonb,
        ip_address VARCHAR(50),
        created_at BIGINT DEFAULT (EXTRACT(epoch FROM NOW()) * 1000)
      );

      CREATE INDEX idx_messages_contact ON messages(contact_jid, timestamp);
      CREATE INDEX idx_contacts_time ON contacts(last_message_time DESC);
      CREATE INDEX idx_ai_memory_jid ON ai_memory_context(contact_jid);
      CREATE INDEX idx_orders_status ON orders_leads(status);
    `);
    console.log("PostgreSQL tables created cleanly.");

    // 3. Sync Contacts
    const contacts = sqlite.prepare("SELECT * FROM contacts").all();
    console.log(`Migrating ${contacts.length} contacts...`);
    for (const c of contacts) {
      await pg.query(
        `INSERT INTO contacts (jid, name, phone, avatar_url, status_bio, is_group, status_tag, lead_score, total_spent, total_orders_count, bot_paused, assigned_agent, city, governorate, address, custom_notes, custom_fields, last_message, last_message_time, unread_count, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18, $19, $20, $21)
         ON CONFLICT (jid) DO NOTHING`,
        [
          c.jid,
          c.name || null,
          c.phone || (c.jid.endsWith("@s.whatsapp.net") ? c.jid.split("@")[0] : c.jid),
          c.avatar_url || null,
          c.status_bio || null,
          Number(c.is_group || 0),
          c.status_tag || "new",
          Number(c.lead_score || 0),
          Number(c.total_spent || 0),
          Number(c.total_orders_count || 0),
          Number(c.bot_paused || 0),
          c.assigned_agent || null,
          c.city || null,
          c.governorate || null,
          c.address || null,
          c.custom_notes || "",
          c.custom_fields && c.custom_fields.startsWith("{") ? c.custom_fields : "{}",
          c.last_message || "",
          Number(c.last_message_time || 0),
          Number(c.unread_count || 0),
          Number(c.created_at || Date.now()),
        ]
      );
    }
    console.log(" Contacts migrated successfully.");

    // 4. Sync Messages
    const msgs = sqlite.prepare("SELECT * FROM messages").all();
    console.log(`Migrating ${msgs.length} messages...`);
    for (const m of msgs) {
      // Ensure contact exists first if foreign key requires it
      const contactExists = await pg.query("SELECT 1 FROM contacts WHERE jid = $1", [m.contact_jid]);
      if (contactExists.rows.length === 0) {
        await pg.query(
          `INSERT INTO contacts (jid, phone, name, status_tag, created_at)
           VALUES ($1, $2, $3, 'new', $4)
           ON CONFLICT (jid) DO NOTHING`,
          [
            m.contact_jid,
            m.contact_jid.split("@")[0].replace(/\D/g, "") || m.contact_jid,
            m.sender_name || m.contact_jid.split("@")[0],
            Date.now()
          ]
        );
      }

      await pg.query(
        `INSERT INTO messages (id, contact_jid, participant_jid, sender_name, text, media_type, media_url, media_meta, from_me, auto_replied, ai_model, ai_tokens_used, sentiment, intent, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (id) DO NOTHING`,
        [
          m.id,
          m.contact_jid,
          m.participant_jid || null,
          m.sender_name || null,
          m.text || "",
          m.media_type || "text",
          m.media_url || null,
          "{}",
          Number(m.from_me || 0),
          Number(m.auto_replied || 0),
          m.ai_model || null,
          Number(m.ai_tokens_used || 0),
          m.sentiment || "neutral",
          m.intent || null,
          Number(m.timestamp || Date.now()),
        ]
      );
    }
    console.log(" Messages migrated successfully.");

    // 5. Sync Orders
    const orders = sqlite.prepare("SELECT * FROM orders_leads").all();
    console.log(`Migrating ${orders.length} orders...`);
    for (const o of orders) {
      await pg.query(
        `INSERT INTO orders_leads (contact_jid, customer_name, phone, order_details, address, total_price, status, google_sheet_synced, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          o.contact_jid || null,
          o.customer_name || null,
          o.phone || null,
          o.order_details || null,
          o.address || null,
          o.total_price || null,
          o.status || "pending",
          Number(o.google_sheet_synced || 0),
          Number(o.created_at || Date.now()),
        ]
      );
    }

    // 6. Sync Campaigns
    const campaigns = sqlite.prepare("SELECT * FROM campaigns").all();
    for (const cp of campaigns) {
      await pg.query(
        `INSERT INTO campaigns (id, title, message_template, target_count, sent_count, failed_count, delay_seconds, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO NOTHING`,
        [
          cp.id,
          cp.title,
          cp.message_template,
          Number(cp.target_count || 0),
          Number(cp.sent_count || 0),
          Number(cp.failed_count || 0),
          Number(cp.delay_seconds || 8),
          cp.status || "completed",
          Number(cp.created_at || Date.now()),
        ]
      );
    }

    // 7. Verification
    const cCount = await pg.query("SELECT COUNT(*) FROM contacts");
    const mCount = await pg.query("SELECT COUNT(*) FROM messages");
    console.log("=========================================");
    console.log("🎉 Migration & Restoration Complete!");
    console.log(`PostgreSQL Contacts: ${cCount.rows[0].count}`);
    console.log(`PostgreSQL Messages: ${mCount.rows[0].count}`);
    console.log("=========================================");
  } catch (err) {
    console.error("Migration error:", err);
  } finally {
    await pg.end();
  }
})();
