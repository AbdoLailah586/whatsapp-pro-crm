const config = require("../config.json");

(async () => {
  const testPhrases = [
    "أهلاً أهلاً يا عبده",
    "شكراً لتواصلك يا باشا طلبك جاهز وهيوصلك بكرة بإذن الله",
    "سعر المنتج 350 جنيه والشحن مجاني"
  ];

  for (const userText of testPhrases) {
    const prompt = `كرر هذا النص حرفياً وبدقة تامة كلمة بكلمة فقط دون أي تحية أو إضافة أو إعادة صياغة أو زيادة:\n${userText}`;

    const res = await fetch(config.microMindApiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: prompt,
        chatId: `echo_test_${Date.now()}_${Math.random()}`,
      }),
    });

    const data = await res.json();
    console.log("Original:", userText);
    console.log("LLM Output:", data.text.trim());
    console.log("Exact Match:", userText === data.text.trim() || data.text.includes(userText));
    console.log("-----------------------------------------");
  }
})();
