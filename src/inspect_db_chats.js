const crmDB = require("./src/database");

(async () => {
  console.log("Database isPostgres:", crmDB.isPostgres);
  
  // 1. Get recent messages
  let recentMsgs = [];
  if (crmDB.isPostgres) {
    const r = await crmDB.pgPool.query("SELECT * FROM messages ORDER BY timestamp DESC LIMIT 15");
    recentMsgs = r.rows;
  } else {
    recentMsgs = crmDB.sqliteDb.prepare("SELECT * FROM messages ORDER BY timestamp DESC LIMIT 15").all();
  }
  
  console.log("=== Recent 15 Messages in DB ===");
  recentMsgs.forEach(m => {
    console.log(`[${new Date(Number(m.timestamp)).toLocaleTimeString()}] ${m.contact_jid} (${m.from_me ? 'Me' : m.sender_name}): ${m.text}`);
  });
  
  // 2. Get top contacts returned by getContacts
  const contacts = await crmDB.getContacts("", "all");
  console.log("\n=== Total contacts count:", contacts.length);
  console.log("=== Top 10 contacts by last_message_time ===");
  contacts.slice(0, 10).forEach(c => {
    console.log(`[${c.jid}] phone: ${c.phone}, name: ${c.name}, lastMsg: "${c.last_message}", time: ${c.last_message_time} (${new Date(Number(c.last_message_time)).toLocaleString()})`);
  });

  // 3. Check contacts with empty last_message_time or last_message
  const dms = await crmDB.getContacts("", "dms");
  console.log("\n=== Total DMs count:", dms.length);
  console.log("Top 5 DMs:");
  dms.slice(0, 5).forEach(c => {
    console.log(`[${c.jid}] phone: ${c.phone}, name: ${c.name}, lastMsg: "${c.last_message}", time: ${c.last_message_time}`);
  });
  
  process.exit(0);
})();
