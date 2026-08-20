const AutomationTools = require("./automationTools");
const fs = require("fs");
const path = require("path");

(async () => {
  console.log("=== Testing MicroMind OpenAI TTS-1-HD generation & conversion ===");
  const text = "أهلاً بك يا فندم في خدمتنا، تم تجهيز طلبك وسيتم إرساله في أقرب وقت";
  
  // Call sendVoiceNote logic (or test the TTS fetch)
  const config = require("../config.json");
  console.log("Calling MicroMind prediction for TTS...");
  const res = await fetch(config.microMindApiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: text, chatId: "test_tts_fetch" }),
  });
  const data = await res.json();
  console.log("Got response from MicroMind, TTS model:", data.tts?.model, "voice:", data.tts?.voice);
  
  const audioBase64 = data.tts?.audioBase64 || data.tts?.audio || data.audio;
  if (!audioBase64) {
    console.error("No audio returned from MicroMind!");
    return;
  }
  
  const mp3Buffer = Buffer.from(audioBase64, "base64");
  console.log("MicroMind MP3 size:", mp3Buffer.length);
  
  const { buffer: oggBuffer, mimetype } = await AutomationTools.convertMp3ToWhatsAppOgg(mp3Buffer);
  console.log("Converted OGG Opus size:", oggBuffer.length, "mimetype:", mimetype);
  
  const testFile = path.join(__dirname, "..", "data", "test_micromind_voice.ogg");
  fs.writeFileSync(testFile, oggBuffer);
  console.log("SUCCESS! Saved Opus file to:", testFile);
})();
