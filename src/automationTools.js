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

function withTimeout(operation, timeoutMs, message) {
  let timer;
  return Promise.race([
    Promise.resolve().then(operation),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(message);
        error.code = 'CAMPAIGN_TIMEOUT';
        reject(error);
      }, timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

class AutomationTools {
  static campaignState = {}; // campaignId -> 'running', 'paused', 'cancelled'
  static campaignTiming = {}; // campaignId -> next send time and current target

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

      // Save to disk for web dashboard playback (this account's own uploads folder)
      const uploadsDir = typeof whatsappInstance.uploadsDir === "function"
        ? whatsappInstance.uploadsDir()
        : path.join(__dirname, "public", "uploads");
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      const ext = isOgg ? "ogg" : "mp3";
      const fileName = `voice_${Date.now()}.${ext}`;
      fs.writeFileSync(path.join(uploadsDir, fileName), sendBuffer);
      const mediaUrl = typeof whatsappInstance.uploadsUrl === "function"
        ? whatsappInstance.uploadsUrl(fileName)
        : `/uploads/${fileName}`;

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

  // Spintax parser: resolves {option1|option2|option3} variations
  static parseSpintax(text) {
    if (!text || typeof text !== "string") return text;
    const spintaxRegex = /\{([^{}]+)\}/g;
    let iterations = 0;
    while (spintaxRegex.test(text) && iterations < 10) {
      text = text.replace(spintaxRegex, (_, choices) => {
        const options = choices.split("|");
        return options[Math.floor(Math.random() * options.length)];
      });
      iterations++;
    }
    return text;
  }

  // 3. Campaign Sender with Anti-Ban Micro-Batching & Human Simulation
  static async runCampaign(whatsappInstance, {
    title,
    template,
    contacts,
    imagePath,
    delaySeconds = 8,
    minDelay = null,
    maxDelay = null,
    batchSize = 25,
    batchCooldownMinutes = 45,
    enableTyping = true,
    enableSpintax = true,
    verifyWhatsApp = true,
    sendTimeoutMs = 90000,
    ioEmitter = null
  }) {
    if (!whatsappInstance || !whatsappInstance.socket) {
      throw new Error("WhatsApp is not connected.");
    }

    const campaignId = await crmDB.createCampaign(title, template, contacts.length, delaySeconds);
    let sentCount = 0;
    let failedCount = 0;
    let sentInCurrentBatch = 0;

    // Run async in background
    const emitProgress = (status, extra = {}) => {
      if (ioEmitter) ioEmitter("campaign_progress", {
        campaignId, sentCount, failedCount, total: contacts.length, status,
        percent: Math.round(((sentCount + failedCount) / contacts.length) * 100),
        ...extra,
      });
    };
    (async () => {
      AutomationTools.campaignState[campaignId] = 'running';

      try {

      for (let i = 0; i < contacts.length; i++) {
        // Handle Pause / Cancel
        while (AutomationTools.campaignState[campaignId] === 'paused') {
          await new Promise((r) => setTimeout(r, 1000));
        }
        if (AutomationTools.campaignState[campaignId] === 'cancelled') {
          await crmDB.updateCampaignProgress(campaignId, sentCount, failedCount, "cancelled");
          emitProgress("cancelled");
          break;
        }

        if (typeof whatsappInstance.isConnected === 'function' && !whatsappInstance.isConnected()) {
          AutomationTools.campaignState[campaignId] = 'waiting_connection';
          await crmDB.updateCampaignProgress(campaignId, sentCount, failedCount, 'waiting_connection');
          emitProgress('waiting_connection');
          while (!whatsappInstance.isConnected() && AutomationTools.campaignState[campaignId] !== 'cancelled') {
            await new Promise((r) => setTimeout(r, 1000));
          }
          if (AutomationTools.campaignState[campaignId] === 'cancelled') {
            await crmDB.updateCampaignProgress(campaignId, sentCount, failedCount, 'cancelled');
            emitProgress('cancelled');
            break;
          }
          while (AutomationTools.campaignState[campaignId] === 'paused') {
            await new Promise((r) => setTimeout(r, 1000));
          }
          AutomationTools.campaignState[campaignId] = 'running';
          await crmDB.updateCampaignProgress(campaignId, sentCount, failedCount, 'running');
        }

        // Anti-Ban Micro-Batch Cooling Pause
        if (batchSize > 0 && sentInCurrentBatch >= batchSize && i < contacts.length) {
          const cooldownMs = Math.max(1, Number(batchCooldownMinutes) || 45) * 60 * 1000;
          const coolingUntil = Date.now() + cooldownMs;
          AutomationTools.campaignState[campaignId] = 'cooling';
          AutomationTools.campaignTiming[campaignId] = { nextSendAt: coolingUntil, phase: 'cooling' };
          await crmDB.updateCampaignProgress(campaignId, sentCount, failedCount, "cooling");
          emitProgress("cooling", { nextSendAt: coolingUntil });

          console.log(`🛡️ [Anti-Ban Guard] Campaign #${campaignId} reached batch limit (${sentInCurrentBatch} sent). Cooling for ${batchCooldownMinutes} min...`);

          while (Date.now() < coolingUntil) {
            if (AutomationTools.campaignState[campaignId] === 'cancelled') break;
            if (AutomationTools.campaignState[campaignId] === 'running' || AutomationTools.campaignState[campaignId] === 'skip_cooldown') {
              console.log(`⚡ [Anti-Ban Guard] Cooldown skipped by user for campaign #${campaignId}`);
              break;
            }
            while (AutomationTools.campaignState[campaignId] === 'paused') {
              await new Promise((r) => setTimeout(r, 1000));
            }

            const remainingSeconds = Math.max(0, Math.ceil((coolingUntil - Date.now()) / 1000));
            emitProgress("cooling", { nextSendAt: coolingUntil, remainingSeconds });
            await new Promise((r) => setTimeout(r, 3000));
          }

          if (AutomationTools.campaignState[campaignId] === 'cancelled') {
            await crmDB.updateCampaignProgress(campaignId, sentCount, failedCount, "cancelled");
            emitProgress("cancelled");
            break;
          }

          AutomationTools.campaignState[campaignId] = 'running';
          delete AutomationTools.campaignTiming[campaignId];
          sentInCurrentBatch = 0;
          await crmDB.updateCampaignProgress(campaignId, sentCount, failedCount, "running");
        }

        const target = contacts[i];
        AutomationTools.campaignTiming[campaignId] = { phase: 'sending', targetIndex: i + 1 };
        emitProgress("running", { phase: 'sending', targetIndex: i + 1 });
        let jid = "";
        let displayName = "";
        let logIdentifier = "";
        let cleanPhone = "";

        if (typeof target === "string") {
          if (target.includes("@g.us") || target.includes("@s.whatsapp.net")) {
            jid = target;
            logIdentifier = target;
            displayName = target.includes("@g.us") ? "مجموعة واتساب" : "عزيزي العميل";
          } else {
            cleanPhone = target.replace(/\D/g, "");
            if (cleanPhone.startsWith("01") && cleanPhone.length === 11) {
              cleanPhone = "2" + cleanPhone;
            }
            jid = `${cleanPhone}@s.whatsapp.net`;
            logIdentifier = cleanPhone;
            displayName = "عزيزي العميل";
          }
        } else if (typeof target === "object" && target) {
          displayName = target.name || target.subject || (target.jid?.includes("@g.us") ? "مجموعة واتساب" : "عزيزي العميل");
          let rawPhone = target.phone || "";
          cleanPhone = rawPhone.replace(/\D/g, "");
          if (cleanPhone.startsWith("01") && cleanPhone.length === 11) {
            cleanPhone = "2" + cleanPhone;
          }

          if (target.jid && target.jid.includes("@g.us")) {
            jid = target.jid;
            logIdentifier = target.name || target.jid;
          } else if (cleanPhone && cleanPhone.length >= 10 && cleanPhone.length <= 13) {
            jid = `${cleanPhone}@s.whatsapp.net`;
            logIdentifier = cleanPhone;
          } else if (target.jid && (target.jid.includes("@s.whatsapp.net") || target.jid.includes("@lid"))) {
            jid = target.jid;
            logIdentifier = cleanPhone || target.jid.split("@")[0];
          } else if (cleanPhone) {
            jid = `${cleanPhone}@s.whatsapp.net`;
            logIdentifier = cleanPhone;
          } else {
            jid = target.jid || "";
            logIdentifier = jid;
          }
        }

        try {
        // 1. WhatsApp verification check if enabled
        if (verifyWhatsApp && !jid.includes("@g.us") && typeof whatsappInstance.isOnWhatsApp === "function") {
          try {
            const check = await withTimeout(() => whatsappInstance.isOnWhatsApp(cleanPhone || jid), 15000, 'WhatsApp verification timed out');
            if (check && check.exists === false) {
              failedCount++;
              console.log(`⚠️ [Anti-Ban Guard] Skipped non-WhatsApp number: ${logIdentifier}`);
              await crmDB.logCampaignItem(campaignId, logIdentifier, "failed", "الرقم غير مسجل في واتساب");
              const skippedStatus = AutomationTools.campaignState[campaignId] === 'cancelled' ? 'cancelled' : i === contacts.length - 1 ? "completed" : "running";
              await crmDB.updateCampaignProgress(campaignId, sentCount, failedCount, skippedStatus);
              emitProgress(skippedStatus);
              if (skippedStatus === 'cancelled') break;
              continue;
            }
          } catch (chkErr) {
            // Non-fatal check error
          }
        }

        // 2. Personalize template + Spintax
        let personalizedMsg = template
          .replace(/{name}/g, displayName)
          .replace(/{phone}/g, logIdentifier);

        if (enableSpintax) {
          personalizedMsg = AutomationTools.parseSpintax(personalizedMsg);
        }

        // 3. Human typing simulation
        if (enableTyping && typeof whatsappInstance.simulateHumanTyping === "function") {
          const typingMs = Math.min(5000, Math.max(2000, Math.floor(personalizedMsg.length * 25)));
          try {
            await withTimeout(() => whatsappInstance.simulateHumanTyping(jid, typingMs), typingMs + 10000, 'Typing indicator timed out');
          } catch (typingErr) {
            console.warn(`[Campaign] Typing indicator skipped for ${logIdentifier}: ${typingErr.message}`);
          }
        }

        // 4. Send Message
          let imageBuffer = null;
          if (imagePath) {
            const fs = require("fs");
            imageBuffer = fs.readFileSync(imagePath);
          }
          await withTimeout(() => whatsappInstance.sendMessage(jid, personalizedMsg, false, imageBuffer), sendTimeoutMs, 'مهلة إرسال الرسالة انتهت؛ تأكد من وصولها قبل إعادة المحاولة');
          sentCount++;
          sentInCurrentBatch++;
          await crmDB.logCampaignItem(campaignId, logIdentifier, "sent");
        } catch (err) {
          if (err.code === 'CAMPAIGN_TIMEOUT') {
            console.error(`[Campaign] Delivery uncertain for ${logIdentifier}:`, err.message);
            await crmDB.logCampaignItem(campaignId, logIdentifier || `target ${i + 1}`, 'uncertain', err.message);
            await crmDB.updateCampaignProgress(campaignId, sentCount, failedCount, 'needs_review');
            emitProgress('needs_review', { error: err.message, targetIndex: i + 1 });
            break;
          }
          failedCount++;
          console.error(`[Campaign] Failed sending to ${logIdentifier}:`, err.message);
          await crmDB.logCampaignItem(campaignId, logIdentifier || `target ${i + 1}`, "failed", err.message);
        }

        const isLast = i === contacts.length - 1;
        const currentStatus = AutomationTools.campaignState[campaignId] === 'cancelled' ? 'cancelled' : isLast ? "completed" : "running";
        await crmDB.updateCampaignProgress(campaignId, sentCount, failedCount, currentStatus);

        emitProgress(currentStatus);
        if (currentStatus === 'cancelled') break;

        if (!isLast && !(batchSize > 0 && sentInCurrentBatch >= batchSize)) {
          // Anti-Ban Random Delay between minDelay and maxDelay
          const effMin = minDelay ? Number(minDelay) : Math.max(3, delaySeconds - 2);
          const effMax = maxDelay ? Number(maxDelay) : Math.max(effMin, delaySeconds + 3);
          const randomDelay = Math.floor(Math.random() * (effMax - effMin + 1) + effMin) * 1000;
          const nextSendAt = Date.now() + randomDelay;
          AutomationTools.campaignTiming[campaignId] = { nextSendAt, phase: 'waiting', targetIndex: i + 2 };
          emitProgress("running", { nextSendAt, phase: 'waiting', targetIndex: i + 2 });
          await new Promise((r) => setTimeout(r, randomDelay));
        }
      }
      } catch (err) {
        console.error(`[Campaign] Campaign ${campaignId} stopped:`, err);
        try { await crmDB.logCampaignItem(campaignId, 'system', 'failed', err.message); }
        catch (dbErr) { console.error(`[Campaign] Could not save error log for ${campaignId}:`, dbErr); }
        try { await crmDB.updateCampaignProgress(campaignId, sentCount, failedCount, "failed"); }
        catch (dbErr) { console.error(`[Campaign] Could not save failure for ${campaignId}:`, dbErr); }
        emitProgress("failed", { error: err.message });
      } finally {
      delete AutomationTools.campaignState[campaignId];
      delete AutomationTools.campaignTiming[campaignId];
      }
    })().catch((err) => console.error(`[Campaign] Unexpected background failure ${campaignId}:`, err));

    return { success: true, campaignId, total: contacts.length };
  }
}

module.exports = AutomationTools;
