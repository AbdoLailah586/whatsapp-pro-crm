const fs = require("fs");
const path = require("path");

const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf-8"));
const apiUrl = config.microMindApiUrl;

async function sendTest(title, question) {
  console.log(`\n==================================================`);
  console.log(`🧪 [TEST]: ${title}`);
  console.log(`💬 Question: ${question}`);
  console.log(`--------------------------------------------------`);

  try {
    const start = Date.now();
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: question,
        chatId: "201554826209@s.whatsapp.net",
      }),
    });

    const elapsed = ((Date.now() - start) / 1000).toFixed(2);
    console.log(`⏱️ HTTP Status: ${res.status} (${elapsed}s)`);

    if (res.ok) {
      const data = await res.json();
      console.log(`🤖 AI Response:\n${data.text || JSON.stringify(data, null, 2)}`);
      return { success: true, response: data.text };
    } else {
      const err = await res.text();
      console.error(`❌ Error (${res.status}): ${err}`);
      return { success: false, error: err };
    }
  } catch (err) {
    console.error(`💥 Network/Request Exception:`, err.message);
    return { success: false, error: err.message };
  }
}

async function runAllTests() {
  console.log(`🚀 Starting Full Workflow & Tools Test on: ${apiUrl}`);

  // Test 1: Customer context & PostgreSQL query
  await sendTest(
    "1. Database (PostgreSQL) Customer Context & Identity",
    `[بيانات العميل المتحدث معك]:\n- معرف الواتساب: 201554826209@s.whatsapp.net\n- رقم الهاتف: 201554826209\n- الاسم: عبد الرحمن\n- التصنيف: vip\n- التاريخ الحالي: الخميس 20 أغسطس 2026\n\n[رسالة العميل]:\nالسلام عليكم يا بوت، ابحث في قاعدة بيانات PostgreSQL عن بياناتي وقولي أنا متسجل عندك بإيه وتصنيفي إيه؟`
  );

  // Test 2: Google Calendar Freebusy / Events
  await sendTest(
    "2. Google Calendar Availability & Booking Tool",
    `[بيانات العميل المتحدث معك]:\n- معرف الواتساب: 201554826209@s.whatsapp.net\n- رقم الهاتف: 201554826209\n- الاسم: عبد الرحمن\n- الإيميل: abdolailah586@gmail.com\n- التاريخ الحالي: الخميس 20 أغسطس 2026\n\n[رسالة العميل]:\nعاوز اعرف إيه المواعيد المتاحة بكرة في Google Calendar للاستشارة؟`
  );

  // Test 3: Web search (Tavily)
  await sendTest(
    "3. Tavily Web Search Tool",
    `[رسالة العميل]:\nابحث في الإنترنت عن سعر الذهب عيار 21 اليوم في مصر بالجنيه؟`
  );
}

runAllTests().catch(console.error);
