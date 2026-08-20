const AutomationTools = require("./automationTools");

console.log("Checking AutomationTools.convertMp3ToWhatsAppOgg exists:", typeof AutomationTools.convertMp3ToWhatsAppOgg);
(async () => {
  const googleTTS = require("google-tts-api");
  const base64 = await googleTTS.getAudioBase64("تجربة إرسال رسالة صوتية متوافقة مع جميع الهواتف", { lang: "ar" });
  const mp3 = Buffer.from(base64, "base64");
  const res = await AutomationTools.convertMp3ToWhatsAppOgg(mp3);
  console.log("Conversion test result mimetype:", res.mimetype, "isOgg:", res.isOgg, "size:", res.buffer.length);
})();
