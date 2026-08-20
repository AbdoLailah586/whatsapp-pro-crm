const http = require("http");

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on("error", reject);
  });
}

(async () => {
  console.log("=== Testing API Endpoints for Filters ===");
  const testCases = [
    "http://localhost:3000/api/contacts?search=&tag=all",
    "http://localhost:3000/api/contacts?search=&tag=dms",
    "http://localhost:3000/api/contacts?search=&tag=groups",
    "http://localhost:3000/api/contacts?search=&tag=new",
    "http://localhost:3000/api/contacts?search=undefined&tag=undefined",
    "http://localhost:3000/api/contacts?search=null&tag=null",
    "http://localhost:3000/api/contacts?search=%D9%81%D8%AF%D9%88%D9%89&tag=all",
    "http://localhost:3000/api/contacts?search=201114763069&tag=all"
  ];

  for (const url of testCases) {
    try {
      const data = await fetchJson(url);
      console.log(`URL: ${url}`);
      console.log(`  -> Success: ${data.success}, Count: ${data.contacts?.length}`);
      if (data.contacts && data.contacts.length > 0) {
        console.log(`  -> First result: ${data.contacts[0].name || data.contacts[0].phone} (${data.contacts[0].jid})`);
      }
    } catch (e) {
      console.error(`Error fetching ${url}:`, e.message);
    }
  }
})();
