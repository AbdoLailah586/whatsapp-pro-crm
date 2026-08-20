-- =============================================================================
-- 🐘 WhatsApp AI Pro CRM & Enterprise Automation Schema (PostgreSQL / Neon.tech)
-- Version: 2.0.0 (Production Enterprise Edition)
-- =============================================================================

-- Enable UUID extension for unique identifiers
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- 1. ENUMS & DOMAINS
-- =============================================================================

DO $$ BEGIN
    CREATE TYPE contact_status_enum AS ENUM ('new', 'interested', 'negotiating', 'ordered', 'vip', 'support', 'churned', 'archived');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE order_status_enum AS ENUM ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE payment_status_enum AS ENUM ('unpaid', 'partially_paid', 'paid', 'refunded');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE payment_method_enum AS ENUM ('cash_on_delivery', 'instapay', 'vodafone_cash', 'credit_card', 'fawry', 'bank_transfer');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE message_media_enum AS ENUM ('text', 'image', 'audio', 'video', 'document', 'sticker', 'location', 'contact_card');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- =============================================================================
-- 2. TABLE: contacts (ملفات العملاء والـ CRM الشامل)
-- =============================================================================
CREATE TABLE IF NOT EXISTS contacts (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    jid TEXT UNIQUE NOT NULL,                              -- e.g. '201012345678@s.whatsapp.net'
    phone TEXT NOT NULL,                                  -- e.g. '201012345678'
    name TEXT,                                            -- اسم العميل
    avatar_url TEXT,                                      -- صورة البروفايل
    status_tag VARCHAR(50) DEFAULT 'new',                 -- new, interested, ordered, vip, support...
    lead_score INT DEFAULT 0,                             -- تقييم اهتمام العميل (0-100)
    total_spent NUMERIC(12, 2) DEFAULT 0.00,              -- إجمالي مشتريات العميل (LTV)
    total_orders_count INT DEFAULT 0,                     -- إجمالي عدد الطلبات
    bot_paused INT DEFAULT 0,                             -- 1 = التدخل البشري مفعّل (إيقاف البوت لهذا العميل)
    assigned_agent TEXT,                                  -- الموظف أو المدير المسؤول
    city TEXT,                                            -- المدينة
    governorate TEXT,                                     -- المحافظة (القاهرة، الجيزة، الإسكندرية...)
    address TEXT,                                         -- العنوان التفصيلي
    custom_notes TEXT DEFAULT '',                         -- ملاحظات الموظفين الداخلية
    custom_fields JSONB DEFAULT '{}'::jsonb,              -- حقول مخصصة (الشركة، تاريخ الميلاد، التفضيلات)
    last_message TEXT DEFAULT '',                         -- نص آخر رسالة
    last_message_time BIGINT DEFAULT 0,                   -- وقت آخر رسالة (Epoch ms)
    unread_count INT DEFAULT 0,                           -- عدد الرسائل غير المقروءة
    created_at BIGINT DEFAULT (EXTRACT(epoch FROM NOW()) * 1000),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- 3. TABLE: messages (سجل المحادثات والميديا والذكاء الاصطناعي)
-- =============================================================================
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,                                  -- WhatsApp Message ID
    contact_jid TEXT NOT NULL REFERENCES contacts(jid) ON DELETE CASCADE,
    sender_name TEXT,                                     -- اسم الراسل
    text TEXT,                                            -- نص الرسالة أو وصف الميديا
    media_type VARCHAR(50) DEFAULT 'text',                -- text, image, audio, video, document, sticker
    media_url TEXT,                                       -- مسار الميديا أو رابط السحابة
    media_meta JSONB DEFAULT '{}'::jsonb,                 -- بيانات الميديا (الحجم، الامتداد، المدة)
    from_me INT DEFAULT 0,                                -- 1 = مرسلة مننا، 0 = واردة من العميل
    auto_replied INT DEFAULT 0,                           -- 1 = رد ذكاء اصطناعي تلقائي
    ai_model TEXT,                                        -- الموديل المستخدم (مثل openrouter/gemini)
    ai_tokens_used INT DEFAULT 0,                         -- التوكنز المستهلكة
    sentiment VARCHAR(20) DEFAULT 'neutral',              -- تحليل المشاعر (positive, neutral, negative)
    intent VARCHAR(50),                                   -- النية (inquiry, order, complaint, support)
    timestamp BIGINT NOT NULL,                            -- وقت الرسالة (Epoch ms)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- 4. TABLE: products_catalog (كتالوج المنتجات والخدمات والمخزون)
-- =============================================================================
CREATE TABLE IF NOT EXISTS products_catalog (
    id SERIAL PRIMARY KEY,
    sku VARCHAR(100) UNIQUE,                              -- كود المنتج
    title TEXT NOT NULL,                                  -- اسم المنتج أو الخدمة
    description TEXT,                                     -- الوصف
    price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,           -- السعر الأساسي
    discount_price NUMERIC(10, 2),                        -- سعر الخصم (إن وجد)
    stock_quantity INT DEFAULT 100,                       -- الكمية المتاحة بالمخزون
    category VARCHAR(100),                                -- القسم أو التصنيف
    image_url TEXT,                                       -- صورة المنتج
    is_available BOOLEAN DEFAULT true,                    -- متاح للطلب
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- 5. TABLE: orders_leads (سجل الطلبات والصفقات ومتابعة المبيعات)
-- =============================================================================
CREATE TABLE IF NOT EXISTS orders_leads (
    id SERIAL PRIMARY KEY,
    order_number TEXT UNIQUE,                             -- رقم الطلب المرجعي (مثل ORD-2026-001)
    contact_jid TEXT REFERENCES contacts(jid) ON DELETE SET NULL,
    customer_name TEXT NOT NULL,                          -- اسم العميل
    phone TEXT NOT NULL,                                  -- رقم هاتف العميل
    order_details TEXT NOT NULL,                          -- ملخص تفاصيل الطلب
    items JSONB DEFAULT '[]'::jsonb,                      -- عناصر الطلب: [{"title": "...", "qty": 1, "price": 500}]
    total_price TEXT DEFAULT '0',                         -- المبلغ الإجمالي
    currency VARCHAR(10) DEFAULT 'EGP',                   -- العملة (ج.م، ريال، دولار...)
    payment_method VARCHAR(50) DEFAULT 'cash_on_delivery',-- طريقة الدفع
    payment_status VARCHAR(50) DEFAULT 'unpaid',          -- حالة الدفع (unpaid, paid)
    address TEXT,                                         -- عنوان التوصيل
    city TEXT,
    governorate TEXT,
    status VARCHAR(50) DEFAULT 'pending',                 -- pending, confirmed, processing, shipped, delivered, cancelled
    source VARCHAR(50) DEFAULT 'whatsapp_ai',             -- مصدر الطلب (whatsapp_ai, manual_dashboard, campaign)
    google_sheet_synced INT DEFAULT 0,                    -- 1 = تم المزامنة مع Google Sheets
    admin_notes TEXT DEFAULT '',                          -- ملاحظات الإدارة
    created_at BIGINT DEFAULT (EXTRACT(epoch FROM NOW()) * 1000),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- 6. TABLE: ai_memory_context (ذاكرة الذكاء الاصطناعي طويلة المدى للعميل)
-- =============================================================================
CREATE TABLE IF NOT EXISTS ai_memory_context (
    id SERIAL PRIMARY KEY,
    contact_jid TEXT NOT NULL REFERENCES contacts(jid) ON DELETE CASCADE,
    memory_type VARCHAR(50) DEFAULT 'preference',          -- preference, fact, constraint, summary
    memory_key TEXT NOT NULL,                             -- مثل: "budget_range", "preferred_color", "company_name"
    memory_value TEXT NOT NULL,                           -- القيمة المخزنة
    confidence_score FLOAT DEFAULT 1.0,                   -- نسبة الثقة
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(contact_jid, memory_key)
);

-- =============================================================================
-- 7. TABLE: campaigns & campaign_logs (محرك الحملات التسويقية والرسائل الجماعية)
-- =============================================================================
CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,                                  -- Campaign ID
    title TEXT NOT NULL,                                  -- عنوان الحملة
    message_template TEXT NOT NULL,                       -- نص الرسالة المتغير {name} {phone}
    media_url TEXT,                                       -- صورة أو ميديا ترويجية
    audience_filter VARCHAR(50) DEFAULT 'all',            -- الشريحة المستهدفة (all, interested, vip...)
    target_count INT DEFAULT 0,                           -- عدد العملاء المستهدفين
    sent_count INT DEFAULT 0,                             -- تم الإرسال بنجاح
    failed_count INT DEFAULT 0,                           -- فشل الإرسال
    delay_seconds INT DEFAULT 8,                          -- الفاصل الزمني بين الرسائل
    status VARCHAR(50) DEFAULT 'completed',               -- running, completed, paused, cancelled
    created_at BIGINT DEFAULT (EXTRACT(epoch FROM NOW()) * 1000)
);

CREATE TABLE IF NOT EXISTS campaign_logs (
    id SERIAL PRIMARY KEY,
    campaign_id TEXT REFERENCES campaigns(id) ON DELETE CASCADE,
    contact_jid TEXT,
    phone TEXT NOT NULL,
    status VARCHAR(50) NOT NULL,                          -- sent, failed, replied
    error_message TEXT,
    sent_at BIGINT DEFAULT (EXTRACT(epoch FROM NOW()) * 1000)
);

-- =============================================================================
-- 8. TABLE: bot_rules_faqs (القواعد والردود السريعة التلقائية)
-- =============================================================================
CREATE TABLE IF NOT EXISTS bot_rules_faqs (
    id SERIAL PRIMARY KEY,
    category VARCHAR(100) DEFAULT 'general',
    trigger_keywords JSONB DEFAULT '[]'::jsonb,           -- الكلمات المفتاحية: ["الأسعار", "اللوكيشن", "مواعيد العمل"]
    match_type VARCHAR(50) DEFAULT 'contains',            -- contains, exact, regex, semantic
    response_text TEXT NOT NULL,                          -- نص الرد التلقائي
    response_media_url TEXT,                              -- ميديا مرافقة للرد
    action_type VARCHAR(50) DEFAULT 'reply',              -- reply, tag_contact, pause_bot, webhook
    is_active BOOLEAN DEFAULT true,
    hits_count INT DEFAULT 0,                             -- عدد مرات استخدام هذه القاعدة
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- 9. BOOKINGS & APPOINTMENTS (نظام الحجوزات والمواعيد والتذاكر ReserveFlow)
-- =============================================================================
CREATE TABLE IF NOT EXISTS bookings_appointments (
    id SERIAL PRIMARY KEY,
    reference_code VARCHAR(50) UNIQUE NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    slot_end_time TEXT,
    customer_name TEXT NOT NULL,
    customer_email TEXT,
    customer_phone TEXT NOT NULL,
    notes TEXT DEFAULT '',
    status VARCHAR(50) DEFAULT 'CONFIRMED',
    cancel_token TEXT,
    contact_jid TEXT,
    created_at BIGINT
);

-- =============================================================================
-- 10. AUDIT & ACTIVITY LOGS (سجل الأمان والنشاطات)
-- =============================================================================
CREATE TABLE IF NOT EXISTS audit_activity_logs (
    id SERIAL PRIMARY KEY,
    actor VARCHAR(50) NOT NULL,                           -- admin, ai_bot, system, webhook
    action TEXT NOT NULL,                                 -- e.g. "takeover_enabled", "order_status_change"
    contact_jid TEXT,
    details JSONB DEFAULT '{}'::jsonb,
    ip_address VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- 10. HIGH-PERFORMANCE INDEXES (فهارس البحث السريع)
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);
CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status_tag);
CREATE INDEX IF NOT EXISTS idx_contacts_last_msg_time ON contacts(last_message_time DESC);
CREATE INDEX IF NOT EXISTS idx_messages_contact_time ON messages(contact_jid, timestamp ASC);
CREATE INDEX IF NOT EXISTS idx_messages_from_me ON messages(from_me);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders_leads(status);
CREATE INDEX IF NOT EXISTS idx_orders_contact ON orders_leads(contact_jid);
CREATE INDEX IF NOT EXISTS idx_campaign_logs_camp ON campaign_logs(campaign_id);
CREATE INDEX IF NOT EXISTS idx_ai_memory_jid ON ai_memory_context(contact_jid);

-- =============================================================================
-- 11. ANALYTICAL VIEWS (واجهات تقارير وإحصائيات جاهزة)
-- =============================================================================

-- ملخص أداء العملاء
CREATE OR REPLACE VIEW v_customer_summary AS
SELECT 
    c.jid,
    c.name,
    c.phone,
    c.status_tag,
    c.total_spent,
    c.total_orders_count,
    c.last_message_time,
    COUNT(m.id) AS total_messages,
    COUNT(CASE WHEN m.auto_replied = 1 THEN 1 END) AS ai_replies_count
FROM contacts c
LEFT JOIN messages m ON c.jid = m.contact_jid
GROUP BY c.jid, c.name, c.phone, c.status_tag, c.total_spent, c.total_orders_count, c.last_message_time;

-- ملخص الحملات التسويقية ومعدل النجاح
CREATE OR REPLACE VIEW v_campaign_analytics AS
SELECT 
    id,
    title,
    target_count,
    sent_count,
    failed_count,
    CASE 
        WHEN target_count > 0 THEN ROUND((sent_count::numeric / target_count::numeric) * 100, 1)
        ELSE 0 
    END AS delivery_rate_percent,
    status,
    created_at
FROM campaigns;
