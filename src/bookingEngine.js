const crypto = require("crypto");
const crmDB = require("./database");
const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "..", "config.json");

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    }
  } catch (e) {}
  return {};
}

// Default Appointment & Booking Configuration
const DEFAULT_SERVICE_CONFIG = {
  serviceName: "استشارة وتخطيط استراتيجي (1-on-1 Strategy Session)",
  description: "جلسة عمل تفاعلية مباشرة لتحديد المتطلبات، خطة العمل، ومتابعة التنفيذ.",
  durationMinutes: 45,
  bufferMinutes: 15, // 45m meeting + 15m buffer = 60m total slot cycle
  slotIntervalMinutes: 60,
  providerTimezone: "Africa/Cairo",
  workingHours: {
    start: "09:00",
    end: "18:00",
    workingDays: [0, 1, 2, 3, 4] // Sunday (0) to Thursday (4) in Egypt / ME
  },
  advanceNoticeHours: 2,
  maxAdvanceDays: 30
};

class BookingEngine {
  constructor() {
    this.lock = Promise.resolve();
    this.config = { ...DEFAULT_SERVICE_CONFIG };
  }

  // Mutex lock for strict double-booking elimination
  async acquireLock(callback) {
    let release;
    const nextLock = new Promise(resolve => { release = resolve; });
    const currentLock = this.lock;
    this.lock = (async () => {
      try {
        await currentLock;
      } catch (e) {}
    })();

    try {
      await currentLock;
      return await callback();
    } finally {
      release();
    }
  }

  getConfig() {
    return { ...this.config };
  }

  updateConfig(updates) {
    this.config = { ...this.config, ...updates };
    return this.getConfig();
  }

  // Generate Reference Code (e.g. BK-8E92F1)
  generateReferenceCode() {
    return `BK-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  }

  // Check if a time interval conflicts with any confirmed booking in database
  async hasConflict(startTime, slotEndTime, excludeBookingId = null) {
    const startMs = new Date(startTime).getTime();
    const endMs = new Date(slotEndTime).getTime();

    if (isNaN(startMs) || isNaN(endMs) || startMs >= endMs) {
      throw new Error("نطاق الوقت غير صالح");
    }

    const bookings = await this.getAllBookings();
    return bookings.some(b => {
      if (b.status !== "CONFIRMED") return false;
      if (excludeBookingId && b.id === excludeBookingId) return false;

      const bStart = new Date(b.start_time || b.startTime).getTime();
      const bEnd = new Date(b.slot_end_time || b.slotEndTime || b.end_time || b.endTime).getTime();

      // Overlap: new_start < existing_end && new_end > existing_start
      return startMs < bEnd && endMs > bStart;
    });
  }

  // Calculate available slots for a given date (YYYY-MM-DD)
  async getAvailableSlots(dateString) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
      throw new Error("تنسيق التاريخ غير صحيح، المطلوب YYYY-MM-DD");
    }

    const reqDate = new Date(`${dateString}T00:00:00Z`);
    if (isNaN(reqDate.getTime())) {
      throw new Error("تاريخ غير صالح");
    }

    const dayOfWeek = reqDate.getUTCDay();
    if (!this.config.workingHours.workingDays.includes(dayOfWeek)) {
      return {
        date: dateString,
        available: false,
        reason: "عطلة رسمية / خارج أيام العمل",
        slots: []
      };
    }

    const now = new Date();
    const minAdvanceMs = now.getTime() + (this.config.advanceNoticeHours * 60 * 60 * 1000);
    const maxAdvanceMs = now.getTime() + (this.config.maxAdvanceDays * 24 * 60 * 60 * 1000);

    const [startH, startM] = this.config.workingHours.start.split(":").map(Number);
    const [endH, endM] = this.config.workingHours.end.split(":").map(Number);

    const dayStartMs = new Date(`${dateString}T${String(startH).padStart(2, "0")}:${String(startM).padStart(2, "0")}:00Z`).getTime();
    const dayEndMs = new Date(`${dateString}T${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}:00Z`).getTime();

    const intervalMs = this.config.slotIntervalMinutes * 60 * 1000;
    const durationMs = this.config.durationMinutes * 60 * 1000;
    const totalSlotMs = (this.config.durationMinutes + this.config.bufferMinutes) * 60 * 1000;

    const slots = [];
    const allBookings = await this.getAllBookings();

    for (let slotStart = dayStartMs; slotStart + durationMs <= dayEndMs; slotStart += intervalMs) {
      const slotEnd = slotStart + durationMs;
      const slotCycleEnd = slotStart + totalSlotMs;

      // Check lead time
      if (slotStart < minAdvanceMs) continue;
      if (slotStart > maxAdvanceMs) continue;

      // Check overlap
      const isConflict = allBookings.some(b => {
        if (b.status !== "CONFIRMED") return false;
        const bStart = new Date(b.start_time || b.startTime).getTime();
        const bEnd = new Date(b.slot_end_time || b.slotEndTime || b.end_time || b.endTime).getTime();
        return slotStart < bEnd && slotCycleEnd > bStart;
      });

      if (!isConflict) {
        slots.push({
          startTime: new Date(slotStart).toISOString(),
          endTime: new Date(slotEnd).toISOString(),
          slotEndTime: new Date(slotCycleEnd).toISOString(),
          displayTime: new Date(slotStart).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", timeZone: this.config.providerTimezone || "Africa/Cairo" })
        });
      }
    }

    return {
      date: dateString,
      serviceName: this.config.serviceName,
      durationMinutes: this.config.durationMinutes,
      timezone: this.config.providerTimezone,
      available: slots.length > 0,
      slots
    };
  }

  // Create an appointment atomically
  async createBooking(data) {
    return this.acquireLock(async () => {
      const { startTime, customerName, customerEmail, customerPhone, notes, contactJid } = data;

      if (!startTime || !customerName || !customerPhone) {
        throw new Error("البيانات غير مكتملة (الموعد، الاسم، ورقم الهاتف مطلوبين)");
      }

      const start = new Date(startTime);
      if (isNaN(start.getTime())) {
        throw new Error("وقت بداية غير صالح");
      }

      const durationMs = this.config.durationMinutes * 60 * 1000;
      const totalSlotMs = (this.config.durationMinutes + this.config.bufferMinutes) * 60 * 1000;
      const end = new Date(start.getTime() + durationMs);
      const slotEnd = new Date(start.getTime() + totalSlotMs);

      // Check conflict
      const hasConflict = await this.hasConflict(start.toISOString(), slotEnd.toISOString());
      if (hasConflict) {
        const error = new Error("هذا الموعد محجوز بالفعل أو يوجد تعارض في الوقت");
        error.status = 409;
        throw error;
      }

      const referenceCode = this.generateReferenceCode();
      const cancelToken = `sec_${crypto.randomBytes(16).toString("hex")}`;
      const now = Date.now();

      const cleanDigits = customerPhone.replace(/\D/g, "");
      let formattedPhone = cleanDigits;
      if (cleanDigits.startsWith("01") && cleanDigits.length === 11) {
        formattedPhone = "2" + cleanDigits;
      }
      const finalJid = contactJid || (formattedPhone ? `${formattedPhone}@s.whatsapp.net` : "");

      const bookingRecord = {
        referenceCode,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        slotEndTime: slotEnd.toISOString(),
        customerName: customerName.trim(),
        customerEmail: (customerEmail || "").trim(),
        customerPhone: customerPhone.trim(),
        notes: (notes || "").trim(),
        status: "CONFIRMED",
        cancelToken,
        contactJid: finalJid,
        createdAt: now
      };

      // Save to database
      const id = await this.saveBookingToDB(bookingRecord);
      bookingRecord.id = id;

      // Sync to Google Sheets via MicroMind Workflow Tool (or webhook fallback)
      const config = loadConfig();
      if (config.microMindApiUrl) {
        try {
          const dateFormatted = new Date(bookingRecord.startTime).toLocaleString("ar-EG", { timeZone: "Africa/Cairo" });
          const sheetPrompt = `[طلب تسجيل حجز موعد في Google Sheets]:
يرجى استخدام أداة Google Sheets (Append Row / Values) لتسجيل بيانات هذا الحجز الجديد في جدول المواعيد والحجوزات:
- كود التذكرة: ${bookingRecord.referenceCode}
- اسم العميل: ${bookingRecord.customerName}
- رقم الهاتف: ${bookingRecord.customerPhone}
- البريد الإلكتروني: ${bookingRecord.customerEmail || 'غير محدد'}
- تاريخ وتوقيت الموعد: ${dateFormatted}
- ملاحظات: ${bookingRecord.notes || 'لا توجد'}
- الحالة: مؤكد (CONFIRMED)`;

          fetch(config.microMindApiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              question: sheetPrompt,
              chatId: `sheet_booking_${bookingRecord.referenceCode}`,
              overrideConfig: {
                vars: {
                  booking_code: bookingRecord.referenceCode,
                  customer_name: bookingRecord.customerName,
                  phone: bookingRecord.customerPhone,
                  email: bookingRecord.customerEmail,
                  start_time: bookingRecord.startTime,
                },
              },
            }),
          }).then(async (res) => {
            if (res.ok) {
              console.log(`📊 [GoogleSheets Tool] Booking ${bookingRecord.referenceCode} recorded in Google Sheets via MicroMind workflow.`);
            }
          }).catch((err) => {
            console.warn("⚠️ [GoogleSheets Tool] Booking sync warning:", err.message);
          });
        } catch (e) {
          console.warn("⚠️ [GoogleSheets Tool] Booking sync error:", e.message);
        }
      } else if (config.googleSheetWebhookUrl && config.googleSheetWebhookUrl.startsWith("http")) {
        try {
          await fetch(config.googleSheetWebhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "BOOKING",
              referenceCode: bookingRecord.referenceCode,
              customerName: bookingRecord.customerName,
              customerPhone: bookingRecord.customerPhone,
              customerEmail: bookingRecord.customerEmail,
              startTime: bookingRecord.startTime,
              status: "CONFIRMED",
              createdAt: new Date(now).toLocaleString("ar-EG", { timeZone: "Africa/Cairo" })
            })
          });
        } catch (e) {
          console.error("⚠️ [GoogleSheets] Booking sync error:", e.message);
        }
      }

      return bookingRecord;
    });
  }

  // Cancel Booking
  async cancelBooking(referenceCode, cancelToken) {
    return this.acquireLock(async () => {
      const bookings = await this.getAllBookings();
      const booking = bookings.find(b => (b.reference_code || b.referenceCode) === referenceCode);

      if (!booking) {
        throw new Error("الحجز غير موجود");
      }

      if (booking.status === "CANCELLED") {
        return booking;
      }

      if (cancelToken && (booking.cancel_token || booking.cancelToken) !== cancelToken) {
        throw new Error("رمز الإلغاء غير صحيح");
      }

      await this.updateBookingStatusInDB(booking.id, "CANCELLED");
      booking.status = "CANCELLED";
      return booking;
    });
  }

  // Database Access Methods
  async getAllBookings() {
    if (crmDB.isPostgres) {
      try {
        const res = await crmDB.pgPool.query("SELECT * FROM bookings_appointments ORDER BY start_time ASC");
        return res.rows;
      } catch (e) {
        return [];
      }
    }
    try {
      return crmDB.sqliteDb.prepare("SELECT * FROM bookings_appointments ORDER BY start_time ASC").all();
    } catch (e) {
      return [];
    }
  }

  async saveBookingToDB(b) {
    if (crmDB.isPostgres) {
      try {
        const res = await crmDB.pgPool.query(`
          INSERT INTO bookings_appointments (reference_code, start_time, end_time, slot_end_time, customer_name, customer_email, customer_phone, notes, status, cancel_token, contact_jid, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          RETURNING id
        `, [
          b.referenceCode,
          b.startTime,
          b.endTime,
          b.slotEndTime,
          b.customerName,
          b.customerEmail,
          b.customerPhone,
          b.notes,
          b.status,
          b.cancelToken,
          b.contactJid || "",
          b.createdAt
        ]);
        return res.rows[0]?.id;
      } catch (err) {
        console.error("Error saving booking in Postgres:", err.message);
        return 1;
      }
    }

    try {
      const stmt = crmDB.sqliteDb.prepare(`
        INSERT INTO bookings_appointments (reference_code, start_time, end_time, slot_end_time, customer_name, customer_email, customer_phone, notes, status, cancel_token, contact_jid, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const res = stmt.run(
        b.referenceCode,
        b.startTime,
        b.endTime,
        b.slotEndTime,
        b.customerName,
        b.customerEmail,
        b.customerPhone,
        b.notes,
        b.status,
        b.cancelToken,
        b.contactJid || "",
        b.createdAt
      );
      return res.lastInsertRowid;
    } catch (err) {
      console.error("Error saving booking in SQLite:", err.message);
      return 1;
    }
  }

  async updateBookingStatusInDB(id, status) {
    if (crmDB.isPostgres) {
      return crmDB.pgPool.query("UPDATE bookings_appointments SET status = $1 WHERE id = $2", [status, id]);
    }
    return crmDB.sqliteDb.prepare("UPDATE bookings_appointments SET status = ? WHERE id = ?").run(status, id);
  }
}

module.exports = new BookingEngine();
