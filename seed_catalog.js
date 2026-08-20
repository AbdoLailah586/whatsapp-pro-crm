const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf-8"));
const pool = new Pool({
  connectionString: config.postgresUrl,
  ssl: { rejectUnauthorized: false }
});

const services = [
  {
    sku: "SRV-GEMINI-PRO",
    title: "اشتراك Gemini Pro الذكي",
    description: "اشتراك شهري مدفوع في خدمة Gemini Pro للذكاء الاصطناعي مع وصول كامل لكافة الميزات المتقدمة وتوليد النصوص والأكواد",
    price: 650,
    discount_price: 500,
    stock_quantity: 99,
    category: "اشتراكات ذكاء اصطناعي",
    is_available: true
  },
  {
    sku: "SRV-CHATGPT-PLUS",
    title: "اشتراك ChatGPT Plus",
    description: "اشتراك شهري في ChatGPT Plus مع دعم GPT-4o وتوليد الصور DALL-E والتحليل المتقدم للبيانات",
    price: 950,
    discount_price: 800,
    stock_quantity: 50,
    category: "اشتراكات ذكاء اصطناعي",
    is_available: true
  },
  {
    sku: "SRV-CONSULT-VIP",
    title: "جلسة استشارة VIP وتخطيط استراتيجي",
    description: "جلسة استشارية متخصصة لمدة 45 دقيقة لتطوير الأعمال وحلول الأتمتة والذكاء الاصطناعي",
    price: 1500,
    discount_price: 1200,
    stock_quantity: 50,
    category: "استشارات",
    is_available: true
  },
  {
    sku: "SRV-WHATSAPP-PRO",
    title: "نظام أتمتة الواتساب والـ CRM الذكي",
    description: "نظام متكامل لربط واتساب بالذكاء الاصطناعي وإدارة الطلبات وقواعد البيانات السحابية",
    price: 5000,
    discount_price: 4200,
    stock_quantity: 20,
    category: "برمجيات وأتمتة",
    is_available: true
  },
  {
    sku: "SRV-MARKETING-PKG",
    title: "باقة التسويق الرقمي وإدارة الحملات",
    description: "إدارة وتوجيه الحملات الإعلانية الممولة مع تحليل الأداء والتقارير الأسبوعية",
    price: 3000,
    discount_price: 2500,
    stock_quantity: 30,
    category: "تسويق",
    is_available: true
  }
];

async function seed() {
  console.log("🌱 Seeding services and products into products_catalog...");
  for (const s of services) {
    await pool.query(`
      INSERT INTO products_catalog (sku, title, description, price, discount_price, stock_quantity, category, is_available, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (sku) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        price = EXCLUDED.price,
        discount_price = EXCLUDED.discount_price,
        is_available = EXCLUDED.is_available
    `, [s.sku, s.title, s.description, s.price, s.discount_price, s.stock_quantity, s.category, s.is_available]);
  }

  // Also update contact phone & name if LID exists
  await pool.query(`
    UPDATE contacts 
    SET name = 'عبدالله', phone = '01558909252'
    WHERE jid = '25151865368635@lid' OR jid = '201558909252@s.whatsapp.net'
  `);

  console.log("✅ Products catalog seeded successfully!");
  const res = await pool.query("SELECT id, sku, title, price, discount_price FROM products_catalog");
  console.log("Products in catalog:", res.rows);
  await pool.end();
}

seed().catch(err => {
  console.error("Seed error:", err);
  pool.end();
});
