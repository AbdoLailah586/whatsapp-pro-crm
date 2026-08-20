const nodemailer = require("nodemailer");
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

function generateVisualHtmlEmail(booking) {
  const referenceCode = booking.referenceCode || booking.reference_code || "BK-000000";
  const customerName = booking.customerName || booking.customer_name || "العميل";
  const customerEmail = booking.customerEmail || booking.customer_email || "";
  const customerPhone = booking.customerPhone || booking.customer_phone || "";
  const startTime = booking.startTime || booking.start_time || new Date().toISOString();
  const notes = booking.notes || "";
  const cancelToken = booking.cancelToken || booking.cancel_token || "";

  const dateFormatted = new Date(startTime).toLocaleDateString("ar-EG", {
    timeZone: "Africa/Cairo",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  });

  const timeFormatted = new Date(startTime).toLocaleTimeString("ar-EG", {
    timeZone: "Africa/Cairo",
    hour: "2-digit",
    minute: "2-digit"
  });

  return `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>تأكيد حجز موعد رسمي</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f172a; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; direction: rtl; text-align: right; color: #f8fafc;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #0f172a; padding: 30px 15px;">
    <tr>
      <td align="center">
        <!-- Main Email Container -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 600px; background-color: #1e293b; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5); border: 1px solid #334155;">
          
          <!-- Header Banner with Premium Gradient -->
          <tr>
            <td style="background: linear-gradient(135deg, #2563eb 0%, #4f46e5 50%, #7c3aed 100%); padding: 40px 30px; text-align: center; color: #ffffff;">
              <div style="background: rgba(255, 255, 255, 0.2); width: 64px; height: 64px; border-radius: 50%; margin: 0 auto 15px; display: inline-block; line-height: 64px; font-size: 32px;">
                🎟️
              </div>
              <h1 style="margin: 0 0 8px 0; font-size: 26px; font-weight: 800; letter-spacing: -0.5px; color: #ffffff;">تم تأكيد حجز موعدك بنجاح!</h1>
              <p style="margin: 0; font-size: 15px; color: #e0e7ff; font-weight: 400;">يسعدنا تأكيد موعدك، تجد أدناه كافة تفاصيل التذكرة والمقابلة</p>
            </td>
          </tr>

          <!-- Ticket Card Box -->
          <tr>
            <td style="padding: 30px 30px 10px 30px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background: #0f172a; border: 2px dashed #3b82f6; border-radius: 12px; padding: 22px; text-align: center;">
                <tr>
                  <td>
                    <div style="font-size: 12px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">كود التذكرة المرجعي (Booking Reference)</div>
                    <div style="font-size: 32px; font-weight: 900; color: #38bdf8; letter-spacing: 3px; font-family: monospace; margin: 4px 0;">${referenceCode}</div>
                    <div style="display: inline-block; background-color: #064e3b; color: #34d399; font-size: 12px; font-weight: 700; padding: 4px 14px; border-radius: 20px; margin-top: 6px;">
                      ● موعد مؤكد ومحجوز (CONFIRMED)
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Booking Details Section -->
          <tr>
            <td style="padding: 20px 30px 30px 30px;">
              <h2 style="font-size: 17px; font-weight: 700; color: #f8fafc; margin: 0 0 15px 0; border-bottom: 2px solid #334155; padding-bottom: 10px;">
                📋 بيانات وتفاصيل الموعد:
              </h2>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #334155; color: #94a3b8; font-size: 14px; font-weight: 600; width: 35%;">
                    👤 اسم العميل:
                  </td>
                  <td style="padding: 12px 0; border-bottom: 1px solid #334155; color: #f8fafc; font-size: 14px; font-weight: 700;">
                    ${customerName}
                  </td>
                </tr>
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #334155; color: #94a3b8; font-size: 14px; font-weight: 600;">
                    📱 رقم الهاتف:
                  </td>
                  <td style="padding: 12px 0; border-bottom: 1px solid #334155; color: #f8fafc; font-size: 14px; font-weight: 700;" dir="ltr">
                    ${customerPhone}
                  </td>
                </tr>
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #334155; color: #94a3b8; font-size: 14px; font-weight: 600;">
                    📅 تاريخ الموعد:
                  </td>
                  <td style="padding: 12px 0; border-bottom: 1px solid #334155; color: #38bdf8; font-size: 15px; font-weight: 700;">
                    ${dateFormatted}
                  </td>
                </tr>
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #334155; color: #94a3b8; font-size: 14px; font-weight: 600;">
                    ⏰ توقيت الموعد:
                  </td>
                  <td style="padding: 12px 0; border-bottom: 1px solid #334155; color: #38bdf8; font-size: 15px; font-weight: 700;">
                    ${timeFormatted} (بتوقيت القاهرة)
                  </td>
                </tr>
                ${notes ? `
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #334155; color: #94a3b8; font-size: 14px; font-weight: 600; vertical-align: top;">
                    📝 ملاحظات:
                  </td>
                  <td style="padding: 12px 0; border-bottom: 1px solid #334155; color: #cbd5e1; font-size: 14px;">
                    ${notes}
                  </td>
                </tr>
                ` : ''}
              </table>

              <!-- Cancellation & Security Notice -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top: 25px; background: #2a1b24; border-radius: 10px; border-right: 4px solid #f43f5e; padding: 14px 18px;">
                <tr>
                  <td>
                    <div style="font-size: 13px; font-weight: 700; color: #fb7185; margin-bottom: 4px;">
                      🔒 رمز الإلغاء والتعديل السري (Cancellation Token):
                    </div>
                    <div style="font-size: 12px; color: #fda4af; line-height: 1.6;">
                      في حال رغبتك بتعديل الموعد أو إلغائه، يرجى تزويدنا بهذا الرمز:
                      <code style="background: #4c0519; padding: 3px 8px; border-radius: 4px; font-family: monospace; font-size: 13px; color: #fecdd3; font-weight: 700;">${cancelToken}</code>
                    </div>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer Section -->
          <tr>
            <td style="background-color: #0f172a; padding: 25px 30px; text-align: center; border-top: 1px solid #334155; color: #64748b; font-size: 13px; line-height: 1.6;">
              <p style="margin: 0 0 6px 0; font-weight: 600; color: #94a3b8;">نظام إدارة الحجوزات والمبيعات الذكي • ReserveFlow & WhatsApp Pro</p>
              <p style="margin: 0; font-size: 12px; color: #64748b;">تم إرسال هذا البريد الإلكتروني تلقائياً لتأكيد حجزك، نرجو عدم الرد المباشر على هذه الرسالة.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

function generateVisualOrderHtmlEmail(order) {
  const orderNumber = order.orderNumber || order.order_number || `ORD-${Date.now().toString().slice(-6)}`;
  const customerName = order.customerName || order.customer_name || "العميل";
  const customerPhone = order.customerPhone || order.phone || "";
  const orderDetails = order.orderDetails || order.order_details || "طلب خدمة";
  const totalPrice = order.totalPrice || order.total_price || "0";
  const address = order.address || "غير محدد";

  return `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>تأكيد تسجيل طلب الخدمة</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f172a; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; direction: rtl; text-align: right; color: #f8fafc;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #0f172a; padding: 30px 15px;">
    <tr>
      <td align="center">
        <!-- Main Email Container -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 600px; background-color: #1e293b; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5); border: 1px solid #334155;">
          
          <!-- Header Banner with Emerald/Indigo Gradient -->
          <tr>
            <td style="background: linear-gradient(135deg, #059669 0%, #0d9488 50%, #2563eb 100%); padding: 40px 30px; text-align: center; color: #ffffff;">
              <div style="background: rgba(255, 255, 255, 0.2); width: 64px; height: 64px; border-radius: 50%; margin: 0 auto 15px; display: inline-block; line-height: 64px; font-size: 32px;">
                🛍️✨
              </div>
              <h1 style="margin: 0 0 8px 0; font-size: 26px; font-weight: 800; letter-spacing: -0.5px; color: #ffffff;">تم تسجيل طلبك بنجاح!</h1>
              <p style="margin: 0; font-size: 15px; color: #ccfbf1; font-weight: 400;">يسعدنا استلام طلبك، تجد أدناه كافة تفاصيل الخدمة وقيمة الطلب</p>
            </td>
          </tr>

          <!-- Order Card Box -->
          <tr>
            <td style="padding: 30px 30px 10px 30px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background: #0f172a; border: 2px dashed #10b981; border-radius: 12px; padding: 22px; text-align: center;">
                <tr>
                  <td>
                    <div style="font-size: 12px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">رقم الطلب المرجعي (Order ID)</div>
                    <div style="font-size: 32px; font-weight: 900; color: #34d399; letter-spacing: 3px; font-family: monospace; margin: 4px 0;">${orderNumber}</div>
                    <div style="display: inline-block; background-color: #064e3b; color: #6ee7b7; font-size: 12px; font-weight: 700; padding: 4px 14px; border-radius: 20px; margin-top: 6px; border: 1px solid #059669;">
                      ● قيد المعالجة والتنفيذ (PROCESSING)
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Order Details Section -->
          <tr>
            <td style="padding: 20px 30px 30px 30px;">
              <h2 style="font-size: 17px; font-weight: 700; color: #f8fafc; margin: 0 0 15px 0; border-bottom: 2px solid #334155; padding-bottom: 10px;">
                📋 تفاصيل الطلب والخدمة:
              </h2>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #334155; color: #94a3b8; font-size: 14px; font-weight: 600; width: 35%;">
                    👤 اسم العميل:
                  </td>
                  <td style="padding: 12px 0; border-bottom: 1px solid #334155; color: #f8fafc; font-size: 14px; font-weight: 700;">
                    ${customerName}
                  </td>
                </tr>
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #334155; color: #94a3b8; font-size: 14px; font-weight: 600;">
                    📱 رقم الهاتف:
                  </td>
                  <td style="padding: 12px 0; border-bottom: 1px solid #334155; color: #f8fafc; font-size: 14px; font-weight: 700;" dir="ltr">
                    ${customerPhone}
                  </td>
                </tr>
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #334155; color: #94a3b8; font-size: 14px; font-weight: 600;">
                    📦 تفاصيل الخدمة:
                  </td>
                  <td style="padding: 12px 0; border-bottom: 1px solid #334155; color: #34d399; font-size: 15px; font-weight: 700;">
                    ${orderDetails}
                  </td>
                </tr>
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #334155; color: #94a3b8; font-size: 14px; font-weight: 600;">
                    💰 القيمة الإجمالية:
                  </td>
                  <td style="padding: 12px 0; border-bottom: 1px solid #334155; color: #38bdf8; font-size: 16px; font-weight: 800;">
                    ${totalPrice} EGP
                  </td>
                </tr>
                ${address && address !== "غير محدد" ? `
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #334155; color: #94a3b8; font-size: 14px; font-weight: 600;">
                    📍 العنوان:
                  </td>
                  <td style="padding: 12px 0; border-bottom: 1px solid #334155; color: #cbd5e1; font-size: 14px;">
                    ${address}
                  </td>
                </tr>
                ` : ''}
              </table>

              <!-- Next Steps Notice -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top: 25px; background: #0c4a6e; border-radius: 10px; border-right: 4px solid #0284c7; padding: 16px 20px;">
                <tr>
                  <td>
                    <div style="font-size: 14px; font-weight: 700; color: #7dd3fc; margin-bottom: 4px;">
                      🚀 الخطوة القادمة:
                    </div>
                    <div style="font-size: 13px; color: #bae6fd; line-height: 1.6;">
                      سيقوم فريقنا بالتواصل معك عبر الواتساب لتأكيد بيانات الدفع وتفعيل الخدمة فوراً! في حال كان لديك أي استفسار، يمكنك الرد على هذه المحادثة مباشرة. 😊
                    </div>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer Section -->
          <tr>
            <td style="background-color: #0f172a; padding: 25px 30px; text-align: center; border-top: 1px solid #334155; color: #64748b; font-size: 13px; line-height: 1.6;">
              <p style="margin: 0 0 6px 0; font-weight: 600; color: #94a3b8;">نظام إدارة المبيعات وخدمة العملاء الذكي • WhatsApp Pro Automation</p>
              <p style="margin: 0; font-size: 12px; color: #64748b;">تم إرسال هذا الإشعار تلقائياً لتأكيد تسجيل طلبك.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

function generateVisualCancellationHtmlEmail(booking) {
  const referenceCode = booking.referenceCode || booking.reference_code || "BK-000000";
  const customerName = booking.customerName || booking.customer_name || "العميل";
  const customerEmail = booking.customerEmail || booking.customer_email || "";
  const customerPhone = booking.customerPhone || booking.customer_phone || "";
  const startTime = booking.startTime || booking.start_time || new Date().toISOString();

  const dateFormatted = new Date(startTime).toLocaleDateString("ar-EG", {
    timeZone: "Africa/Cairo",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  });

  const timeFormatted = new Date(startTime).toLocaleTimeString("ar-EG", {
    timeZone: "Africa/Cairo",
    hour: "2-digit",
    minute: "2-digit"
  });

  return `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>تأكيد إلغاء موعد</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f172a; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; direction: rtl; text-align: right; color: #f8fafc;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #0f172a; padding: 30px 15px;">
    <tr>
      <td align="center">
        <!-- Main Email Container -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 600px; background-color: #1e293b; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5); border: 1px solid #334155;">
          
          <!-- Header Banner with Rose/Red Gradient -->
          <tr>
            <td style="background: linear-gradient(135deg, #e11d48 0%, #be123c 50%, #881337 100%); padding: 40px 30px; text-align: center; color: #ffffff;">
              <div style="background: rgba(255, 255, 255, 0.2); width: 64px; height: 64px; border-radius: 50%; margin: 0 auto 15px; display: inline-block; line-height: 64px; font-size: 32px;">
                🗓️❌
              </div>
              <h1 style="margin: 0 0 8px 0; font-size: 26px; font-weight: 800; letter-spacing: -0.5px; color: #ffffff;">تم إلغاء حجز موعدك بنجاح</h1>
              <p style="margin: 0; font-size: 15px; color: #fecdd3; font-weight: 400;">نؤكد لك أنه تم إلغاء الموعد المسجل بناءً على طلبك</p>
            </td>
          </tr>

          <!-- Ticket Card Box -->
          <tr>
            <td style="padding: 30px 30px 10px 30px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background: #0f172a; border: 2px dashed #f43f5e; border-radius: 12px; padding: 22px; text-align: center;">
                <tr>
                  <td>
                    <div style="font-size: 12px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">كود التذكرة الملغاة (Cancelled Booking)</div>
                    <div style="font-size: 32px; font-weight: 900; color: #fb7185; letter-spacing: 3px; font-family: monospace; margin: 4px 0; text-decoration: line-through;">${referenceCode}</div>
                    <div style="display: inline-block; background-color: #4c0519; color: #fecdd3; font-size: 12px; font-weight: 700; padding: 4px 14px; border-radius: 20px; margin-top: 6px; border: 1px solid #9f1239;">
                      ● تم الإلغاء (CANCELLED)
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Booking Details Section -->
          <tr>
            <td style="padding: 20px 30px 30px 30px;">
              <h2 style="font-size: 17px; font-weight: 700; color: #f8fafc; margin: 0 0 15px 0; border-bottom: 2px solid #334155; padding-bottom: 10px;">
                📋 تفاصيل الموعد الملغي:
              </h2>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #334155; color: #94a3b8; font-size: 14px; font-weight: 600; width: 35%;">
                    👤 اسم العميل:
                  </td>
                  <td style="padding: 12px 0; border-bottom: 1px solid #334155; color: #f8fafc; font-size: 14px; font-weight: 700;">
                    ${customerName}
                  </td>
                </tr>
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #334155; color: #94a3b8; font-size: 14px; font-weight: 600;">
                    📱 رقم الهاتف:
                  </td>
                  <td style="padding: 12px 0; border-bottom: 1px solid #334155; color: #f8fafc; font-size: 14px; font-weight: 700;" dir="ltr">
                    ${customerPhone}
                  </td>
                </tr>
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #334155; color: #94a3b8; font-size: 14px; font-weight: 600;">
                    📅 تاريخ الموعد:
                  </td>
                  <td style="padding: 12px 0; border-bottom: 1px solid #334155; color: #fb7185; font-size: 15px; font-weight: 700;">
                    ${dateFormatted}
                  </td>
                </tr>
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #334155; color: #94a3b8; font-size: 14px; font-weight: 600;">
                    ⏰ توقيت الموعد:
                  </td>
                  <td style="padding: 12px 0; border-bottom: 1px solid #334155; color: #fb7185; font-size: 15px; font-weight: 700;">
                    ${timeFormatted} (بتوقيت القاهرة)
                  </td>
                </tr>
              </table>

              <!-- Friendly Re-booking Notice -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top: 25px; background: #064e3b; border-radius: 10px; border-right: 4px solid #10b981; padding: 16px 20px;">
                <tr>
                  <td>
                    <div style="font-size: 14px; font-weight: 700; color: #6ee7b7; margin-bottom: 4px;">
                      💡 هل ترغب في حجز موعد جديد؟
                    </div>
                    <div style="font-size: 13px; color: #a7f3d0; line-height: 1.6;">
                      نأسف لعدم تمكننا من لقائك في هذا الموعد، ويسعدنا دائماً استقبال حجزك الجديد في أي وقت يناسبك عبر المحادثة أو الداشبورد! 🌸
                    </div>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer Section -->
          <tr>
            <td style="background-color: #0f172a; padding: 25px 30px; text-align: center; border-top: 1px solid #334155; color: #64748b; font-size: 13px; line-height: 1.6;">
              <p style="margin: 0 0 6px 0; font-weight: 600; color: #94a3b8;">نظام إدارة الحجوزات والمبيعات الذكي • ReserveFlow & WhatsApp Pro</p>
              <p style="margin: 0; font-size: 12px; color: #64748b;">تم إرسال هذا الإشعار تلقائياً لتأكيد الإلغاء، نرجو عدم الرد المباشر على هذه الرسالة.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

class EmailNotifier {
  static getTransporter() {
    const config = loadConfig();
    const user = config.emailUser || process.env.EMAIL_USER;
    const pass = config.emailPass || process.env.EMAIL_PASS;
    const host = config.emailHost || process.env.EMAIL_HOST || "smtp.gmail.com";
    const port = Number(config.emailPort || process.env.EMAIL_PORT || 465);

    if (!user || !pass) {
      return null;
    }

    return nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      tls: { rejectUnauthorized: false }
    });
  }

  // Send Booking Confirmation
  static async sendBookingConfirmation(booking) {
    const referenceCode = booking.referenceCode || booking.reference_code;
    const customerName = booking.customerName || booking.customer_name || "العميل";
    const customerEmail = booking.customerEmail || booking.customer_email || "blylh91@gmail.com";
    const customerPhone = booking.customerPhone || booking.customer_phone || "";
    const startTime = booking.startTime || booking.start_time || new Date().toISOString();

    const config = loadConfig();
    const dateFormatted = new Date(startTime).toLocaleDateString("ar-EG", {
      timeZone: "Africa/Cairo",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric"
    });

    const htmlContent = generateVisualHtmlEmail(booking);

    const transporter = this.getTransporter();
    if (transporter) {
      try {
        const senderName = config.emailSenderName || "ReserveFlow & WhatsApp Pro";
        const senderEmail = config.emailUser;
        const info = await transporter.sendMail({
          from: `"${senderName}" <${senderEmail}>`,
          to: customerEmail,
          subject: `🎟️ تأكيد حجز موعدك [${referenceCode}] - ${dateFormatted}`,
          html: htmlContent,
        });
        console.log(`📧 [EmailNotifier] Full Visual HTML Confirmation Email sent directly via SMTP to ${customerEmail}, Message ID: ${info.messageId}`);
        return { success: true, via: "smtp_html", messageId: info.messageId };
      } catch (smtpErr) {
        console.warn("⚠️ [EmailNotifier] SMTP direct send error, falling back to MicroMind workflow:", smtpErr.message);
      }
    }

    return { success: true };
  }

  // Send Order / Service Confirmation
  static async sendOrderConfirmation(order) {
    const orderNumber = order.orderNumber || order.order_number || `ORD-${Date.now().toString().slice(-6)}`;
    const customerName = order.customerName || order.customer_name || "العميل";
    const customerEmail = order.customerEmail || order.customer_email || "blylh91@gmail.com";
    const orderDetails = order.orderDetails || order.order_details || "طلب خدمة";

    const config = loadConfig();
    const htmlContent = generateVisualOrderHtmlEmail(order);

    const transporter = this.getTransporter();
    if (transporter) {
      try {
        const senderName = config.emailSenderName || "ReserveFlow & WhatsApp Pro";
        const senderEmail = config.emailUser;
        const info = await transporter.sendMail({
          from: `"${senderName}" <${senderEmail}>`,
          to: customerEmail,
          subject: `🛍️✨ تأكيد تسجيل طلبك [${orderNumber}] - ${orderDetails}`,
          html: htmlContent,
        });
        console.log(`📧 [EmailNotifier] Full Visual HTML Order Confirmation sent to ${customerEmail}, Message ID: ${info.messageId}`);
        return { success: true, via: "smtp_html", messageId: info.messageId };
      } catch (smtpErr) {
        console.warn("⚠️ [EmailNotifier] SMTP direct order email error:", smtpErr.message);
      }
    }

    return { success: true };
  }

  // Send Booking Cancellation Notification
  static async sendCancellationNotification(booking) {
    const referenceCode = booking.referenceCode || booking.reference_code;
    const customerName = booking.customerName || booking.customer_name || "العميل";
    const customerEmail = booking.customerEmail || booking.customer_email || "blylh91@gmail.com";
    const startTime = booking.startTime || booking.start_time || new Date().toISOString();

    const config = loadConfig();
    const dateFormatted = new Date(startTime).toLocaleDateString("ar-EG", {
      timeZone: "Africa/Cairo",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric"
    });

    const htmlContent = generateVisualCancellationHtmlEmail(booking);

    const transporter = this.getTransporter();
    if (transporter) {
      try {
        const senderName = config.emailSenderName || "ReserveFlow & WhatsApp Pro";
        const senderEmail = config.emailUser;
        const info = await transporter.sendMail({
          from: `"${senderName}" <${senderEmail}>`,
          to: customerEmail,
          subject: `🗓️❌ تأكيد إلغاء موعدك [${referenceCode}] - ${dateFormatted}`,
          html: htmlContent,
        });
        console.log(`📧 [EmailNotifier] Full Visual HTML Cancellation Email sent directly via SMTP to ${customerEmail}, Message ID: ${info.messageId}`);
        return { success: true, via: "smtp_html", messageId: info.messageId };
      } catch (smtpErr) {
        console.warn("⚠️ [EmailNotifier] SMTP direct cancel email error:", smtpErr.message);
      }
    }

    return { success: true };
  }
}

module.exports = EmailNotifier;
