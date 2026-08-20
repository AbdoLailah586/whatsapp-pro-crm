const config = require("../config.json");

(async () => {
  const userText = "أهلاً أهلاً يا عبده";
  console.log("Original text to speak:", userText);

  // Instruct LLM to output the exact text verbatim
  const prompt = `كرر هذا النص حرفياً وبدقة تامة كلمة بكلمة فقط دون أي تحية أو إضافة أو إعادة صياغة أو زيادة:\n"${userText}"`;

  const res = await fetch(config.microMindApiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: prompt,
      chatId: `echo_test_${Date.now()}`,
    }),
  });

  const data = await res.json();
  console.log("LLM Output Text:", data.text);
  console.log("TTS audio exists:", !!data.tts?.audioBase64);
})();
