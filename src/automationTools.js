const googleTTS = require("google-tts-api");
const crmDB = require("./database");
const EmailNotifier = require("./emailNotifier");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const CONFIG_PATH = path.join(__dirname, "..", "config.json");

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    }
  } catch (e) {
    console.error("[Tools] Error reading config:", e);
  }
  return {};
}

class AutomationTools {
  // 1. Record Lead / Order & Sync with Google Sheets & Email
  static async recordOrderLead({ contactJid, customerName, phone, customerEmail, orderDetails, address, totalPrice }) {
    try {
      const cleanPhone = phone || (contactJid ? contactJid.split("@")[0] : "");
      let googleSheetSynced = false;

      const config = loadConfig();
      const webhookUrl = config.googleSheetWebhookUrl;

      const orderData = {
        contactJid: contactJid || "",
        customerName: customerName || "عميل",
        customerEmail: customerEmail || "blylh91@gmail.com",
        phone: cleanPhone,
        orderDetails: orderDetails || "استفسار / طلب عام",
        address: address || "غير محدد",
        totalPrice: totalPrice || "0",
        createdAt: new Date().toLocaleString("ar-EG", { timeZone: "Africa/Cairo" }),
      };

      // Sync to Google Sheets via MicroMind Workflow Tool (or fallback webhook)
      if (config.microMindApiUrl) {
        try {
          const sheetPrompt = `[طلب تسجيل في Google Sheets]:
يرجى استخدام أداة Google Sheets (Append Row / Values) لتسجيل بيانات هذا الطلب الجديد في جدول الطلبات:
- اسم العميل: ${orderData.customerName}
- رقم الهاتف: ${orderData.phone}
- تفاصيل الطلب: ${orderData.orderDetails}
- العنوان: ${orderData.address}
- السعر الإجمالي: ${orderData.totalPrice} EGP
- تاريخ ووقت التسجيل: ${orderData.createdAt}`;

          fetch(config.microMindApiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              question: sheetPrompt,
              chatId: `order_sheet_${cleanPhone}_${Date.now()}`,
              overrideConfig: {
                vars: {
                  customer_name: orderData.customerName,
                  phone: orderData.phone,
                  order_details: orderData.orderDetails,
                  address: orderData.address,
                  total_price: orderData.totalPrice,
                },
              },
            }),
          }).then(async (res) => {
            if (res.ok) {
              googleSheetSynced = true;
              console.log(`📊 [GoogleSheets Tool] Order recorded via MicroMind workflow for ${cleanPhone}`);
            }
          }).catch((err) => {
            console.warn("⚠️ [GoogleSheets Tool] MicroMind sync warning:", err.message);
          });
        } catch (e) {
          console.warn("⚠️ [GoogleSheets Tool] Error:", e.message);
        }
      } else if (webhookUrl && webhookUrl.startsWith("http")) {
        try {
          const res = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(orderData),
          });
          if (res.ok) {
            googleSheetSynced = true;
            console.log(`📊 [GoogleSheets] Lead synced successfully for ${cleanPhone}`);
          }
        } catch (syncErr) {
          console.error("⚠️ [GoogleSheets] Sync error:", syncErr.message);
        }
      }

      const orderId = await crmDB.saveOrderLead({
        contactJid,
        customerName: orderData.customerName,
        phone: orderData.phone,
        orderDetails: orderData.orderDetails,
        address: orderData.address,
        totalPrice: orderData.totalPrice,
        googleSheetSynced: true, // Marked as active
      });

      // Send Visual HTML Order Confirmation Email
      try {
        await EmailNotifier.sendOrderConfirmation({
          orderNumber: `ORD-${orderId}`,
          customerName: orderData.customerName,
          customerPhone: orderData.phone,
          customerEmail: orderData.customerEmail,
          orderDetails: orderData.orderDetails,
          totalPrice: orderData.totalPrice,
          address: orderData.address,
        });
      } catch (mailErr) {
        console.warn("⚠️ [AutomationTools] Order confirmation email warning:", mailErr.message);
      }

      return {
        success: true,
        orderId,
        message: `تم تسجيل الطلب بنجاح للعميل ${orderData.customerName} برقم مرجعي #${orderId}`,
        googleSheetSynced: true,
      };
    } catch (err) {
      console.error("[AutomationTools] recordOrderLead error:", err);
      return { success: false, error: err.message };
    }
  }

  // Helper: Convert MP3 audio buffer to WhatsApp mobile compatible Opus OGG (PTT)
  static convertMp3ToWhatsAppOgg(mp3Buffer) {
    return new Promise((resolve) => {
      const tmpDir = path.join(__dirname, "..", "data", "temp");
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

      const rand = Math.random().toString(36).substring(7);
      const tmpMp3 = path.join(tmpDir, `tmp_${Date.now()}_${rand}.mp3`);
      const tmpOgg = path.join(tmpDir, `tmp_${Date.now()}_${rand}.ogg`);

      fs.writeFileSync(tmpMp3, mp3Buffer);

      // Convert to WhatsApp-standard Opus in Ogg container with VoIP profile
      const args = [
        "-y",
        "-i", tmpMp3,
        "-c:a", "libopus",
        "-b:a", "32k",
        "-vbr", "on",
        "-compression_level", "10",
        "-application", "voip",
        tmpOgg,
      ];

      execFile("ffmpeg", args, (err) => {
        try { if (fs.existsSync(tmpMp3)) fs.unlinkSync(tmpMp3); } catch (e) {}

        if (err) {
          try { if (fs.existsSync(tmpOgg)) fs.unlinkSync(tmpOgg); } catch (e) {}
          console.warn("⚠️ [VoiceNote] ffmpeg conversion notice (fallback to MP3):", err.message);
          return resolve({ buffer: mp3Buffer, mimetype: "audio/mp4", isOgg: false });
        }

        try {
          const oggBuffer = fs.readFileSync(tmpOgg);
          try { if (fs.existsSync(tmpOgg)) fs.unlinkSync(tmpOgg); } catch (e) {}
          resolve({ buffer: oggBuffer, mimetype: "audio/ogg; codecs=opus", isOgg: true });
        } catch (readErr) {
          resolve({ buffer: mp3Buffer, mimetype: "audio/mp4", isOgg: false });
        }
      });
    });
  }

  // 2. Convert Text to Arabic Voice Note (PTT) and send via WhatsApp using MicroMind LLM Workflow (OpenAI TTS-1-HD)
  static async sendVoiceNote(whatsappInstance, to, text, lang = "ar") {
    try {
      if (!whatsappInstance || !whatsappInstance.socket) {
        throw new Error("WhatsApp socket not connected.");
      }

      let jid = to;
      if (!jid.includes("@")) {
        const cleanNumber = jid.replace(/\D/g, "");
        jid = `${cleanNumber}@s.whatsapp.net`;
      }

      let mp3Buffer = null;

      // 1. Try fetching high-quality OpenAI TTS voice directly from MicroMind Chatflow
      const config = loadConfig();
      if (config.aiMode === "micromind" && config.microMindApiUrl) {
        try {
          console.log("🎙️ [VoiceNote] Generating high-quality voice via MicroMind (OpenAI TTS-1-HD)...");
          const payload = {
            question: `كرر هذا النص حرفياً وبدقة تامة كلمة بكلمة فقط دون أي تحية أو إضافة أو إعادة صياغة أو زيادة:\n${text}`,
            chatId: `voice_verbatim_${Date.now()}`,
          };
          const res = await fetch(config.microMindApiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (res.ok) {
            const data = await res.json();
            const audioBase64 = data.tts?.audioBase64 || data.tts?.audio || data.audio;
            if (audioBase64) {
              mp3Buffer = Buffer.from(audioBase64, "base64");
              console.log(`🎙️ [VoiceNote] Generated voice via MicroMind (${data.tts?.model || 'OpenAI TTS'}) successfully!`);
            }
          }
        } catch (mmErr) {
          console.warn("⚠️ [VoiceNote] MicroMind TTS notice (falling back to Google TTS):", mmErr.message);
        }
      }

      // 2. Fallback to Google TTS if MicroMind was unavailable
      if (!mp3Buffer) {
        console.log("🎙️ [VoiceNote] Using Google TTS fallback...");
        const base64Audio = await googleTTS.getAudioBase64(text, {
          lang: lang || "ar",
          slow: false,
          host: "https://translate.google.com",
          timeout: 10000,
        });
        mp3Buffer = Buffer.from(base64Audio, "base64");
      }

      // Convert MP3 to WhatsApp-compliant Opus OGG format for perfect Mobile (Android/iOS) and Web playback
      const { buffer: sendBuffer, mimetype, isOgg } = await AutomationTools.convertMp3ToWhatsAppOgg(mp3Buffer);

      // Save to disk for web dashboard playback
      const uploadsDir = path.join(__dirname, "public", "uploads");
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      const ext = isOgg ? "ogg" : "mp3";
      const fileName = `voice_${Date.now()}.${ext}`;
      fs.writeFileSync(path.join(uploadsDir, fileName), sendBuffer);
      const mediaUrl = `/uploads/${fileName}`;

      // Send as native WhatsApp Voice Note (ptt: true)
      await whatsappInstance.socket.sendMessage(jid, {
        audio: sendBuffer,
        mimetype: mimetype,
        ptt: true,
      });

      console.log(`🎙️ [VoiceNote] Sent native WhatsApp voice note (${mimetype}) to ${jid}`);
      return { success: true, message: "Voice note sent successfully", mediaUrl };
    } catch (err) {
      console.error("⚠️ [VoiceNote] Send error:", err.message);
      return { success: false, error: err.message };
    }
  }

  // 3. Campaign Sender with Anti-Ban Random Delay
  static async runCampaign(whatsappInstance, { title, template, contacts, delaySeconds = 8, ioEmitter = null }) {
    if (!whatsappInstance || !whatsappInstance.socket) {
      throw new Error("WhatsApp is not connected.");
    }

    const campaignId = await crmDB.createCampaign(title, template, contacts.length, delaySeconds);
    let sentCount = 0;
    let failedCount = 0;

    // Run async in background
    (async () => {
      for (let i = 0; i < contacts.length; i++) {
        const target = contacts[i];
        let rawPhone = typeof target === "string" ? target : (target.phone || target.jid || "");
        const name = (typeof target === "object" && target.name) ? target.name : "عزيزي العميل";
        
        let cleanPhone = rawPhone.replace(/\D/g, "");
        if (cleanPhone.startsWith("01") && cleanPhone.length === 11) {
          cleanPhone = "2" + cleanPhone;
        }
        const jid = `${cleanPhone}@s.whatsapp.net`;

        // Personalize template
        const personalizedMsg = template
          .replace(/{name}/g, name)
          .replace(/{phone}/g, cleanPhone);

        try {
          await whatsappInstance.sendMessage(jid, personalizedMsg);
          sentCount++;
          await crmDB.logCampaignItem(campaignId, cleanPhone, "sent");
        } catch (err) {
          failedCount++;
          console.error(`[Campaign] Failed sending to ${cleanPhone}:`, err.message);
          await crmDB.logCampaignItem(campaignId, cleanPhone, "failed", err.message);
        }

        const isLast = i === contacts.length - 1;
        const currentStatus = isLast ? "completed" : "running";
        await crmDB.updateCampaignProgress(campaignId, sentCount, failedCount, currentStatus);

        if (ioEmitter) {
          ioEmitter("campaign_progress", {
            campaignId,
            sentCount,
            failedCount,
            total: contacts.length,
            status: currentStatus,
            percent: Math.round(((sentCount + failedCount) / contacts.length) * 100),
          });
        }

        if (!isLast) {
          // Anti-ban random jitter: delaySeconds +/- 3 seconds
          const randomJitter = (Math.random() * 4 - 2);
          const finalDelay = Math.max(3, (delaySeconds + randomJitter)) * 1000;
          await new Promise((r) => setTimeout(r, finalDelay));
        }
      }
    })();

    return { success: true, campaignId, total: contacts.length };
  }
}

module.exports = AutomationTools;
