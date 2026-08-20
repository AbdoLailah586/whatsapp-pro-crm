const config = require("../config.json");

(async () => {
  console.log("Testing MicroMind API URL:", config.microMindApiUrl);
  try {
    const payload = {
      question: "مرحبا",
      chatId: "test_user_voice",
    };

    const res = await fetch(config.microMindApiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    console.log("Status:", res.status);
    const data = await res.json();
    console.log("Response keys:", Object.keys(data));
    console.log("Response text:", data.text);
    if (data.audio) {
      console.log("Response audio exists! Type:", typeof data.audio, "Length:", data.audio.length, "Prefix:", data.audio.substring(0, 50));
    } else {
      console.log("No 'audio' key in root response.");
    }
    console.log("Full JSON summary:", JSON.stringify(data, (k, v) => (typeof v === "string" && v.length > 200 ? v.substring(0, 100) + "... [TRUNCATED]" : v), 2));
  } catch (e) {
    console.error("Test error:", e.message);
  }
})();
