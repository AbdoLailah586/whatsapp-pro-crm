/* ==========================================================================
   WhatsApp Pro CRM — Front-end
   المعمار:
     STACK  : ألواح بتتراكم أفقيًا بدل تابّات بتمسح بعض
     THREAD : رسائل + طلبات + حجوزات في خيط واحد لكل عميل
     CORE   : لوحة أوامر (Ctrl/Cmd+K) فوق كل حاجة
     PULSE  : حركة مدفوعة بالداتا اللحظية من Socket.io
   الباك-إند ما اتغيّرش — نفس الـ endpoints بالظبط.
   ========================================================================== */
(function () {
  "use strict";

  /* ======================================================================
     0 · الأساسيات
     ====================================================================== */

  var socket = io();
  var RM = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var S = {
    connState: "connecting",
    user: null,
    botEnabled: true,
    contacts: [],
    orders: [],
    bookings: [],
    campaigns: [],
    groups: [],
    presets: [],
    rules: [],
    analytics: null,
    settings: null,
    activeJid: null,
    activeContact: null,
    threadEvents: [],
    threadFilter: "all",
    search: "",
    tagFilter: "all",
    selectedGroups: new Set(),
    activePresetId: null,
    activeCampaignId: null,
    recordsTab: "orders",
    view: "inbox",
    charts: {},
    groupsLoaded: false,
    exportSelectedGroups: new Set(),
    exportLastResult: null,
    uploadedJsonRaw: null,
    uploadedJsonFile: null,
    uploadedJsonNormalized: [],
    uploadedJsonFiltered: [],
    account: null
  };

  var TAGS = {
    new: "جديد", interested: "مهتم", ordered: "طلب شراء",
    vip: "VIP", support: "دعم فني", closed: "مغلق"
  };
  var ORDER_STATUS = {
    pending: "قيد الانتظار", confirmed: "مؤكَّد", shipped: "تم الشحن", cancelled: "ملغي"
  };

  var $ = function (id) { return document.getElementById(id); };
  var stackEl = $("stack");

  /* ---------------------------- Helpers ---------------------------- */

  function fmtFileSize(bytes) {
    if (!bytes) return "0 B";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  }

  function esc(t) {
    if (t === null || t === undefined) return "";
    return String(t)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function attr(t) { return esc(t).replace(/\n/g, " "); }

  function isGroupJid(jid) { return !!jid && jid.indexOf("@g.us") > -1; }

  function cleanPhone(phone, jid) {
    if (phone && phone.indexOf("@") === -1 && phone.length <= 15 && /^\d+$/.test(String(phone).replace(/\D/g, ""))) {
      return String(phone).replace(/\D/g, "");
    }
    if (jid && jid.indexOf("@") > -1 && !isGroupJid(jid) && jid.indexOf("@newsletter") === -1) {
      var raw = jid.split("@")[0].split(":")[0].replace(/\D/g, "");
      if (raw.length >= 8) return raw;
    }
    if (phone) return String(phone).replace(/@.*$/, "").split(":")[0].replace(/\D/g, "");
    return "";
  }

  function fmtPhone(phone, jid) {
    var raw = cleanPhone(phone, jid);
    if (!raw) return "";
    if (raw.indexOf("20") === 0 && raw.length === 12) {
      return "+20 " + raw.substring(2, 4) + " " + raw.substring(4, 8) + " " + raw.substring(8);
    }
    if (raw.indexOf("01") === 0 && raw.length === 11) {
      return raw.substring(0, 3) + " " + raw.substring(3, 7) + " " + raw.substring(7);
    }
    return "+" + raw;
  }

  function displayName(c) {
    if (!c) return "عميل";
    var name = (c.name || "").trim();
    var raw = cleanPhone(c.phone, c.jid);
    var nameDigits = name.replace(/\D/g, "");
    if (!name || name === c.jid || name === c.phone ||
        (nameDigits.length >= 8 && (nameDigits === raw || (raw && raw.indexOf(nameDigits) > -1)))) {
      return fmtPhone(c.phone, c.jid) || (c.jid ? c.jid.split("@")[0] : "عميل");
    }
    return name;
  }

  function initial(c) {
    var n = displayName(c);
    var ch = (n || "ع").trim().charAt(0);
    return /[0-9+]/.test(ch) ? "ع" : ch;
  }

  function fmtTime(ts) {
    if (!ts) return "";
    var d = new Date(Number(ts) || ts);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Africa/Cairo" });
  }

  function fmtDate(ts) {
    if (!ts) return "-";
    var d = new Date(Number(ts) || ts);
    if (isNaN(d.getTime())) return "-";
    return d.toLocaleDateString("ar-EG", { timeZone: "Africa/Cairo", day: "numeric", month: "short", year: "numeric" });
  }

  function fmtDateTime(ts) {
    if (!ts) return "-";
    var d = new Date(Number(ts) || ts);
    if (isNaN(d.getTime())) return "-";
    return d.toLocaleString("ar-EG", { timeZone: "Africa/Cairo", dateStyle: "medium", timeStyle: "short" });
  }

  function relDay(ts) {
    var d = new Date(Number(ts) || ts);
    if (isNaN(d.getTime())) return "";
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var that = new Date(d); that.setHours(0, 0, 0, 0);
    var diff = Math.round((today - that) / 86400000);
    if (diff === 0) return "اليوم";
    if (diff === 1) return "أمس";
    return d.toLocaleDateString("ar-EG", { timeZone: "Africa/Cairo", day: "numeric", month: "long" });
  }

  function listTime(ts) {
    if (!ts) return "";
    var d = new Date(Number(ts) || ts);
    if (isNaN(d.getTime())) return "";
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var that = new Date(d); that.setHours(0, 0, 0, 0);
    return (today - that) < 86400000 ? fmtTime(ts) : relDay(ts);
  }

  function money(v) {
    var n = parseFloat(String(v || 0).replace(/[^\d.]/g, ""));
    if (isNaN(n)) return esc(v || "0");
    return n.toLocaleString("en-US") + " ج.م";
  }

  function api(url, opts) {
    opts = opts || {};
    opts.credentials = "include";
    return fetch(url, opts).then(function (r) {
      if (r.status === 401) {
        showAuthOverlay();
        return Promise.reject(new Error("غير مسجّل الدخول"));
      }
      return r.json();
    });
  }

  /* -------------------------- Toasts (بديل alert) -------------------------- */
  var ICONS = { ok: "fa-circle-check", warn: "fa-triangle-exclamation", danger: "fa-circle-xmark", info: "fa-circle-info" };

  function toast(msg, tone, title) {
    tone = tone || "info";
    var wrap = $("toasts");
    var el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("data-tone", tone);
    el.innerHTML =
      '<i class="fa-solid ' + (ICONS[tone] || ICONS.info) + '"></i>' +
      '<span class="msg">' + (title ? "<b>" + esc(title) + "</b>" : "") + esc(msg) + "</span>" +
      '<button class="x" aria-label="إغلاق"><i class="fa-solid fa-xmark"></i></button>';
    wrap.appendChild(el);
    var kill = function () {
      el.classList.add("out");
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 200);
    };
    el.querySelector(".x").addEventListener("click", kill);
    setTimeout(kill, tone === "danger" ? 7000 : 4200);
  }

  /* حوار تأكيد داخل الصفحة بدل confirm() */
  function confirmAsk(text, okLabel, tone) {
    return new Promise(function (resolve) {
      var settled = false;
      function done(v) { if (settled) return; settled = true; resolve(v); }
      openSheet({
        title: "تأكيد",
        body: '<p style="font-size:13.5px;line-height:1.9">' + esc(text) + "</p>",
        foot: '<button class="btn" data-x="no">إلغاء</button>' +
              '<button class="btn ' + (tone === "danger" ? "btn-danger" : "btn-primary") + '" data-x="yes">' + esc(okLabel || "تأكيد") + "</button>",
        onFoot: function (act) {
          closeSheet(true);          /* صامت: من غير ما يشغّل onClose */
          done(act === "yes");
        },
        onClose: function () { done(false); }
      });
    });
  }

  /* عدّاد بيعدّ مش بيقفز — PULSE */
  function tweenNum(el, to) {
    if (!el) return;
    var from = parseFloat(String(el.textContent).replace(/[^\d.-]/g, "")) || 0;
    to = Number(to) || 0;
    if (RM || from === to) { el.textContent = to.toLocaleString("en-US"); return; }
    var t0 = performance.now(), dur = 620;
    function step(t) {
      var p = Math.min(1, (t - t0) / dur);
      var e = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(from + (to - from) * e).toLocaleString("en-US");
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* انتقال ناعم بين الشاشات — View Transitions لو مدعومة */
  function transition(fn) {
    if (!RM && document.startViewTransition) { document.startViewTransition(fn); }
    else { fn(); }
  }

  /* ======================================================================
     1 · STACK — إدارة الألواح
     ====================================================================== */

  var stack = [];   /* [{ id, role, title, render, crumb }] */

  function pushPanel(panel, level) {
    if (typeof level === "number") stack = stack.slice(0, level);
    stack.push(panel);
    renderStack(true);
  }

  function replaceStack(panels) {
    stack = panels;
    renderStack(false);
  }

  function popTo(level) {
    stack = stack.slice(0, level + 1);
    renderStack(false);
  }

  function renderStack(animateLast) {
    stackEl.innerHTML = "";
    stack.forEach(function (p, i) {
      var el = document.createElement("section");
      el.className = "panel" + (i < stack.length - 1 ? " behind" : "") +
                     (animateLast && i === stack.length - 1 && i > 0 ? " entering" : "");
      el.setAttribute("data-role", p.role || "main");
      el.setAttribute("data-level", i);
      el.innerHTML = p.render();
      stackEl.appendChild(el);
      if (p.mount) p.mount(el);
    });
    stackEl.scrollLeft = document.dir === "rtl" ? -stackEl.scrollWidth : stackEl.scrollWidth;
  }

  function crumbsHtml() {
    if (stack.length < 2) return "";
    return '<div class="crumbs">' + stack.map(function (p, i) {
      return (i ? '<span class="crumb-sep">‹</span>' : "") +
        '<button class="crumb" data-crumb="' + i + '"' + (i === stack.length - 1 ? ' aria-current="true"' : "") + ">" +
        esc(p.crumb || p.title) + "</button>";
    }).join("") + "</div>";
  }

  /* ======================================================================
     2 · LAYERS — الطبقة (Sheet)
     ====================================================================== */

  var sheetState = { onFoot: null, onClose: null };

  function openSheet(cfg) {
    $("sheetTitle").textContent = cfg.title || "تفاصيل";
    $("sheetBody").innerHTML = cfg.body || "";
    var foot = $("sheetFoot");
    if (cfg.foot) { foot.innerHTML = cfg.foot; foot.classList.remove("hidden"); }
    else { foot.innerHTML = ""; foot.classList.add("hidden"); }
    $("sheet").classList.toggle("wide", !!cfg.wide);
    sheetState.onFoot = cfg.onFoot || null;
    sheetState.onClose = cfg.onClose || null;
    $("sheet").classList.add("open");
    $("sheetScrim").classList.add("open");
    if (cfg.mount) cfg.mount($("sheetBody"));
    var first = $("sheetBody").querySelector("input, textarea, select");
    if (first && !RM) setTimeout(function () { first.focus(); }, 260);
  }

  function closeSheet(silent) {
    $("sheet").classList.remove("open");
    $("sheetScrim").classList.remove("open");
    var cb = sheetState.onClose;
    sheetState.onFoot = null; sheetState.onClose = null;
    if (!silent && cb) cb();
  }

  $("sheetClose").addEventListener("click", function () { closeSheet(); });
  $("sheetScrim").addEventListener("click", function () { closeSheet(); });
  $("sheetFoot").addEventListener("click", function (e) {
    var b = e.target.closest("[data-x]");
    if (b && sheetState.onFoot) sheetState.onFoot(b.getAttribute("data-x"), b);
  });

  /* ======================================================================
     3 · اتصال واتساب + الحالة
     ====================================================================== */

  /* الخادم بيبعت { status: "disconnected" | "connecting" | "qr_ready" | "connected", qr, user } */
  function setConnState(state) {
    if (!state) return;
    var st = state.status || state.connection || "connecting";
    S.connState = st;

    var conn = $("conn"), label = $("connLabel"), phone = $("connPhone"), qrBox = $("qrOverlay");

    if (state.user !== undefined && state.user !== null) S.user = state.user;
    if (state.botEnabled !== undefined) $("botToggle").checked = !!state.botEnabled;

    if (st === "connected" || st === "open") {
      conn.setAttribute("data-state", "open");
      conn.removeAttribute("title");
      label.textContent = "متصل";
      if (S.user && S.user.id) {
        phone.textContent = fmtPhone("", String(S.user.id).split(":")[0] + "@s.whatsapp.net");
      }
      qrBox.classList.add("hidden");
      $("logoutBtn").classList.remove("hidden");
      return;
    }

    if (st === "qr_ready") {
      conn.setAttribute("data-state", "connecting");
      conn.removeAttribute("title");
      label.textContent = "امسح الكود";
      phone.textContent = "";
      $("logoutBtn").classList.add("hidden");
      if (state.qr) {
        $("qrImage").src = state.qr;
        $("qrImage").classList.remove("hidden");
        $("qrSpinner").classList.add("hidden");
      }
      qrBox.classList.remove("hidden");
      return;
    }

    if (st === "disconnected" || st === "close") {
      conn.setAttribute("data-state", "close");
      conn.setAttribute("title", "غير متصل - انقر لإعادة الاتصال");
      label.innerHTML = 'غير متصل <i class="fa-solid fa-rotate-right" style="font-size:10px;margin-inline-start:3px;opacity:0.8;"></i>';
      phone.textContent = "";
      S.user = null;
      $("logoutBtn").classList.add("hidden");
      return;
    }

    /* connecting */
    conn.setAttribute("data-state", "connecting");
    conn.removeAttribute("title");
    label.textContent = "جاري الاتصال";
    $("logoutBtn").classList.add("hidden");
  }

  /* شبكة أمان: لو الـ socket فات أول حدث، اسأل الـ REST مرة */
  function pollStatusOnce() {
    api("/api/status").then(setConnState).catch(function () {});
  }

  /* ======================================================================
     4 · INBOX — قائمة المحادثات (لوح 1)
     ====================================================================== */

  function inboxPanel() {
    return {
      id: "inbox",
      role: "list",
      title: "المحادثات",
      crumb: "المحادثات",
      render: function () {
        return '' +
          '<div class="panel-head">' +
            "<h3>المحادثات</h3>" +
            '<div class="actions">' +
              '<button class="icon-btn" data-act="refresh-contacts" title="تحديث"><i class="fa-solid fa-rotate"></i></button>' +
            "</div>" +
          "</div>" +
          '<div class="list-tools">' +
            '<div class="search-wrap">' +
              '<i class="fa-solid fa-magnifying-glass"></i>' +
              '<input type="search" id="contactSearch" placeholder="بحث بالاسم أو الرقم…" value="' + attr(S.search) + '">' +
            "</div>" +
            '<div class="chips" id="tagChips">' +
              chipHtml("all", "الكل") + chipHtml("dms", "خاص") + chipHtml("groups", "مجموعات") +
              chipHtml("new", "جديد") + chipHtml("interested", "مهتم") +
              chipHtml("ordered", "طلب") + chipHtml("vip", "VIP") +
            "</div>" +
          "</div>" +
          '<div class="panel-body" id="contactsList">' + contactsHtml() + "</div>";
      },
      mount: function (el) {
        var input = el.querySelector("#contactSearch");
        if (input) {
          var t = null;
          input.addEventListener("input", function (e) {
            S.search = e.target.value.trim();
            clearTimeout(t);
            t = setTimeout(fetchContacts, 220);
          });
        }
      }
    };
  }

  function chipHtml(key, label) {
    return '<button class="chip" data-filter="' + key + '" aria-pressed="' + (S.tagFilter === key) + '">' + esc(label) + "</button>";
  }

  function contactsHtml() {
    if (!S.contacts || !S.contacts.length) {
      return '<div class="empty"><i class="fa-regular fa-comments"></i>' +
        "<p><strong>مفيش محادثات هنا</strong>لما يوصلك رسالة هتظهر في القايمة دي على طول.</p></div>";
    }
    return S.contacts.map(function (c) {
      var grp = Number(c.is_group) === 1 || isGroupJid(c.jid);
      var name = grp ? (c.name || "مجموعة واتساب") : displayName(c);
      var unread = Number(c.unread_count || 0);
      var snippet = (c.last_message || (grp ? "مجموعة" : "محادثة جديدة")).replace(/[\r\n]+/g, " ");
      var av = c.avatar_url
        ? '<img src="' + attr(c.avatar_url) + '" alt="" onerror="this.remove()">'
        : (grp ? '<i class="fa-solid fa-users"></i>' : esc(initial(c)));
      return '' +
        '<button class="contact" data-jid="' + attr(c.jid) + '" aria-selected="' + (S.activeJid === c.jid) + '">' +
          '<span class="avatar' + (grp ? " group" : "") + '">' + av + "</span>" +
          '<span class="contact-main">' +
            '<span class="contact-row1">' +
              '<span class="contact-name">' + esc(name) + "</span>" +
              '<span class="contact-time">' + esc(listTime(c.last_message_time)) + "</span>" +
            "</span>" +
            '<span class="contact-row2">' +
              '<span class="contact-snippet">' + esc(snippet) + "</span>" +
              (grp
                ? '<span class="tag" data-tag="group">مجموعة</span>'
                : '<span class="tag" data-tag="' + attr(c.status_tag || "new") + '">' + esc(TAGS[c.status_tag] || "جديد") + "</span>") +
              (unread ? '<span class="unread">' + unread + "</span>" : "") +
            "</span>" +
          "</span>" +
        "</button>";
    }).join("");
  }

  function refreshContactsList() {
    var el = $("contactsList");
    if (el) el.innerHTML = contactsHtml();
    var total = S.contacts.reduce(function (a, c) { return a + Number(c.unread_count || 0); }, 0);
    var badge = $("cntUnread");
    if (total > 0) {
      badge.classList.remove("hidden");
      if (badge.textContent !== String(total)) {
        badge.textContent = total;
        badge.classList.remove("bump"); void badge.offsetWidth; badge.classList.add("bump");
      }
    } else { badge.classList.add("hidden"); }
  }

  function fetchContacts() {
    return api("/api/contacts?search=" + encodeURIComponent(S.search) + "&tag=" + encodeURIComponent(S.tagFilter))
      .then(function (d) {
        if (d && d.success) { S.contacts = d.contacts || []; refreshContactsList(); }
      })
      .catch(function () {});
  }

  /* ======================================================================
     5 · THREAD — الخيط الموحّد (لوح 2)
     ====================================================================== */

  var THREAD_FILTERS = [
    ["all", "الكل"], ["msg", "رسائل"], ["ai", "ردود آلية"],
    ["order", "طلبات"], ["booking", "حجوزات"], ["media", "ميديا"]
  ];

  function threadPanel() {
    return {
      id: "thread",
      role: "main",
      title: S.activeContact ? displayName(S.activeContact) : "المحادثة",
      crumb: S.activeContact ? displayName(S.activeContact) : "المحادثة",
      render: function () {
        var c = S.activeContact;
        if (!c) {
          return '<div class="empty"><i class="fa-regular fa-hand-pointer"></i>' +
            "<p><strong>اختار محادثة</strong>كل حاجة عن العميل — رسايله وطلباته وحجوزاته — هتلاقيها في خيط واحد هنا.</p></div>";
        }
        var grp = Number(c.is_group) === 1 || isGroupJid(c.jid);
        var paused = Number(c.bot_paused) === 1;
        var av = c.avatar_url ? '<img src="' + attr(c.avatar_url) + '" alt="" onerror="this.remove()">'
                              : (grp ? '<i class="fa-solid fa-users"></i>' : esc(initial(c)));
        return '' +
          crumbsHtml() +
          '<div class="thread-head">' +
            '<span class="avatar' + (grp ? " group" : "") + '">' + av + "</span>" +
            '<span class="thread-id grow">' +
              '<span class="nm ellipsis" style="display:block">' + esc(grp ? (c.name || "مجموعة واتساب") : displayName(c)) + "</span>" +
              '<span class="ph" dir="ltr" style="display:block">' + esc(grp ? "مجموعة مشتركة" : fmtPhone(c.phone, c.jid)) + "</span>" +
            "</span>" +
            '<span class="thread-actions">' +
              (grp ? "" :
                '<select data-act="set-tag" title="تصنيف العميل" style="width:auto;font-size:11px;padding:4px 8px">' +
                  Object.keys(TAGS).map(function (k) {
                    return '<option value="' + k + '"' + ((c.status_tag || "new") === k ? " selected" : "") + ">" + esc(TAGS[k]) + "</option>";
                  }).join("") +
                "</select>") +
              '<label class="takeover" data-paused="' + (paused ? 1 : 0) + '" title="إيقاف الرد الآلي لهذا العميل فقط">' +
                "<span>" + (paused ? "تدخّل بشري" : "البوت شغّال") + "</span>" +
                '<span class="switch"><input type="checkbox" data-act="takeover"' + (paused ? " checked" : "") + "><i></i></span>" +
              "</label>" +
              '<button class="icon-btn" data-act="profile" title="ملف العميل"><i class="fa-solid fa-address-card"></i></button>' +
            "</span>" +
          "</div>" +
          '<div class="thread-filters chips">' +
            THREAD_FILTERS.map(function (f) {
              return '<button class="chip" data-tfilter="' + f[0] + '" aria-pressed="' + (S.threadFilter === f[0]) + '">' + esc(f[1]) + "</button>";
            }).join("") +
          "</div>" +
          '<div class="thread" id="threadBody">' + threadHtml() + "</div>" +
          composerHtml(grp);
      },
      mount: function (el) {
        var body = el.querySelector("#threadBody");
        if (body) body.scrollTop = body.scrollHeight;
        var ta = el.querySelector("#composerInput");
        if (ta) {
          ta.addEventListener("input", function () {
            ta.style.height = "auto";
            ta.style.height = Math.min(140, ta.scrollHeight) + "px";
          });
          ta.addEventListener("keydown", function (e) {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendText(); }
          });
        }
      }
    };
  }

  function composerHtml(grp) {
    return '' +
      '<div class="composer">' +
        '<div class="composer-tools">' +
          '<select data-act="quick" title="ردود سريعة">' +
            '<option value="">ردّ سريع…</option>' +
            '<option value="أهلاً بحضرتك 🌿 تحت أمرك، إزاي أقدر أساعدك؟">ترحيب</option>' +
            '<option value="تمام، جاري تجهيز طلبك وهنبعتلك التفاصيل حالاً.">تأكيد طلب</option>' +
            '<option value="الأسعار والتفاصيل الكاملة هبعتهالك دلوقتي.">إرسال الأسعار</option>' +
            '<option value="شكرًا لتواصلك معانا 🌿 في انتظارك في أي وقت.">شكر وختام</option>' +
          "</select>" +
          '<span class="faint" style="font-size:11px;margin-inline-start:auto">Enter للإرسال · Shift+Enter لسطر جديد</span>' +
        "</div>" +
        '<div class="composer-main">' +
          '<textarea id="composerInput" rows="1" placeholder="اكتب رسالتك…"></textarea>' +
          '<button class="send" data-act="send-voice" title="إرسال النص كرسالة صوتية"><i class="fa-solid fa-microphone"></i></button>' +
          '<button class="send primary" data-act="send-text" title="إرسال"><i class="fa-solid fa-paper-plane"></i></button>' +
        "</div>" +
      "</div>";
  }

  /* --- بناء الخيط: رسائل + طلبات + حجوزات مرتّبة زمنيًا --- */

  function buildThread(messages, orders, bookings) {
    var out = [];
    (messages || []).forEach(function (m) {
      var isAi = Number(m.auto_replied) === 1;
      var mediaUrl = m.media_url || m.mediaUrl || "";
      out.push({
        kind: "msg",
        sub: isAi ? "ai" : (Number(m.from_me) === 1 ? "out" : "in"),
        media: !!mediaUrl,
        ts: Number(m.timestamp) || 0,
        data: m
      });
    });
    (orders || []).forEach(function (o) {
      out.push({ kind: "order", sub: "order", ts: Number(o.created_at) || 0, data: o });
    });
    (bookings || []).forEach(function (b) {
      var t = b.start_time || b.startTime || b.created_at || b.createdAt;
      out.push({ kind: "booking", sub: "booking", ts: new Date(Number(t) || t).getTime() || 0, data: b });
    });
    out.sort(function (a, b) { return a.ts - b.ts; });
    return out;
  }

  function passFilter(ev) {
    var f = S.threadFilter;
    if (f === "all") return true;
    if (f === "media") return ev.kind === "msg" && ev.media;
    if (f === "msg") return ev.kind === "msg" && ev.sub !== "ai";
    if (f === "ai") return ev.kind === "msg" && ev.sub === "ai";
    return ev.kind === f;
  }

  function threadHtml() {
    var evs = S.threadEvents.filter(passFilter);
    if (!evs.length) {
      return '<div class="empty"><i class="fa-regular fa-comment-dots"></i>' +
        "<p><strong>مفيش حاجة هنا</strong>" +
        (S.threadFilter === "all" ? "ابدأ المحادثة من الصندوق تحت." : "جرّب فلتر تاني — أو «الكل».") + "</p></div>";
    }
    var html = "";
    var lastDay = "";
    var c = S.activeContact;
    var lid = c && c.jid && c.jid.indexOf("@lid") > -1 && c.phone;
    if (lid && S.threadFilter === "all") {
      html += '<div class="sysline">' + esc(c.jid) + " → " + esc(fmtPhone(c.phone, c.jid)) + "</div>";
    }
    evs.forEach(function (ev) {
      var day = relDay(ev.ts);
      if (day && day !== lastDay) {
        html += '<div class="day-sep"><span>' + esc(day) + "</span></div>";
        lastDay = day;
      }
      html += ev.kind === "msg" ? bubbleHtml(ev) : eventHtml(ev);
    });
    return html;
  }

  var MEDIA_PREFIXES = [
    "📷 [صورة / Image]", "🎤 [تسجيل صوتي / Voice Note]",
    "🎥 [فيديو / Video]", "📄 [ملف / Document]", "✨ [ملصق / Sticker]"
  ];

  function mediaHtml(m) {
    var url = m.media_url || m.mediaUrl;
    if (!url) return "";
    var type = m.media_type || m.mediaType || "image";
    if (type === "image") {
      return '<div class="media"><img src="' + attr(url) + '" alt="صورة" data-lightbox="' + attr(url) + '" loading="lazy"></div>';
    }
    if (type === "audio") {
      return '<div class="media"><audio controls preload="metadata" src="' + attr(url) + '"></audio></div>';
    }
    if (type === "video") {
      return '<div class="media"><video controls src="' + attr(url) + '"></video></div>';
    }
    return '<div class="media"><a class="doc-card" href="' + attr(url) + '" target="_blank" rel="noopener" download>' +
      '<i class="fa-solid fa-file-arrow-down"></i><span class="ellipsis">' + esc(m.text || "تحميل الملف") + "</span></a></div>";
  }

  function bubbleHtml(ev) {
    var m = ev.data;
    var text = (m.text || "").trim();
    var hasMedia = !!(m.media_url || m.mediaUrl);
    if (hasMedia) {
      MEDIA_PREFIXES.forEach(function (p) {
        if (text === p) text = "";
        else if (text.indexOf(p) === 0) text = text.slice(p.length).trim();
      });
    }
    var senderName = m.sender_name || m.senderName;
    var grp = S.activeContact && (Number(S.activeContact.is_group) === 1 || isGroupJid(S.activeContact.jid));
    return '' +
      '<div class="bubble" data-dir="' + ev.sub + '">' +
        (grp && ev.sub === "in" && senderName ? '<div class="sender">' + esc(senderName) + "</div>" : "") +
        mediaHtml(m) +
        (text ? '<div class="text">' + esc(text) + "</div>" : "") +
        '<div class="meta">' +
          (ev.sub === "ai" ? '<span class="ai-badge">ردّ آلي</span>' : "") +
          "<span>" + esc(fmtTime(ev.ts)) + "</span>" +
        "</div>" +
      "</div>";
  }

  function eventHtml(ev) {
    var d = ev.data;
    if (ev.kind === "order") {
      var st = d.status || "pending";
      return '' +
        '<div class="event" data-kind="order">' +
          '<span class="event-node"><i class="fa-solid fa-receipt"></i></span>' +
          '<div class="event-card" data-order="' + attr(d.id) + '">' +
            '<div class="hd"><span>طلب #' + esc(d.id) + "</span>" +
              '<span class="tag" data-tone="' + (st === "cancelled" ? "danger" : st === "pending" ? "warn" : "ok") + '">' + esc(ORDER_STATUS[st] || st) + "</span>" +
              '<span class="tm">' + esc(fmtTime(ev.ts)) + "</span></div>" +
            '<div class="bd">' + esc(d.order_details || "بدون تفاصيل") + " · <strong>" + esc(money(d.total_price)) + "</strong></div>" +
          "</div>" +
        "</div>";
    }
    var code = d.reference_code || d.referenceCode;
    var cancelled = d.status === "CANCELLED";
    return '' +
      '<div class="event" data-kind="booking">' +
        '<span class="event-node"><i class="fa-solid fa-calendar-check"></i></span>' +
        '<div class="event-card" data-booking="' + attr(code) + '">' +
          '<div class="hd"><span>حجز ' + esc(code) + "</span>" +
            '<span class="tag" data-tone="' + (cancelled ? "danger" : "info") + '">' + (cancelled ? "ملغي" : "مؤكَّد") + "</span>" +
            '<span class="tm">' + esc(fmtTime(ev.ts)) + "</span></div>" +
          '<div class="bd">' + esc(fmtDateTime(d.start_time || d.startTime)) + (d.notes ? " · " + esc(d.notes) : "") + "</div>" +
        "</div>" +
      "</div>";
  }

  function refreshThread(scroll) {
    var body = $("threadBody");
    if (!body) return;
    body.innerHTML = threadHtml();
    if (scroll !== false) body.scrollTop = body.scrollHeight;
  }

  /* --- فتح عميل --- */

  function openContact(jid, level) {
    var c = null;
    for (var i = 0; i < S.contacts.length; i++) if (S.contacts[i].jid === jid) c = S.contacts[i];
    if (!c) c = { jid: jid, name: jid.split("@")[0], phone: jid.split("@")[0], status_tag: "new" };

    S.activeJid = jid;
    S.activeContact = c;
    S.threadEvents = [];
    S.threadFilter = "all";

    transition(function () {
      pushPanel(threadPanel(), typeof level === "number" ? level : 1);
      refreshContactsList();
    });

    api("/api/contacts/" + encodeURIComponent(jid) + "/read", { method: "POST" }).catch(function () {});
    c.unread_count = 0;
    refreshContactsList();

    Promise.all([
      api("/api/contacts/" + encodeURIComponent(jid) + "/messages").catch(function () { return {}; }),
      api("/api/contacts/" + encodeURIComponent(jid) + "/details").catch(function () { return {}; })
    ]).then(function (r) {
      var msgs = (r[0] && r[0].messages) || [];
      var det = r[1] || {};
      if (det.contact) {
        S.activeContact = Object.assign({}, c, det.contact);
        var idx = S.contacts.findIndex(function (x) { return x.jid === jid; });
        if (idx > -1) S.contacts[idx] = Object.assign({}, S.contacts[idx], det.contact);
      }
      S.activeContact._details = det;
      S.threadEvents = buildThread(msgs, det.orders, det.bookings);
      if (S.activeJid !== jid) return;
      var p = stack[stack.length - 1];
      if (p && p.id === "thread") { replaceStack(stack.slice(0, -1).concat([threadPanel()])); }
      refreshContactsList();
    });
  }

  /* ======================================================================
     6 · ملف العميل (طبقة)
     ====================================================================== */

  function openProfile() {
    var c = S.activeContact;
    if (!c) return;
    var det = c._details || {};
    var grp = Number(c.is_group) === 1 || isGroupJid(c.jid);
    var orders = det.orders || [], bookings = det.bookings || [], media = det.sharedMedia || [];
    var spent = orders.reduce(function (a, o) {
      var n = parseFloat(String(o.total_price || 0).replace(/[^\d.]/g, "")); return a + (isNaN(n) ? 0 : n);
    }, 0);

    var body = '' +
      '<div style="display:flex;align-items:center;gap:14px;margin-bottom:18px">' +
        '<span class="avatar lg' + (grp ? " group" : "") + '">' +
          (c.avatar_url ? '<img src="' + attr(c.avatar_url) + '" alt="">' : (grp ? '<i class="fa-solid fa-users"></i>' : esc(initial(c)))) +
        "</span>" +
        '<div class="grow"><div style="font-size:17px;font-weight:600">' + esc(grp ? (c.name || "مجموعة") : displayName(c)) + "</div>" +
          '<div class="mono muted" dir="ltr" style="font-size:12px">' + esc(grp ? "" : fmtPhone(c.phone, c.jid)) + "</div>" +
          (c.status_tag ? '<span class="tag" data-tag="' + attr(c.status_tag) + '" style="margin-top:6px">' + esc(TAGS[c.status_tag] || c.status_tag) + "</span>" : "") +
        "</div>" +
      "</div>" +
      (grp ? "" :
        '<div class="bento" style="padding:0;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">' +
          '<div class="tile" style="padding:12px"><h4 style="font-size:11px;color:var(--muted)">الطلبات</h4><div class="tile-num" style="font-size:20px">' + orders.length + "</div></div>" +
          '<div class="tile" style="padding:12px"><h4 style="font-size:11px;color:var(--muted)">الإنفاق</h4><div class="tile-num" style="font-size:20px">' + spent.toLocaleString("en-US") + "</div></div>" +
          '<div class="tile" style="padding:12px"><h4 style="font-size:11px;color:var(--muted)">الحجوزات</h4><div class="tile-num" style="font-size:20px">' + bookings.length + "</div></div>" +
        "</div>") +
      '<div class="card"><h4><i class="fa-solid fa-note-sticky"></i> ملاحظات داخلية</h4>' +
        '<textarea id="profNotes" rows="3" placeholder="ملاحظات ما بيشوفهاش العميل…">' + esc(c.custom_notes || "") + "</textarea>" +
        '<button class="btn btn-sm btn-primary" data-act="save-notes" style="margin-top:8px">حفظ الملاحظات</button></div>' +
      (grp ? "" :
        '<div class="card"><h4><i class="fa-solid fa-user-pen"></i> بيانات العميل</h4>' +
          '<div class="field"><label>الاسم</label><input type="text" id="profName" value="' + attr(c.name || "") + '"></div>' +
          '<div class="field"><label>الرقم</label><input type="text" id="profPhone" dir="ltr" value="' + attr(cleanPhone(c.phone, c.jid)) + '"></div>' +
          '<div class="field"><label>العنوان</label><input type="text" id="profAddr" value="' + attr(c.address || "") + '"></div>' +
          '<button class="btn btn-sm btn-primary" data-act="save-profile">حفظ البيانات</button></div>') +
      (media.length ?
        '<div class="card"><h4><i class="fa-solid fa-images"></i> ميديا مشتركة <span class="count">' + media.length + "</span></h4>" +
        '<div class="media-grid">' + media.slice(0, 12).map(function (m) {
          var u = m.media_url || m.mediaUrl;
          return '<a href="#" data-lightbox="' + attr(u) + '"><img src="' + attr(u) + '" alt="" loading="lazy"></a>';
        }).join("") + "</div></div>" : "") +
      (det.groupDetails && det.groupDetails.participants ?
        '<div class="card"><h4><i class="fa-solid fa-users"></i> الأعضاء <span class="count">' + det.groupDetails.participants.length + "</span></h4>" +
        '<div class="check-list">' + det.groupDetails.participants.slice(0, 60).map(function (p) {
          return '<div class="check-row"><span class="avatar sm">' + esc((p.name || "ع").charAt(0)) + "</span>" +
            '<span class="n">' + esc(p.name || fmtPhone("", p.id)) + "</span>" +
            (p.admin ? '<span class="tag" data-tone="info">مشرف</span>' : "") + "</div>";
        }).join("") + "</div></div>" : "");

    openSheet({
      title: "ملف العميل",
      body: body,
      foot: '<button class="btn" data-x="close">إغلاق</button>' +
            (grp ? "" : '<a class="btn btn-primary" target="_blank" rel="noopener" href="https://wa.me/' + attr(cleanPhone(c.phone, c.jid)) + '">فتح في واتساب</a>'),
      onFoot: function (a) { if (a === "close") closeSheet(); }
    });
  }

  /* ======================================================================
     7 · إرسال
     ====================================================================== */

  function sendText() {
    var ta = $("composerInput");
    if (!ta || !S.activeContact) return;
    var text = ta.value.trim();
    if (!text) return;
    ta.value = ""; ta.style.height = "auto";

    var optimistic = { text: text, from_me: 1, auto_replied: 0, timestamp: Date.now() };
    S.threadEvents.push({ kind: "msg", sub: "out", media: false, ts: optimistic.timestamp, data: optimistic });
    refreshThread();

    api("/api/contacts/" + encodeURIComponent(S.activeContact.jid) + "/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text, autoPauseBot: false })
    }).then(function (d) {
      if (!d || !d.success) toast((d && d.error) || "الرسالة ما اتبعتتش", "danger", "فشل الإرسال");
      else fetchContacts();
    }).catch(function (e) { toast(e.message, "danger", "فشل الإرسال"); });
  }

  function sendVoice() {
    var ta = $("composerInput");
    if (!ta || !S.activeContact) return;
    var text = ta.value.trim();
    if (!text) { toast("اكتب النص الأول، وهنحوّله لرسالة صوتية.", "warn"); return; }
    ta.value = ""; ta.style.height = "auto";
    var btn = document.querySelector('[data-act="send-voice"]');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; }
    toast("جاري توليد الرسالة الصوتية…", "info");

    api("/api/contacts/" + encodeURIComponent(S.activeContact.jid) + "/send-voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text })
    }).then(function (d) {
      if (d && d.success) toast("تم إرسال الرسالة الصوتية", "ok");
      else toast((d && d.error) || "فشل توليد الصوت", "danger");
    }).catch(function (e) { toast(e.message, "danger"); })
      .finally(function () {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-microphone"></i>'; }
      });
  }

  /* ======================================================================
     8 · BOARD — اللوحة (Bento)
     ====================================================================== */

  function boardPanel() {
    return {
      id: "board", role: "full", title: "اللوحة", crumb: "اللوحة",
      render: function () {
        var a = S.analytics || {};
        var running = S.campaigns.filter(function (c) { return c.status === "running" || c.status === "paused"; })[0];
        var recentOrders = S.orders.slice(0, 5);
        var upcoming = S.bookings.filter(function (b) {
          return b.status !== "CANCELLED" && new Date(b.start_time || b.startTime).getTime() > Date.now();
        }).slice(0, 5);

        return '' +
          '<div class="panel-head"><h3>اللوحة</h3>' +
            '<span class="sub">نظرة سريعة على كل حاجة شغّالة دلوقتي</span>' +
            '<div class="actions"><button class="btn btn-sm" data-act="refresh-analytics"><i class="fa-solid fa-rotate"></i> تحديث</button></div>' +
          "</div>" +
          '<div class="panel-body">' +
          '<div class="bento">' +

            '<div class="tile tile-hero">' +
              '<div class="tile-head"><h4>الرسائل الكلية</h4></div>' +
              '<div class="tile-num" id="kpiMessages">' + (a.totalMessages || 0) + "</div>" +
              '<div class="tile-delta">كل الرسائل الواردة والصادرة</div>' +
            "</div>" +

            '<div class="tile"><div class="tile-head"><h4>جهات الاتصال</h4></div>' +
              '<div class="tile-num" id="kpiContacts">' + (a.totalContacts || 0) + "</div></div>" +

            '<div class="tile"><div class="tile-head"><h4>ردود آلية</h4></div>' +
              '<div class="tile-num" id="kpiAuto">' + (a.totalAutoReplied || 0) + "</div>" +
              '<div class="tile-delta up">وفّرت ردّ يدوي بنفس العدد</div></div>' +

            '<div class="tile tile-lg"><div class="tile-head"><h4>حركة الرسائل — آخر ١٤ يوم</h4></div>' +
              '<div class="tile-chart"><canvas id="chartActivity"></canvas></div></div>' +

            '<div class="tile tile-lg"><div class="tile-head"><h4>توزيع التصنيفات</h4></div>' +
              '<div class="tile-chart"><canvas id="chartTags"></canvas></div></div>' +

            '<div class="tile tile-lg"><div class="tile-head"><h4>آخر الطلبات</h4>' +
              '<div class="actions"><button class="btn btn-sm" data-act="go-records">الكل</button></div></div>' +
              (recentOrders.length ?
                '<div class="tile-list">' + recentOrders.map(function (o) {
                  return '<div class="li" data-open-chat="' + attr(o.contact_jid || o.phone) + '">' +
                    '<span class="avatar sm">' + esc((o.customer_name || "ع").charAt(0)) + "</span>" +
                    '<span class="ellipsis grow">' + esc(o.customer_name || "عميل") + "</span>" +
                    '<span class="tag" data-tone="' + (o.status === "cancelled" ? "danger" : o.status === "pending" ? "warn" : "ok") + '">' + esc(ORDER_STATUS[o.status] || o.status) + "</span>" +
                    '<span class="val">' + esc(money(o.total_price)) + "</span></div>";
                }).join("") + "</div>"
                : '<p class="faint" style="font-size:12.5px">لسه مفيش طلبات مسجّلة.</p>') +
            "</div>" +

            '<div class="tile tile-lg"><div class="tile-head"><h4>مواعيد جاية</h4>' +
              '<div class="actions"><button class="btn btn-sm" data-act="go-bookings">الكل</button></div></div>' +
              (upcoming.length ?
                '<div class="tile-list">' + upcoming.map(function (b) {
                  return '<div class="li"><span class="avatar sm event"><i class="fa-solid fa-calendar"></i></span>' +
                    '<span class="ellipsis grow">' + esc(b.customer_name || b.customerName || "عميل") + "</span>" +
                    '<span class="val">' + esc(fmtDateTime(b.start_time || b.startTime)) + "</span></div>";
                }).join("") + "</div>"
                : '<p class="faint" style="font-size:12.5px">مفيش مواعيد جاية.</p>') +
            "</div>" +

            (running ?
              '<div class="tile tile-xl"><div class="tile-head"><h4>حملة شغّالة دلوقتي</h4>' +
                '<div class="actions"><button class="btn btn-sm" data-act="go-campaigns">إدارة</button></div></div>' +
                '<div style="font-weight:600;font-size:14px">' + esc(running.title) + "</div>" +
                '<div class="progress" id="boardProgress">' +
                  '<div class="progress-top"><span id="boardProgressText">تم ' + running.sent_count + " من " + running.target_count + "</span>" +
                    '<span class="mono" id="boardProgressPct">' + Math.round((running.sent_count / Math.max(1, running.target_count)) * 100) + "%</span></div>" +
                  '<div class="progress-track"><div class="progress-fill" id="boardProgressBar" style="width:' +
                    Math.round((running.sent_count / Math.max(1, running.target_count)) * 100) + '%"></div></div>' +
                "</div></div>" : "") +

          "</div></div>";
      },
      mount: function () { setTimeout(drawCharts, 40); }
    };
  }

  function chartColors() {
    var cs = getComputedStyle(document.documentElement);
    return {
      accent: cs.getPropertyValue("--accent").trim(),
      ai: cs.getPropertyValue("--ai").trim(),
      warn: cs.getPropertyValue("--warn").trim(),
      info: cs.getPropertyValue("--info").trim(),
      danger: cs.getPropertyValue("--danger").trim(),
      muted: cs.getPropertyValue("--muted").trim(),
      line: cs.getPropertyValue("--line").trim(),
      surface: cs.getPropertyValue("--surface").trim()
    };
  }

  function drawCharts() {
    if (typeof Chart === "undefined" || !S.analytics) return;
    var C = chartColors();
    var a = S.analytics;

    var c1 = $("chartActivity");
    if (c1) {
      if (S.charts.activity) S.charts.activity.destroy();
      var daily = a.dailyVolume || [];
      S.charts.activity = new Chart(c1, {
        type: "line",
        data: {
          labels: daily.map(function (d) { return d.day || d.date || ""; }),
          datasets: [{
            label: "رسائل",
            data: daily.map(function (d) { return d.count || d.total || 0; }),
            borderColor: C.accent,
            backgroundColor: "transparent",
            borderWidth: 2, tension: .34,
            pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: C.accent,
            fill: false
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          animation: RM ? false : { duration: 520 },
          plugins: { legend: { display: false }, tooltip: { rtl: true, backgroundColor: C.surface, titleColor: C.muted, bodyColor: C.muted, borderColor: C.line, borderWidth: 1 } },
          scales: {
            x: { grid: { display: false }, ticks: { color: C.muted, font: { size: 10 }, maxRotation: 0, autoSkipPadding: 18 } },
            y: { beginAtZero: true, grid: { color: C.line }, border: { display: false }, ticks: { color: C.muted, font: { size: 10 }, precision: 0 } }
          }
        }
      });
    }

    var c2 = $("chartTags");
    if (c2) {
      if (S.charts.tags) S.charts.tags.destroy();
      var tags = a.tagsBreakdown || [];
      S.charts.tags = new Chart(c2, {
        type: "doughnut",
        data: {
          labels: tags.map(function (t) { return TAGS[t.status_tag] || t.status_tag || "غير مصنّف"; }),
          datasets: [{
            data: tags.map(function (t) { return t.count || 0; }),
            backgroundColor: [C.info, C.accent, C.warn, C.ai, C.danger, C.muted],
            borderColor: C.surface, borderWidth: 2, hoverOffset: 6
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: "62%",
          animation: RM ? false : { duration: 520 },
          plugins: {
            legend: { position: "bottom", rtl: true, labels: { color: C.muted, font: { size: 11, family: "IBM Plex Sans Arabic" }, boxWidth: 10, boxHeight: 10, padding: 12, usePointStyle: true } },
            tooltip: { rtl: true, backgroundColor: C.surface, titleColor: C.muted, bodyColor: C.muted, borderColor: C.line, borderWidth: 1 }
          }
        }
      });
    }
  }

  function fetchAnalytics() {
    return api("/api/analytics").then(function (d) {
      if (d && d.success) {
        S.analytics = d.analytics;
        var a = d.analytics;
        tweenNum($("kpiMessages"), a.totalMessages || 0);
        tweenNum($("kpiContacts"), a.totalContacts || 0);
        tweenNum($("kpiAuto"), a.totalAutoReplied || 0);
        if ($("chartActivity")) drawCharts();
      }
    }).catch(function () {});
  }

  /* ======================================================================
     9 · RECORDS — الطلبات والحجوزات
     ====================================================================== */

  function recordsPanel() {
    return {
      id: "records", role: "full", title: "السجلات", crumb: "السجلات",
      render: function () {
        return '' +
          '<div class="panel-head">' +
            '<div class="seg" id="recSeg">' +
              '<button data-rec="orders" aria-pressed="' + (S.recordsTab === "orders") + '">الطلبات</button>' +
              '<button data-rec="bookings" aria-pressed="' + (S.recordsTab === "bookings") + '">الحجوزات</button>' +
            "</div>" +
            '<div class="actions">' +
              (S.recordsTab === "orders"
                ? '<button class="btn btn-sm btn-primary" data-act="new-order"><i class="fa-solid fa-plus"></i> طلب جديد</button>'
                : '<button class="btn btn-sm btn-primary" data-act="new-booking"><i class="fa-solid fa-plus"></i> حجز جديد</button>') +
            "</div>" +
          "</div>" +
          '<div class="panel-body pad" id="recordsBody">' +
            (S.recordsTab === "orders" ? ordersTable() : bookingsTable()) +
          "</div>";
      }
    };
  }

  function ordersTable() {
    if (!S.orders.length) {
      return '<div class="empty"><i class="fa-solid fa-receipt"></i><p><strong>مفيش طلبات لسه</strong>' +
        "أول ما عميل يطلب حاجة، المساعد الذكي هيسجّل الطلب هنا لوحده.</p></div>";
    }
    return '<div class="table-wrap"><table class="data"><thead><tr>' +
      "<th>رقم</th><th>العميل</th><th>الرقم</th><th>التفاصيل</th><th>العنوان</th><th>الإجمالي</th><th>الحالة</th><th>Sheets</th><th>التاريخ</th><th></th>" +
      "</tr></thead><tbody>" +
      S.orders.map(function (o) {
        return "<tr>" +
          '<td class="num">#' + esc(o.id) + "</td>" +
          "<td><strong>" + esc(o.customer_name || "عميل") + "</strong></td>" +
          '<td class="num" dir="ltr"><a href="https://wa.me/' + attr(o.phone) + '" target="_blank" rel="noopener">' + esc(o.phone) + "</a></td>" +
          "<td>" + esc(o.order_details || "-") + "</td>" +
          "<td>" + esc(o.address || "غير محدد") + "</td>" +
          '<td class="num">' + esc(money(o.total_price)) + "</td>" +
          '<td><select data-order-status="' + attr(o.id) + '">' +
            Object.keys(ORDER_STATUS).map(function (k) {
              return '<option value="' + k + '"' + ((o.status || "pending") === k ? " selected" : "") + ">" + esc(ORDER_STATUS[k]) + "</option>";
            }).join("") + "</select></td>" +
          "<td>" + (Number(o.google_sheet_synced) === 1
            ? '<span class="tag" data-tone="ok">متزامن</span>'
            : '<span class="tag" data-tone="warn">محلي</span>') + "</td>" +
          '<td class="faint" style="font-size:11px">' + esc(fmtDate(o.created_at)) + "</td>" +
          '<td><button class="icon-btn" data-open-chat="' + attr(o.contact_jid || o.phone) + '" title="فتح المحادثة"><i class="fa-solid fa-comment-dots"></i></button></td>' +
        "</tr>";
      }).join("") + "</tbody></table></div>";
  }

  function bookingsTable() {
    if (!S.bookings.length) {
      return '<div class="empty"><i class="fa-solid fa-calendar-xmark"></i><p><strong>مفيش حجوزات لسه</strong>' +
        "أول ما عميل يحجز موعد، هيظهر هنا بكود تذكرة وإيميل تأكيد.</p></div>";
    }
    return '<div class="table-wrap"><table class="data"><thead><tr>' +
      "<th>الكود</th><th>العميل</th><th>الرقم</th><th>الإيميل</th><th>الموعد</th><th>الحالة</th><th>ملاحظات</th><th>أُنشئ</th><th></th>" +
      "</tr></thead><tbody>" +
      S.bookings.map(function (b) {
        var code = b.reference_code || b.referenceCode;
        var cancelled = b.status === "CANCELLED";
        var phone = b.customer_phone || b.customerPhone || "";
        return '<tr class="' + (cancelled ? "cancelled" : "") + '">' +
          '<td class="num"><strong>' + esc(code) + "</strong></td>" +
          "<td><strong>" + esc(b.customer_name || b.customerName || "عميل") + "</strong></td>" +
          '<td class="num" dir="ltr"><a href="https://wa.me/' + attr(phone) + '" target="_blank" rel="noopener">' + esc(phone) + "</a></td>" +
          '<td style="font-size:11.5px">' + esc(b.customer_email || b.customerEmail || "-") + "</td>" +
          "<td>" + esc(fmtDateTime(b.start_time || b.startTime)) + "</td>" +
          '<td><span class="tag" data-tone="' + (cancelled ? "danger" : "ok") + '">' + (cancelled ? "ملغي" : "مؤكَّد") + "</span></td>" +
          '<td style="font-size:11.5px">' + esc(b.notes || "-") + "</td>" +
          '<td class="faint" style="font-size:11px">' + esc(fmtDate(b.created_at || b.createdAt)) + "</td>" +
          "<td>" + (cancelled ? '<span class="faint" style="font-size:11px">-</span>' :
            '<button class="icon-btn danger" data-cancel-booking="' + attr(code) + '" data-token="' + attr(b.cancel_token || b.cancelToken || "") + '" title="إلغاء"><i class="fa-solid fa-ban"></i></button>') + "</td>" +
        "</tr>";
      }).join("") + "</tbody></table></div>";
  }

  function fetchOrders() {
    return api("/api/orders").then(function (d) {
      if (d && d.success) {
        S.orders = d.orders || [];
        updateRecordsBadge();
        if (S.view === "records" && S.recordsTab === "orders") refreshRecords();
      }
    }).catch(function () {});
  }

  function fetchBookings() {
    return api("/api/admin/bookings").then(function (d) {
      if (d && d.success) {
        S.bookings = d.bookings || [];
        updateRecordsBadge();
        if (S.view === "records" && S.recordsTab === "bookings") refreshRecords();
      }
    }).catch(function () {});
  }

  function updateRecordsBadge() {
    var pending = S.orders.filter(function (o) { return (o.status || "pending") === "pending"; }).length;
    var b = $("cntRecords");
    if (pending > 0) {
      b.classList.remove("hidden");
      if (b.textContent !== String(pending)) {
        b.textContent = pending;
        b.classList.remove("bump"); void b.offsetWidth; b.classList.add("bump");
      }
    } else b.classList.add("hidden");
  }

  function refreshRecords() {
    var body = $("recordsBody");
    if (body) body.innerHTML = S.recordsTab === "orders" ? ordersTable() : bookingsTable();
  }

  /* --- نماذج الطلب والحجز --- */

  function newOrderSheet() {
    openSheet({
      title: "تسجيل طلب جديد",
      body:
        '<div class="field"><label>اسم العميل *</label><input type="text" id="oName" placeholder="مثال: منى عبد الرحمن"></div>' +
        '<div class="field"><label>رقم الواتساب *</label><input type="text" id="oPhone" dir="ltr" placeholder="201012345678"></div>' +
        '<div class="field"><label>تفاصيل الطلب</label><textarea id="oDetails" rows="3" placeholder="المنتجات أو الخدمة المطلوبة…"></textarea></div>' +
        '<div class="field"><label>العنوان</label><input type="text" id="oAddr" placeholder="المدينة والمنطقة"></div>' +
        '<div class="field"><label>الإجمالي</label><input type="text" id="oPrice" placeholder="1450"></div>',
      foot: '<button class="btn" data-x="no">إلغاء</button><button class="btn btn-primary" data-x="yes">تسجيل الطلب</button>',
      onFoot: function (a) {
        if (a !== "yes") return closeSheet();
        var name = $("oName").value.trim(), phone = $("oPhone").value.trim();
        if (!name || !phone) return toast("الاسم والرقم مطلوبين.", "warn");
        api("/api/orders", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerName: name, phone: phone,
            orderDetails: $("oDetails").value.trim(),
            address: $("oAddr").value.trim(),
            totalPrice: $("oPrice").value.trim()
          })
        }).then(function (d) {
          if (d && d.success !== false) { closeSheet(true); toast("الطلب اتسجّل", "ok"); fetchOrders(); }
          else toast((d && d.error) || "فشل التسجيل", "danger");
        }).catch(function (e) { toast(e.message, "danger"); });
      }
    });
  }

  function newBookingSheet() {
    var t = new Date(); t.setDate(t.getDate() + 1);
    var def = t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
    openSheet({
      title: "حجز موعد جديد",
      body:
        '<div class="field"><label>اسم العميل *</label><input type="text" id="bName"></div>' +
        '<div class="field"><label>رقم الواتساب *</label><input type="text" id="bPhone" dir="ltr" placeholder="201012345678"></div>' +
        '<div class="field"><label>الإيميل (لإرسال التأكيد)</label><input type="email" id="bEmail" dir="ltr"></div>' +
        '<div class="field"><label>اليوم</label><input type="date" id="bDate" value="' + def + '"></div>' +
        '<div class="field"><label>الموعد المتاح *</label><select id="bSlot"><option value="">جاري الفحص…</option></select></div>' +
        '<div class="field"><label>ملاحظات</label><textarea id="bNotes" rows="2"></textarea></div>',
      foot: '<button class="btn" data-x="no">إلغاء</button><button class="btn btn-primary" data-x="yes">تأكيد الحجز</button>',
      mount: function () {
        loadSlots(def);
        $("bDate").addEventListener("change", function (e) { loadSlots(e.target.value); });
      },
      onFoot: function (a) {
        if (a !== "yes") return closeSheet();
        var name = $("bName").value.trim(), phone = $("bPhone").value.trim(), slot = $("bSlot").value;
        if (!name || !phone || !slot) return toast("الاسم والرقم والموعد مطلوبين.", "warn");
        api("/api/bookings", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerName: name, customerPhone: phone,
            customerEmail: $("bEmail").value.trim(),
            startTime: slot, notes: $("bNotes").value.trim()
          })
        }).then(function (d) {
          if (d && d.success) {
            closeSheet(true);
            toast("كود التذكرة: " + (d.booking && d.booking.referenceCode), "ok", "تم الحجز");
            fetchBookings();
          } else toast((d && d.error) || "فيه تعارض في الموعد", "danger", "فشل الحجز");
        }).catch(function (e) { toast(e.message, "danger"); });
      }
    });
  }

  function loadSlots(date) {
    var sel = $("bSlot");
    if (!sel) return;
    sel.innerHTML = '<option value="">جاري الفحص…</option>';
    api("/api/availability?date=" + encodeURIComponent(date)).then(function (d) {
      if (d && d.available && d.slots && d.slots.length) {
        sel.innerHTML = d.slots.map(function (s) {
          return '<option value="' + attr(s.startTime) + '">' + esc(s.displayTime) + " (" + esc(d.durationMinutes) + " دقيقة)</option>";
        }).join("");
      } else {
        sel.innerHTML = '<option value="">' + esc((d && d.reason) || "مفيش مواعيد متاحة اليوم ده") + "</option>";
      }
    }).catch(function () { sel.innerHTML = '<option value="">فشل جلب المواعيد</option>'; });
  }

  /* ======================================================================
     10 · CAMPAIGNS
     ====================================================================== */

  function campaignsPanel() {
    return {
      id: "campaigns", role: "full", title: "الحملات", crumb: "الحملات",
      render: function () {
        return '' +
          '<div class="panel-head"><h3>الحملات</h3><span class="sub">إرسال جماعي بفواصل زمنية آمنة</span></div>' +
          '<div class="panel-body pad">' +
            '<div class="bento" style="padding:0">' +
              '<div class="tile tile-lg">' +
                '<div class="tile-head"><h4>حملة جديدة</h4></div>' +
                '<div class="field"><label>عنوان الحملة</label><input type="text" id="cTitle" placeholder="عرض نهاية الأسبوع"></div>' +
                '<div class="field"><label>الجمهور</label><select id="cAudience">' +
                  '<option value="all">كل جهات الاتصال</option>' +
                  '<option value="new">تصنيف: جديد</option>' +
                  '<option value="interested">تصنيف: مهتم</option>' +
                  '<option value="ordered">تصنيف: طلب شراء</option>' +
                  '<option value="vip">تصنيف: VIP</option>' +
                  '<option value="groups">مجموعات واتساب</option>' +
                  '<option value="custom">أرقام يدوية</option>' +
                  '<option value="json-file">📁 رفع ملف JSON (مستخرج من المجموعات)</option>' +
                  '<optgroup label="قوائم محفوظة" id="cPresets"></optgroup>' +
                "</select></div>" +
                '<div class="field hidden" id="cGroupsBox">' +
                  '<label>اختيار المجموعات <span class="mono faint" id="cGroupsCount"></span></label>' +
                  '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">' +
                    '<button class="btn btn-sm" data-g="all">تحديد الكل</button>' +
                    '<button class="btn btn-sm" data-g="none">إلغاء الكل</button>' +
                    '<button class="btn btn-sm" data-g="invert">عكس</button>' +
                    '<button class="btn btn-sm" data-g="refresh"><i class="fa-solid fa-rotate"></i></button>' +
                  "</div>" +
                  '<input type="search" id="cGroupSearch" placeholder="بحث باسم المجموعة…" style="margin-bottom:6px">' +
                  '<div class="check-list" id="cGroupsList"></div>' +
                  '<div style="display:flex;gap:6px;margin-top:8px">' +
                    '<input type="text" id="cPresetName" placeholder="احفظ التحديد كقائمة باسم…">' +
                    '<button class="btn btn-sm" data-g="save">حفظ</button>' +
                  "</div>" +
                  '<div id="cPresetDel" class="hidden" style="margin-top:6px">' +
                    '<button class="btn btn-sm btn-danger" data-g="delete">حذف القائمة الحالية</button></div>' +
                "</div>" +
                '<div class="field hidden" id="cCustomBox"><label>الأرقام (كل رقم في سطر)</label>' +
                  '<textarea id="cNumbers" rows="4" dir="ltr" placeholder="201012345678"></textarea></div>' +
                '<div class="field hidden" id="cJsonBox">' +
                  '<label>ملف JSON لجهات الاتصال المستخرجة</label>' +
                  '<div class="json-dropzone" id="cJsonDropzone">' +
                    '<input type="file" id="cJsonFileInput" accept=".json,application/json" style="display:none">' +
                    '<div class="json-dropzone-inner" id="cJsonDropzonePrompt">' +
                      '<i class="fa-solid fa-file-arrow-up" style="font-size:24px;color:var(--accent);margin-bottom:6px"></i>' +
                      '<div style="font-weight:600;font-size:13px">اضغط لاختيار ملف JSON أو اسحبه هنا</div>' +
                      '<div class="faint" style="font-size:11px;margin-top:2px">يدعم ملفات استخراج المجموعات مثل export_groups_...json</div>' +
                    '</div>' +
                    '<div class="json-dropzone-loaded hidden" id="cJsonLoadedView">' +
                      '<div style="display:flex;align-items:center;gap:10px;justify-content:space-between">' +
                        '<div style="display:flex;align-items:center;gap:8px;min-width:0">' +
                          '<i class="fa-solid fa-file-lines" style="color:var(--accent);font-size:20px;flex:none"></i>' +
                          '<div style="min-width:0;text-align:start">' +
                            '<span id="cJsonFileName" style="font-weight:600;font-size:13px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></span>' +
                            '<span id="cJsonFileSize" class="faint" style="font-size:11px"></span>' +
                          '</div>' +
                        '</div>' +
                        '<button type="button" class="btn btn-sm" id="cJsonChangeBtn" style="flex:none"><i class="fa-solid fa-arrow-rotate-left"></i> تغيير</button>' +
                      '</div>' +
                    '</div>' +
                  '</div>' +
                  '<div id="cJsonStats" class="hidden" style="margin-top:10px">' +
                    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:6px;margin-bottom:10px">' +
                      '<div class="json-stat-card"><span class="json-stat-num" id="cJsonTotalCount">0</span><span class="json-stat-lbl">إجمالي العناصر</span></div>' +
                      '<div class="json-stat-card" style="border-color:rgba(16,185,129,0.4);background:rgba(16,185,129,0.06)"><span class="json-stat-num" style="color:var(--green,#10b981)" id="cJsonConfirmedCount">0</span><span class="json-stat-lbl">أرقام مؤكدة</span></div>' +
                      '<div class="json-stat-card" style="border-color:rgba(245,158,11,0.4);background:rgba(245,158,11,0.06)"><span class="json-stat-num" style="color:var(--warn,#f59e0b)" id="cJsonLidCount">0</span><span class="json-stat-lbl">معرفات LID</span></div>' +
                      '<div class="json-stat-card"><span class="json-stat-num" id="cJsonAdminCount">0</span><span class="json-stat-lbl">مشرفون</span></div>' +
                    '</div>' +
                    '<div style="background:var(--surface-2);padding:10px 12px;border-radius:var(--r-2);border:1px solid var(--line-2)">' +
                      '<div style="font-weight:600;font-size:12px;margin-bottom:6px">خيارات تصفية الإرسال:</div>' +
                      '<label class="check-row" style="border:0;padding:3px 0"><input type="checkbox" id="cJsonOnlyConfirmed" checked><span class="n">إرسال للأرقام المؤكدة فقط (تخطي معرفات LID)</span></label>' +
                      '<label class="check-row" style="border:0;padding:3px 0"><input type="checkbox" id="cJsonDedupe" checked><span class="n">إزالة التكرار (رقم واحد لكل جهة)</span></label>' +
                      '<label class="check-row" style="border:0;padding:3px 0"><input type="checkbox" id="cJsonExcludeAdmins"><span class="n">استبعاد مشرفي المجموعات</span></label>' +
                      '<label class="check-row" style="border:0;padding:3px 0"><input type="checkbox" id="cJsonAdminsOnly"><span class="n">إرسال للمشرفين فقط</span></label>' +
                      '<div style="display:flex;align-items:center;gap:8px;margin-top:8px">' +
                        '<label style="font-size:12px;white-space:nowrap;margin:0">حد أقصى للإرسال:</label>' +
                        '<input type="number" id="cJsonLimit" placeholder="الكل (أو حدد مثل 100)" min="1" style="max-width:180px;height:30px;font-size:12px">' +
                        '<span class="faint" style="font-size:11px">فارغ = الكل</span>' +
                      '</div>' +
                    '</div>' +
                    '<div style="margin-top:8px;padding:8px 12px;background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.25);border-radius:var(--r-2);display:flex;align-items:center;justify-content:space-between">' +
                      '<span style="font-size:12px;font-weight:600">الجمهور المستهدف بعد الفلترة:</span>' +
                      '<span class="tag" data-tone="ok" id="cJsonFinalCount" style="font-size:12px;font-weight:700">0 جهة</span>' +
                    '</div>' +
                    '<div style="margin-top:8px">' +
                      '<span class="faint" style="font-size:11px">معاينة أولية (أول 3 أرقام):</span>' +
                      '<div id="cJsonPreviewList" style="margin-top:4px;font-size:11px;max-height:80px;overflow-y:auto;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-1);padding:6px">' +
                      '</div>' +
                    '</div>' +
                  '</div>' +
                '</div>' +
                '<div class="field"><label>نص الرسالة — استخدم <span class="mono">{name}</span> لاسم العميل</label>' +
                  '<textarea id="cTemplate" rows="4" placeholder="أهلاً {name}، خصم 20% خاص ليك النهاردة!"></textarea>' +
                  '<span class="help" style="margin-top:4px">💡 يدعم Spintax لتنويع النصوص تلقائياً ومنع الحظر، مثال: <span class="mono">{أهلاً|مرحباً|السلام عليكم}</span> {name}</span></div>' +
                '<div class="field"><label>صورة (اختياري)</label>' +
                  '<div style="display:flex;gap:6px"><input type="file" id="cImage" accept="image/*">' +
                  '<button class="btn btn-sm" data-g="clear-img">مسح</button></div></div>' +
                '<div class="field">' +
                  '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">' +
                    '<label style="margin:0;display:flex;align-items:center;gap:6px;font-weight:600">' +
                      '<i class="fa-solid fa-shield-halved" style="color:var(--accent)"></i> درع الحماية الذكي ضد الحظر (Anti-Ban Guard)' +
                    '</label>' +
                    '<span class="tag" data-tone="ok" style="font-size:11px">تلقائي فعال</span>' +
                  '</div>' +
                  '<div style="background:var(--surface-2);border:1px solid var(--line-2);border-radius:var(--r-2);padding:10px 12px">' +
                    '<div style="margin-bottom:8px">' +
                      '<label style="font-size:11.5px;color:var(--faint);display:block;margin-bottom:4px">مستوى الحماية المطبق:</label>' +
                      '<select id="cGuardPreset" style="width:100%;height:34px;font-size:12.5px;border-radius:var(--r-1)">' +
                        '<option value="max" selected>🛡️ أقصى حماية (موصى بها للأرقام المستخرجة والجديدة)</option>' +
                        '<option value="balanced">⚖️ متوازن (فاصل 20-40 ثانية، راحة 20 دقيقة لكل 35 رسالة)</option>' +
                        '<option value="fast">⚡ إرسال سريع (للعملاء الحاليين والمجموعات فقط)</option>' +
                        '<option value="custom">⚙️ إعداد يدوي مخصص</option>' +
                      '</select>' +
                    '</div>' +
                    '<div id="cCustomGuardBox" class="hidden" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;padding-top:8px;border-top:1px dashed var(--line)">' +
                      '<div><label style="font-size:11px">الحد الأدنى للفاصل (ثانية)</label><input type="number" id="cMinDelay" value="35" min="3" max="300" style="font-size:12px;height:30px"></div>' +
                      '<div><label style="font-size:11px">الحد الأقصى للفاصل (ثانية)</label><input type="number" id="cMaxDelay" value="75" min="5" max="600" style="font-size:12px;height:30px"></div>' +
                      '<div><label style="font-size:11px">الرسائل لكل دفعة</label><input type="number" id="cBatchSize" value="25" min="5" max="500" style="font-size:12px;height:30px"></div>' +
                      '<div><label style="font-size:11px">استراحة الأمان (دقيقة)</label><input type="number" id="cBatchCooldown" value="45" min="1" max="360" style="font-size:12px;height:30px"></div>' +
                    '</div>' +
                    '<div style="display:flex;flex-direction:column;gap:3px">' +
                      '<label class="check-row" style="border:0;padding:2px 0;font-size:11.5px"><input type="checkbox" id="cEnableTyping" checked><span class="n">محاكاة الكتابة البشرية (جاري الكتابة... لعدة ثوانٍ)</span></label>' +
                      '<label class="check-row" style="border:0;padding:2px 0;font-size:11.5px"><input type="checkbox" id="cEnableSpintax" checked><span class="n">تفعيل تنويع الكلمات Spintax تلقائياً</span></label>' +
                      '<label class="check-row" style="border:0;padding:2px 0;font-size:11.5px"><input type="checkbox" id="cVerifyWhatsApp" checked><span class="n">فحص وتسجيل الرقم على واتساب قبل الإرسال</span></label>' +
                    '</div>' +
                    '<div id="cGuardSummary" style="font-size:11px;color:var(--faint);margin-top:6px;padding:5px 8px;background:var(--surface);border-radius:var(--r-1)">' +
                      '✨ فاصل عشوائي 35–75 ثانية · دفعة 25 رسالة · استراحة أمان 45 دقيقة' +
                    '</div>' +
                  '</div>' +
                '</div>' +
                '<input type="hidden" id="cDelay" value="35">' +
                '<button class="btn btn-primary btn-block" data-act="start-campaign"><i class="fa-solid fa-paper-plane"></i> إطلاق الحملة</button>' +
                '<div class="progress hidden" id="cProgress" style="margin-top:14px">' +
                  '<div class="progress-top"><span id="cProgressText">—</span><span class="mono" id="cProgressPct">0%</span></div>' +
                  '<div class="progress-track"><div class="progress-fill" id="cProgressBar"></div></div>' +
                  '<div id="cCoolingAlert" class="hidden" style="margin-top:8px;padding:8px 10px;background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.3);border-radius:var(--r-1);font-size:12px;color:var(--warn,#f59e0b);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px">' +
                    '<span><i class="fa-solid fa-mug-hot"></i> فترة راحة استراتيجية لمنع الحظر</span>' +
                    '<button class="btn btn-sm" data-cc="skip-cooldown" style="font-size:11px;padding:2px 8px;background:var(--warn,#f59e0b);color:#000;font-weight:600">⚡ تخطي الاستراحة والمتابعة الآن</button>' +
                  '</div>' +
                  '<div style="display:flex;gap:6px;margin-top:8px">' +
                    '<button class="btn btn-sm" data-cc="pause">إيقاف مؤقت</button>' +
                    '<button class="btn btn-sm hidden" data-cc="resume">استئناف</button>' +
                    '<button class="btn btn-sm btn-danger" data-cc="cancel">إلغاء</button>' +
                  "</div></div>" +
              "</div>" +
              '<div class="tile tile-lg"><div class="tile-head"><h4>سجل الحملات</h4></div>' +
                '<div id="cHistory">' + campaignsHistory() + "</div></div>" +
            "</div></div>";
      },
      mount: function (el) {
        renderPresets();
        var gs = el.querySelector("#cGroupSearch");
        if (gs) gs.addEventListener("input", function (e) { renderGroups(e.target.value); });
        var sel = el.querySelector("#cAudience");
        if (sel) sel.addEventListener("change", function (e) { onAudienceChange(e.target.value); });

        var jsonDrop = el.querySelector("#cJsonDropzone");
        var jsonInput = el.querySelector("#cJsonFileInput");
        var jsonChangeBtn = el.querySelector("#cJsonChangeBtn");
        if (jsonDrop && jsonInput) {
          jsonDrop.addEventListener("click", function (e) {
            if (e.target.closest("#cJsonChangeBtn") || e.target.id === "cJsonChangeBtn" || !$("cJsonLoadedView") || $("cJsonLoadedView").classList.contains("hidden")) {
              jsonInput.click();
            }
          });
          if (jsonChangeBtn) {
            jsonChangeBtn.addEventListener("click", function (e) {
              e.stopPropagation();
              jsonInput.click();
            });
          }
          jsonInput.addEventListener("change", function (e) {
            if (e.target.files && e.target.files[0]) {
              parseAndLoadJsonFile(e.target.files[0]);
            }
          });
          jsonDrop.addEventListener("dragover", function (e) {
            e.preventDefault();
            jsonDrop.classList.add("dragover");
          });
          jsonDrop.addEventListener("dragleave", function () {
            jsonDrop.classList.remove("dragover");
          });
          jsonDrop.addEventListener("drop", function (e) {
            e.preventDefault();
            jsonDrop.classList.remove("dragover");
            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
              parseAndLoadJsonFile(e.dataTransfer.files[0]);
            }
          });
        }

        var jsonChkIds = ["cJsonOnlyConfirmed", "cJsonDedupe", "cJsonExcludeAdmins", "cJsonAdminsOnly"];
        jsonChkIds.forEach(function (cid) {
          var chk = el.querySelector("#" + cid);
          if (chk) {
            chk.addEventListener("change", function () {
              if (cid === "cJsonAdminsOnly" && chk.checked) {
                var exc = el.querySelector("#cJsonExcludeAdmins");
                if (exc) exc.checked = false;
              } else if (cid === "cJsonExcludeAdmins" && chk.checked) {
                var adm = el.querySelector("#cJsonAdminsOnly");
                if (adm) adm.checked = false;
              }
              applyJsonFilters();
            });
          }
        });

        var jsonLimit = el.querySelector("#cJsonLimit");
        if (jsonLimit) {
          jsonLimit.addEventListener("input", function () { applyJsonFilters(); });
        }

        var guardSel = el.querySelector("#cGuardPreset");
        var customBox = el.querySelector("#cCustomGuardBox");
        var guardSummary = el.querySelector("#cGuardSummary");
        if (guardSel) {
          guardSel.addEventListener("change", function (e) {
            var val = e.target.value;
            if (customBox) customBox.classList.toggle("hidden", val !== "custom");
            if (val === "max") {
              if (guardSummary) guardSummary.textContent = "✨ فاصل عشوائي 35–75 ثانية · دفعة 25 رسالة · استراحة أمان 45 دقيقة";
              if ($("cEnableTyping")) $("cEnableTyping").checked = true;
              if ($("cEnableSpintax")) $("cEnableSpintax").checked = true;
              if ($("cVerifyWhatsApp")) $("cVerifyWhatsApp").checked = true;
            } else if (val === "balanced") {
              if (guardSummary) guardSummary.textContent = "✨ فاصل عشوائي 20–40 ثانية · دفعة 35 رسالة · استراحة أمان 20 دقيقة";
              if ($("cEnableTyping")) $("cEnableTyping").checked = true;
              if ($("cEnableSpintax")) $("cEnableSpintax").checked = true;
              if ($("cVerifyWhatsApp")) $("cVerifyWhatsApp").checked = true;
            } else if (val === "fast") {
              if (guardSummary) guardSummary.textContent = "⚡ فاصل عشوائي 8–15 ثانية · دفعة 60 رسالة · استراحة أمان 10 دقائق";
              if ($("cEnableTyping")) $("cEnableTyping").checked = false;
            } else if (val === "custom") {
              if (guardSummary) guardSummary.textContent = "⚙️ إعدادات يدوية مخصصة حسب رغبتك";
            }
          });
        }

        if (S.uploadedJsonFile && S.uploadedJsonNormalized && S.uploadedJsonNormalized.length) {
          renderJsonLoadedState();
          applyJsonFilters();
        }

        if (S.activeCampaignId) showCampaignProgress();
      }
    };
  }

  function campaignsHistory() {
    if (!S.campaigns.length) return '<p class="faint" style="font-size:12.5px">لسه مفيش حملات.</p>';
    return '<div class="tile-list">' + S.campaigns.map(function (c) {
      var tone = c.status === "completed" ? "ok" : c.status === "cancelled" ? "danger" : c.status === "cooling" ? "warn" : "warn";
      var label = { completed: "مكتملة", running: "جارية", paused: "متوقفة", cancelled: "ملغية", cooling: "استراحة أمان" }[c.status] || c.status;
      return '<div class="li" data-campaign="' + attr(c.id) + '">' +
        '<span class="grow"><span style="display:block;font-weight:600">' + esc(c.title) + "</span>" +
        '<span class="faint" style="font-size:11px">تم ' + c.sent_count + " · فشل " + c.failed_count + " · من " + c.target_count + "</span></span>" +
        '<span class="tag" data-tone="' + tone + '">' + esc(label) + "</span>" +
        '<span class="val faint" style="font-size:10px">' + esc(fmtDate(c.created_at)) + "</span></div>";
    }).join("") + "</div>";
  }

  function onAudienceChange(val) {
    var groupsBox = $("cGroupsBox"), customBox = $("cCustomBox"), jsonBox = $("cJsonBox");
    var isGroups = val === "groups" || val.indexOf("preset:") === 0;
    if (groupsBox) groupsBox.classList.toggle("hidden", !isGroups);
    if (customBox) customBox.classList.toggle("hidden", val !== "custom");
    if (jsonBox) jsonBox.classList.toggle("hidden", val !== "json-file");
    if ($("cPresetDel")) $("cPresetDel").classList.toggle("hidden", val.indexOf("preset:") !== 0);

    if (isGroups) {
      fetchGroups().then(function () {
        if (val.indexOf("preset:") === 0) {
          var id = val.split(":")[1];
          S.activePresetId = id;
          var p = S.presets.filter(function (x) { return String(x.id) === String(id); })[0];
          var jids = p ? (p.targetJids || p.target_jids || []) : [];
          if (typeof jids === "string") { try { jids = JSON.parse(jids); } catch (e) { jids = []; } }
          S.selectedGroups = new Set(jids);
        } else { S.activePresetId = null; }
        renderGroups($("cGroupSearch") ? $("cGroupSearch").value : "");
      });
    }
  }

  function normalizeJsonEntry(item) {
    if (!item) return null;
    var phone = "", jid = "", name = "", isAdmin = false, groupName = "";
    if (typeof item === "string" || typeof item === "number") {
      phone = String(item).trim();
    } else if (typeof item === "object") {
      phone = String(item.phone || item.number || item.mobile || item.phoneNumber || "").trim();
      jid = String(item.jid || item.id || "").trim();
      name = String(item.name || item.fullName || item.pushName || "").trim();
      isAdmin = !!(item.isAdmin || item.is_admin || item.admin);
      groupName = String(item.groupName || item.group || (item.groups && item.groups[0]) || "").trim();
    }

    var digits = phone.replace(/\D/g, "");
    if (!digits && jid && (jid.includes("@s.whatsapp.net") || jid.includes("@c.us"))) {
      digits = jid.split("@")[0].replace(/\D/g, "");
    }
    if (digits.startsWith("01") && digits.length === 11) {
      digits = "2" + digits;
    }

    var isLid = digits.length >= 14 || (jid.includes("@lid") && (digits.length >= 14 || !digits));
    var isConfirmedPhone = digits.length >= 10 && digits.length <= 13;

    return {
      raw: item,
      phone: digits || phone,
      jid: jid,
      name: name,
      isAdmin: isAdmin,
      groupName: groupName,
      isLid: isLid,
      isConfirmedPhone: isConfirmedPhone
    };
  }

  function applyJsonFilters() {
    if (!S.uploadedJsonNormalized || !S.uploadedJsonNormalized.length) {
      S.uploadedJsonFiltered = [];
      updateJsonFilterDisplay();
      return;
    }

    var onlyConfirmed = $("cJsonOnlyConfirmed") ? $("cJsonOnlyConfirmed").checked : true;
    var dedupe = $("cJsonDedupe") ? $("cJsonDedupe").checked : true;
    var excludeAdmins = $("cJsonExcludeAdmins") ? $("cJsonExcludeAdmins").checked : false;
    var adminsOnly = $("cJsonAdminsOnly") ? $("cJsonAdminsOnly").checked : false;
    var limitInput = $("cJsonLimit");
    var limitVal = limitInput && limitInput.value ? parseInt(limitInput.value, 10) : 0;

    var list = S.uploadedJsonNormalized.slice();

    if (onlyConfirmed) {
      list = list.filter(function (x) { return x.isConfirmedPhone; });
    }
    if (excludeAdmins) {
      list = list.filter(function (x) { return !x.isAdmin; });
    }
    if (adminsOnly) {
      list = list.filter(function (x) { return x.isAdmin; });
    }

    if (dedupe) {
      var seen = new Set();
      list = list.filter(function (x) {
        var key = x.phone || x.jid;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    if (limitVal > 0) {
      list = list.slice(0, limitVal);
    }

    S.uploadedJsonFiltered = list;
    updateJsonFilterDisplay();
  }

  function updateJsonFilterDisplay() {
    var countEl = $("cJsonFinalCount");
    var cnt = S.uploadedJsonFiltered ? S.uploadedJsonFiltered.length : 0;
    if (countEl) countEl.textContent = cnt.toLocaleString() + " جهة";

    var prev = $("cJsonPreviewList");
    if (prev) {
      if (!cnt) {
        prev.innerHTML = '<span class="faint">لا توجد أرقام مطابقة للفلاتر الحالية.</span>';
      } else {
        var sample = S.uploadedJsonFiltered.slice(0, 3);
        prev.innerHTML = sample.map(function (item, idx) {
          var label = (item.name ? item.name + " · " : "") + (item.phone || item.jid) + (item.isAdmin ? " (مشرف)" : "");
          var grp = item.groupName ? ' <span class="faint">[' + esc(item.groupName) + ']</span>' : "";
          return '<div style="padding:2px 0">' + (idx + 1) + '. <span class="mono" dir="ltr">' + esc(label) + "</span>" + grp + "</div>";
        }).join("") + (cnt > 3 ? '<div class="faint" style="margin-top:2px">... والمزيد (' + (cnt - 3).toLocaleString() + ' جهة أخرى)</div>' : "");
      }
    }
  }

  function parseAndLoadJsonFile(file) {
    if (!file) return;
    var fname = file.name || "";
    if (!fname.toLowerCase().endsWith(".json") && file.type !== "application/json") {
      return toast("يرجى اختيار ملف بصيغة JSON.", "warn");
    }

    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var parsed = JSON.parse(e.target.result);
        var rawList = Array.isArray(parsed) ? parsed : (parsed.data || parsed.contacts || parsed.items || []);
        if (!Array.isArray(rawList) || !rawList.length) {
          return toast("ملف الـ JSON لا يحتوي على مصفوفة جهات اتصال صالحة.", "warn");
        }

        S.uploadedJsonRaw = rawList;
        S.uploadedJsonFile = file;
        S.uploadedJsonNormalized = rawList.map(normalizeJsonEntry).filter(Boolean);

        renderJsonLoadedState();
        applyJsonFilters();
        toast("تم قراءة ملف JSON بنجاح: " + S.uploadedJsonNormalized.length.toLocaleString() + " جهة.", "ok");
      } catch (err) {
        toast("فشل قراءة ملف الـ JSON: " + err.message, "danger");
      }
    };
    reader.onerror = function () {
      toast("حدث خطأ أثناء قراءة الملف من الجهاز.", "danger");
    };
    reader.readAsText(file);
  }

  function renderJsonLoadedState() {
    if (!S.uploadedJsonFile || !S.uploadedJsonNormalized) return;
    var promptEl = $("cJsonDropzonePrompt");
    var loadedEl = $("cJsonLoadedView");
    var statsEl = $("cJsonStats");
    if (promptEl) promptEl.classList.add("hidden");
    if (loadedEl) loadedEl.classList.remove("hidden");
    if (statsEl) statsEl.classList.remove("hidden");

    var nameEl = $("cJsonFileName");
    var sizeEl = $("cJsonFileSize");
    if (nameEl) nameEl.textContent = S.uploadedJsonFile.name;
    if (sizeEl) sizeEl.textContent = fmtFileSize(S.uploadedJsonFile.size) + " · (" + S.uploadedJsonNormalized.length.toLocaleString() + " عنصر)";

    var total = S.uploadedJsonNormalized.length;
    var confirmed = S.uploadedJsonNormalized.filter(function (x) { return x.isConfirmedPhone; }).length;
    var lids = S.uploadedJsonNormalized.filter(function (x) { return x.isLid; }).length;
    var admins = S.uploadedJsonNormalized.filter(function (x) { return x.isAdmin; }).length;

    var tc = $("cJsonTotalCount"), cc = $("cJsonConfirmedCount"), lc = $("cJsonLidCount"), ac = $("cJsonAdminCount");
    if (tc) tc.textContent = total.toLocaleString();
    if (cc) cc.textContent = confirmed.toLocaleString();
    if (lc) lc.textContent = lids.toLocaleString();
    if (ac) ac.textContent = admins.toLocaleString();
  }

  function fetchGroups(force) {
    if (S.groupsLoaded && !force) return Promise.resolve();
    var list = $("cGroupsList");
    if (list) list.innerHTML = '<div class="sk-row"><span class="skeleton sk-av"></span><span class="sk-lines"><span class="skeleton" style="width:70%"></span><span class="skeleton" style="width:40%"></span></span></div>';
    return api("/api/groups").then(function (d) {
      if (d && d.success) { S.groups = d.groups || []; S.groupsLoaded = true; }
    }).catch(function () {});
  }

  function renderGroups(filter) {
    var list = $("cGroupsList");
    if (!list) return;
    var f = (filter || "").trim().toLowerCase();
    var items = S.groups.filter(function (g) {
      return !f || String(g.name || g.subject || "").toLowerCase().indexOf(f) > -1;
    });
    list.innerHTML = items.length ? items.map(function (g) {
      var on = S.selectedGroups.has(g.jid);
      return '<label class="check-row"><input type="checkbox" data-group="' + attr(g.jid) + '"' + (on ? " checked" : "") + ">" +
        '<span class="n">' + esc(g.name || g.subject || "مجموعة") + "</span>" +
        '<span class="c">' + esc(g.participantCount || g.size || "") + "</span></label>";
    }).join("") : '<p class="faint" style="padding:14px;font-size:12px">مفيش مجموعات مطابقة.</p>';
    var cnt = $("cGroupsCount");
    if (cnt) cnt.textContent = "(" + S.selectedGroups.size + " من " + S.groups.length + ")";
  }

  function renderPresets() {
    var og = $("cPresets");
    if (!og) return;
    og.innerHTML = S.presets.map(function (p) {
      return '<option value="preset:' + attr(p.id) + '">' + esc(p.name) + "</option>";
    }).join("");
  }

  function fetchPresets() {
    return api("/api/audience-presets").then(function (d) {
      if (d && d.success) { S.presets = d.presets || []; renderPresets(); }
    }).catch(function () {});
  }

  function fetchCampaigns() {
    return api("/api/campaigns").then(function (d) {
      if (d && d.success) {
        S.campaigns = d.campaigns || [];
        var h = $("cHistory");
        if (h) h.innerHTML = campaignsHistory();
      }
    }).catch(function () {});
  }

  function showCampaignProgress() {
    var p = $("cProgress");
    if (p) p.classList.remove("hidden");
  }

  function startCampaign() {
    var title = $("cTitle").value.trim();
    var template = $("cTemplate").value.trim();
    var audience = $("cAudience").value;
    var delay = Number($("cDelay").value) || 8;
    var img = $("cImage").files[0];

    if (!title || !template) return toast("العنوان ونص الرسالة مطلوبين.", "warn");

    var contacts = [];
    if (audience === "groups" || audience.indexOf("preset:") === 0) {
      if (!S.selectedGroups.size) return toast("اختار مجموعة واحدة على الأقل.", "warn");
      contacts = Array.from(S.selectedGroups).map(function (jid) {
        var g = S.groups.filter(function (x) { return x.jid === jid; })[0];
        return { jid: jid, name: g ? (g.name || g.subject) : "مجموعة", phone: jid };
      });
    } else if (audience === "custom") {
      contacts = $("cNumbers").value.split(/[\n,]+/).map(function (n) { return n.trim(); })
        .filter(function (n) { return n.length > 5; });
    } else if (audience === "json-file") {
      if (!S.uploadedJsonNormalized || !S.uploadedJsonNormalized.length) {
        return toast("يرجى اختيار أو سحب ملف JSON أولاً.", "warn");
      }
      if (!S.uploadedJsonFiltered || !S.uploadedJsonFiltered.length) {
        return toast("مفيش أرقام مطابقة للفلاتر الحالية من ملف JSON.", "warn");
      }
      contacts = S.uploadedJsonFiltered.map(function (item) {
        return {
          phone: item.phone,
          jid: item.jid || (item.phone ? item.phone + "@s.whatsapp.net" : ""),
          name: item.name || (item.isAdmin ? "مشرف" : ""),
          groupName: item.groupName || ""
        };
      });
    } else if (audience === "all") {
      contacts = S.contacts.map(function (c) { return { phone: c.phone || c.jid.split("@")[0], name: c.name, jid: c.jid }; });
    } else {
      contacts = S.contacts.filter(function (c) { return c.status_tag === audience; })
        .map(function (c) { return { phone: c.phone || c.jid.split("@")[0], name: c.name, jid: c.jid }; });
    }

    if (!contacts.length) return toast("مفيش أرقام مطابقة للجمهور المختار.", "warn");

    var guardPreset = $("cGuardPreset") ? $("cGuardPreset").value : "max";
    var minDelay = 35, maxDelay = 75, batchSize = 25, batchCooldown = 45;
    if (guardPreset === "max") {
      minDelay = 35; maxDelay = 75; batchSize = 25; batchCooldown = 45;
    } else if (guardPreset === "balanced") {
      minDelay = 20; maxDelay = 40; batchSize = 35; batchCooldown = 20;
    } else if (guardPreset === "fast") {
      minDelay = 8; maxDelay = 15; batchSize = 60; batchCooldown = 10;
    } else if (guardPreset === "custom") {
      minDelay = Math.max(3, parseInt($("cMinDelay") ? $("cMinDelay").value : 35) || 35);
      maxDelay = Math.max(minDelay, parseInt($("cMaxDelay") ? $("cMaxDelay").value : 75) || 75);
      batchSize = Math.max(1, parseInt($("cBatchSize") ? $("cBatchSize").value : 25) || 25);
      batchCooldown = Math.max(1, parseInt($("cBatchCooldown") ? $("cBatchCooldown").value : 45) || 45);
    }
    var enableTyping = $("cEnableTyping") ? $("cEnableTyping").checked : true;
    var enableSpintax = $("cEnableSpintax") ? $("cEnableSpintax").checked : true;
    var verifyWhatsApp = $("cVerifyWhatsApp") ? $("cVerifyWhatsApp").checked : true;

    var delayDesc = guardPreset === "max" ? "فاصل آمن 35-75 ثانية" : "فاصل " + minDelay + "-" + maxDelay + " ثانية";
    confirmAsk("هتتبعت الحملة لـ " + contacts.length + " جهة (" + delayDesc + " ومحاكاة بشرية). نبدأ؟", "إطلاق").then(function (ok) {
      if (!ok) return;
      var fd = new FormData();
      fd.append("title", title);
      fd.append("template", template);
      fd.append("delaySeconds", minDelay);
      fd.append("minDelay", minDelay);
      fd.append("maxDelay", maxDelay);
      fd.append("batchSize", batchSize);
      fd.append("batchCooldownMinutes", batchCooldown);
      fd.append("enableTyping", enableTyping ? "1" : "0");
      fd.append("enableSpintax", enableSpintax ? "1" : "0");
      fd.append("verifyWhatsApp", verifyWhatsApp ? "1" : "0");
      fd.append("contacts", JSON.stringify(contacts));
      if (img) fd.append("image", img);
      if (audience === "json-file" && S.uploadedJsonFile) {
        fd.append("jsonFile", S.uploadedJsonFile);
      }

      var btn = document.querySelector('[data-act="start-campaign"]');
      if (btn) btn.disabled = true;
      showCampaignProgress();

      fetch("/api/campaigns", { method: "POST", body: fd })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          /* الخادم بيرجّع { success, campaignId, total } مباشرة — مش جوّه result */
          var cid = d && (d.campaignId || (d.result && d.result.campaignId));
          if (d && d.success && cid) {
            S.activeCampaignId = cid;
            toast("الحملة بدأت — " + (d.total || contacts.length) + " جهة بنظام الحماية ضد الحظر", "ok");
          } else toast((d && d.error) || "فشل بدء الحملة", "danger");
        })
        .catch(function (e) { toast(e.message, "danger"); })
        .finally(function () { if (btn) btn.disabled = false; });
    });
  }

  function controlCampaign(action) {
    if (!S.activeCampaignId) return;
    var apiAction = action === "skip-cooldown" ? "skip_cooldown" : action;
    api("/api/campaigns/" + S.activeCampaignId + "/control", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: apiAction })
    }).then(function (d) {
      if (d && d.success) {
        if (action === "cancel") {
          $("cProgress").classList.add("hidden");
          S.activeCampaignId = null;
          toast("الحملة اتلغت", "warn");
        } else if (action === "skip-cooldown") {
          var cAlert = $("cCoolingAlert");
          if (cAlert) cAlert.classList.add("hidden");
          toast("تم تخطي استراحة الأمان ومتابعة الإرسال", "ok");
        }
      } else toast((d && d.error) || "فشل التحكم في الحملة", "danger");
    }).catch(function (e) { toast(e.message, "danger"); });
  }

  function openCampaignLogs(id) {
    var c = S.campaigns.filter(function (x) { return String(x.id) === String(id); })[0] || {};
    openSheet({
      wide: true,
      title: c.title || "سجل الحملة",
      body: '<p class="muted" style="font-size:12.5px;margin-bottom:12px">مستهدف ' + (c.target_count || 0) +
            " · تم " + (c.sent_count || 0) + " · فشل " + (c.failed_count || 0) + "</p>" +
            '<div id="logsWrap"><div class="sk-row"><span class="skeleton sk-av"></span><span class="sk-lines"><span class="skeleton" style="width:60%"></span></span></div></div>',
      mount: function () {
        api("/api/campaigns/" + id + "/logs").then(function (d) {
          var w = $("logsWrap");
          if (!w) return;
          if (d && d.success && d.logs && d.logs.length) {
            w.innerHTML = '<div class="table-wrap"><table class="data" style="min-width:480px"><thead><tr>' +
              "<th>الرقم</th><th>الحالة</th><th>الخطأ</th><th>الوقت</th></tr></thead><tbody>" +
              d.logs.map(function (l) {
                return '<tr><td class="num" dir="ltr">' + esc(l.phone) + "</td>" +
                  '<td><span class="tag" data-tone="' + (l.status === "success" ? "ok" : "danger") + '">' +
                  (l.status === "success" ? "نجاح" : "فشل") + "</span></td>" +
                  '<td style="font-size:11px">' + esc(l.error_message || "-") + "</td>" +
                  '<td class="faint" style="font-size:11px">' + esc(fmtDateTime(l.sent_at)) + "</td></tr>";
              }).join("") + "</tbody></table></div>";
          } else w.innerHTML = '<p class="faint" style="font-size:12.5px">مفيش سجل إرسال للحملة دي.</p>';
        });
      },
      foot: '<button class="btn" data-x="close">إغلاق</button>',
      onFoot: function () { closeSheet(); }
    });
  }

  /* ======================================================================
     11 · RULES — الأتمتة
     ====================================================================== */

  function rulesPanel() {
    return {
      id: "rules", role: "full", title: "الأتمتة", crumb: "الأتمتة",
      render: function () {
        return '' +
          '<div class="panel-head"><h3>الأتمتة</h3>' +
            '<span class="sub">قواعد ردّ فورية قبل ما المساعد الذكي يتدخّل</span>' +
            '<div class="actions"><button class="btn btn-sm btn-primary" data-act="new-rule"><i class="fa-solid fa-plus"></i> قاعدة جديدة</button></div>' +
          "</div>" +
          '<div class="panel-body pad" id="rulesBody">' + rulesHtml() + "</div>";
      }
    };
  }

  function rulesHtml() {
    if (!S.rules.length) {
      return '<div class="empty"><i class="fa-solid fa-wand-magic-sparkles"></i>' +
        "<p><strong>مفيش قواعد مخصّصة</strong>المساعد الذكي بيتولّى كل الردود. أضف قاعدة لو عايز ردّ فوري وثابت على كلمة معيّنة.</p></div>";
    }
    var MT = { contains: "يحتوي على", exact: "مطابق تمامًا", startsWith: "يبدأ بـ" };
    return '<div class="bento" style="padding:0;grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">' +
      S.rules.map(function (r) {
        return '<div class="tile" style="gap:8px">' +
          '<div class="tile-head"><h4 style="color:var(--accent);font-size:14px">«' + esc(r.keyword) + "»</h4>" +
            '<div class="actions"><button class="icon-btn danger" data-del-rule="' + attr(r.id) + '"><i class="fa-solid fa-trash-can"></i></button></div></div>' +
          '<span class="tag" data-tone="info" style="align-self:flex-start">' + esc(MT[r.matchType] || r.matchType) + "</span>" +
          '<p style="font-size:12.5px;color:var(--muted);line-height:1.8">' + esc(r.response) + "</p></div>";
      }).join("") + "</div>";
  }

  function newRuleSheet() {
    openSheet({
      title: "قاعدة ردّ جديدة",
      body:
        '<div class="field"><label>الكلمة المفتاحية *</label><input type="text" id="rKey" placeholder="مثال: السعر"></div>' +
        '<div class="field"><label>نوع المطابقة</label><select id="rType">' +
          '<option value="contains">يحتوي على</option><option value="exact">مطابق تمامًا</option><option value="startsWith">يبدأ بـ</option>' +
        "</select></div>" +
        '<div class="field"><label>نص الردّ *</label><textarea id="rResp" rows="4" placeholder="الردّ اللي هيتبعت فورًا…"></textarea></div>',
      foot: '<button class="btn" data-x="no">إلغاء</button><button class="btn btn-primary" data-x="yes">إضافة</button>',
      onFoot: function (a) {
        if (a !== "yes") return closeSheet();
        var k = $("rKey").value.trim(), resp = $("rResp").value.trim();
        if (!k || !resp) return toast("الكلمة المفتاحية والردّ مطلوبين.", "warn");
        api("/api/rules", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keyword: k, matchType: $("rType").value, response: resp })
        }).then(function () { closeSheet(true); toast("القاعدة اتضافت", "ok"); fetchRules(); })
          .catch(function (e) { toast(e.message, "danger"); });
      }
    });
  }

  function fetchRules() {
    return api("/api/rules").then(function (d) {
      S.rules = (d && d.rules) || [];
      var b = $("rulesBody");
      if (b) b.innerHTML = rulesHtml();
    }).catch(function () {});
  }

  /* ======================================================================
     12 · SETTINGS
     ====================================================================== */

  function settingsPanel() {
    return {
      id: "settings", role: "full", title: "الإعدادات", crumb: "الإعدادات",
      render: function () {
        var o = window.location.origin;
        return '' +
          '<div class="panel-head"><h3>الإعدادات</h3></div>' +
          '<div class="panel-body pad">' +
            '<div class="bento" style="padding:0">' +

              '<div class="tile tile-lg"><div class="tile-head"><h4>روابط الأدوات (Webhooks)</h4></div>' +
                '<p class="faint" style="font-size:12px">حطّ الروابط دي في أدوات الـ Chatflow بتاعتك.</p>' +
                webhookRow("تسجيل طلب", o + "/api/tools/order") +
                webhookRow("رسالة صوتية", o + "/api/tools/voice") +
                webhookRow("حجز موعد", o + "/api/tools/book-appointment") +
                webhookRow("تدخّل بشري", o + "/api/tools/takeover") +
              "</div>" +

              '<div class="tile tile-lg"><div class="tile-head"><h4>Google Sheets</h4></div>' +
                '<div class="field"><label>رابط الـ Webhook</label>' +
                  '<input type="text" id="setSheet" dir="ltr" placeholder="https://script.google.com/…" value="' +
                  attr((S.settings && S.settings.googleSheetWebhookUrl) || "") + '">' +
                  '<span class="help">كل طلب جديد هيتبعت للرابط ده تلقائيًا.</span></div>' +
                '<button class="btn btn-primary btn-sm" data-act="save-settings">حفظ</button>' +
              "</div>" +

              '<div class="tile tile-lg"><div class="tile-head"><h4>تصدير سريع</h4></div>' +
                '<p class="faint" style="font-size:12px">لخيارات أكتر (كذا مجموعة، استبعاد الأدمن، إلخ) روح لصفحة <b>تصدير البيانات</b> من القايمة الجانبية.</p>' +
                '<div class="field"><label>التصنيف</label><select id="expTag">' +
                  '<option value="all">الكل</option>' +
                  Object.keys(TAGS).map(function (k) { return '<option value="' + k + '">' + esc(TAGS[k]) + "</option>"; }).join("") +
                "</select></div>" +
                '<div class="field"><label>أو أعضاء مجموعة</label><select id="expGroup"><option value="">— بدون —</option>' +
                  S.groups.map(function (g) { return '<option value="' + attr(g.jid) + '">' + esc(g.name || g.subject) + "</option>"; }).join("") +
                "</select></div>" +
                '<button class="btn btn-primary btn-sm" data-act="export"><i class="fa-solid fa-download"></i> تصدير JSON</button>' +
              "</div>" +

              '<div class="tile tile-lg"><div class="tile-head"><h4>الحساب</h4></div>' +
                '<div class="kv"><span class="k">البريد الإلكتروني</span><span class="v mono" dir="ltr" id="accountEmail">' +
                  esc((S.account && S.account.email) || "") + "</span></div>" +
                '<button class="btn btn-sm" data-act="website-logout" style="margin-top:12px">' +
                  '<i class="fa-solid fa-door-open"></i> تسجيل الخروج من الحساب</button>' +
              "</div>" +

              '<div class="tile tile-lg"><div class="tile-head"><h4>الجهاز والاتصال</h4></div>' +
                '<div class="kv"><span class="k">حالة الاتصال</span><span class="v">' +
                  (S.connState === "open" ? "متصل" : "غير متصل") + "</span></div>" +
                '<div class="kv"><span class="k">الرقم المرتبط</span><span class="v mono" dir="ltr">' +
                  esc($("connPhone").textContent || "—") + "</span></div>" +
                '<div class="kv"><span class="k">المظهر</span><span class="v">' +
                  '<span class="seg" id="themeSeg">' +
                    '<button data-theme-set="light">فاتح</button>' +
                    '<button data-theme-set="dark">ليلي</button>' +
                    '<button data-theme-set="system">النظام</button>' +
                  "</span></span></div>" +
                '<button class="btn btn-danger btn-sm" data-act="logout" style="margin-top:12px">' +
                  '<i class="fa-solid fa-right-from-bracket"></i> فصل الجهاز</button>' +
              "</div>" +

            "</div></div>";
      },
      mount: function () {
        if (!S.groupsLoaded) fetchGroups();
        syncThemeSeg();
      }
    };
  }

  function webhookRow(label, url) {
    return '<div class="kv"><span class="k">' + esc(label) + "</span>" +
      '<span class="v mono" dir="ltr" style="font-size:11px;display:flex;gap:6px;align-items:center">' +
      '<span class="ellipsis" style="max-width:260px">' + esc(url) + "</span>" +
      '<button class="icon-btn" data-copy="' + attr(url) + '" title="نسخ"><i class="fa-regular fa-copy"></i></button></span></div>';
  }

  function fetchSettings() {
    return api("/api/settings").then(function (d) {
      if (d && d.success) S.settings = d.settings;
    }).catch(function () {});
  }

  /* ======================================================================
     12ب · تصدير البيانات (جهات اتصال / مجموعة / كذا مجموعة / كل المجموعات)
     ====================================================================== */

  function exportPanel() {
    return {
      id: "export", role: "full", title: "تصدير البيانات", crumb: "تصدير البيانات",
      render: function () {
        return '' +
          '<div class="panel-head"><h3>تصدير جهات الاتصال والمجموعات</h3>' +
          '<span class="sub">استخرج الأرقام اللي محتاجها كملف JSON — مع استبعاد التكرار تلقائيًا</span></div>' +
          '<div class="panel-body pad">' +
            '<div class="bento" style="padding:0">' +

              '<div class="tile tile-lg">' +
                '<div class="tile-head"><h4>المصدر</h4></div>' +
                '<div class="field"><label>استخرج من</label><select id="expSource">' +
                  '<option value="contacts">كل جهات اتصال الـ CRM</option>' +
                  '<option value="groups">مجموعة أو أكتر (تحديد يدوي)</option>' +
                  '<option value="all-groups">كل مجموعات الواتساب</option>' +
                "</select></div>" +

                '<div class="field" id="expTagBox"><label>التصنيف</label><select id="expSrcTag">' +
                  '<option value="all">الكل</option>' +
                  Object.keys(TAGS).map(function (k) { return '<option value="' + k + '">' + esc(TAGS[k]) + "</option>"; }).join("") +
                "</select></div>" +

                '<div class="field hidden" id="expGroupsBox">' +
                  '<label>اختيار المجموعات <span class="mono faint" id="expGroupsCount"></span></label>' +
                  '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">' +
                    '<button class="btn btn-sm" data-expg="all">تحديد الكل</button>' +
                    '<button class="btn btn-sm" data-expg="none">إلغاء الكل</button>' +
                    '<button class="btn btn-sm" data-expg="invert">عكس</button>' +
                    '<button class="btn btn-sm" data-expg="refresh"><i class="fa-solid fa-rotate"></i></button>' +
                  "</div>" +
                  '<input type="search" id="expGroupSearch" placeholder="بحث باسم المجموعة…" style="margin-bottom:6px">' +
                  '<div class="check-list" id="expGroupsList"></div>' +
                "</div>" +
              "</div>" +

              '<div class="tile tile-lg">' +
                '<div class="tile-head"><h4>خيارات إضافية</h4></div>' +
                '<label class="check-row" style="border:0;padding:6px 0">' +
                  '<input type="checkbox" id="expDedupe" checked><span class="n">استبعاد الأرقام المكررة (لو الرقم موجود في كذا مجموعة، هيتحسب مرة واحدة بس)</span></label>' +
                '<label class="check-row" style="border:0;padding:6px 0">' +
                  '<input type="checkbox" id="expIncludeNames" checked><span class="n">جيب الاسم من الـ CRM لو متوفر</span></label>' +
                '<label class="check-row" style="border:0;padding:6px 0" id="expAdminsOnlyRow">' +
                  '<input type="checkbox" id="expAdminsOnly"><span class="n">أدمن المجموعات بس</span></label>' +
                '<label class="check-row" style="border:0;padding:6px 0" id="expExcludeAdminsRow">' +
                  '<input type="checkbox" id="expExcludeAdmins"><span class="n">استبعاد الأدمن من النتيجة</span></label>' +
                '<div class="field" style="margin-top:10px"><label>أرقام مستبعدة (اختياري — رقم في كل سطر)</label>' +
                  '<textarea id="expExclude" rows="3" dir="ltr" placeholder="201012345678"></textarea></div>' +
                '<button class="btn btn-primary btn-block" id="expRunBtn" data-act="exp-extract">' +
                  '<i class="fa-solid fa-file-export"></i> استخراج وتنزيل JSON</button>' +
              "</div>" +

              '<div class="tile tile-lg' + (S.exportLastResult ? '' : ' hidden') + '" id="expResultTile">' +
                '<div class="tile-head"><h4>آخر نتيجة</h4></div>' +
                '<div id="expResultBody">' + exportResultHtml() + "</div>" +
              "</div>" +

            "</div></div>";
      },
      mount: function (el) {
        fetchGroups().then(function () { renderExportGroups(""); });
        var srcSel = el.querySelector("#expSource");
        if (srcSel) srcSel.addEventListener("change", function (e) { onExportSourceChange(e.target.value); });
        var gs = el.querySelector("#expGroupSearch");
        if (gs) gs.addEventListener("input", function (e) { renderExportGroups(e.target.value); });
        onExportSourceChange(srcSel ? srcSel.value : "contacts");
      }
    };
  }

  function onExportSourceChange(val) {
    var tagBox = $("expTagBox"), groupsBox = $("expGroupsBox");
    var adminsOnlyRow = $("expAdminsOnlyRow"), excludeAdminsRow = $("expExcludeAdminsRow");
    var isGroupSource = val === "groups" || val === "all-groups";
    if (tagBox) tagBox.classList.toggle("hidden", isGroupSource);
    if (groupsBox) groupsBox.classList.toggle("hidden", val !== "groups");
    if (adminsOnlyRow) adminsOnlyRow.classList.toggle("hidden", !isGroupSource);
    if (excludeAdminsRow) excludeAdminsRow.classList.toggle("hidden", !isGroupSource);
  }

  function renderExportGroups(filter) {
    var list = $("expGroupsList");
    if (!list) return;
    var f = (filter || "").trim().toLowerCase();
    var items = S.groups.filter(function (g) {
      return !f || String(g.name || g.subject || "").toLowerCase().indexOf(f) > -1;
    });
    list.innerHTML = items.length ? items.map(function (g) {
      var on = S.exportSelectedGroups.has(g.jid);
      return '<label class="check-row"><input type="checkbox" data-expgroup="' + attr(g.jid) + '"' + (on ? " checked" : "") + ">" +
        '<span class="n">' + esc(g.name || g.subject || "مجموعة") + "</span>" +
        '<span class="c">' + esc(g.participantCount || g.size || "") + "</span></label>";
    }).join("") : '<p class="faint" style="padding:14px;font-size:12px">مفيش مجموعات مطابقة.</p>';
    var cnt = $("expGroupsCount");
    if (cnt) cnt.textContent = "(" + S.exportSelectedGroups.size + " من " + S.groups.length + ")";
  }

  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t.matches("[data-expgroup]")) {
      var jid = t.getAttribute("data-expgroup");
      if (t.checked) S.exportSelectedGroups.add(jid); else S.exportSelectedGroups.delete(jid);
      var cnt = $("expGroupsCount");
      if (cnt) cnt.textContent = "(" + S.exportSelectedGroups.size + " من " + S.groups.length + ")";
    }
  });

  function handleExportGroupAction(a) {
    if (a === "all") { S.groups.forEach(function (g) { S.exportSelectedGroups.add(g.jid); }); renderExportGroups($("expGroupSearch").value); }
    else if (a === "none") { S.exportSelectedGroups.clear(); renderExportGroups($("expGroupSearch").value); }
    else if (a === "invert") {
      S.groups.forEach(function (g) {
        if (S.exportSelectedGroups.has(g.jid)) S.exportSelectedGroups.delete(g.jid); else S.exportSelectedGroups.add(g.jid);
      });
      renderExportGroups($("expGroupSearch").value);
    } else if (a === "refresh") {
      fetchGroups(true).then(function () { renderExportGroups($("expGroupSearch").value); toast("قائمة المجموعات اتحدّثت", "ok"); });
    }
  }

  document.addEventListener("click", function (e) {
    var eg = e.target.closest("[data-expg]");
    if (eg) { handleExportGroupAction(eg.getAttribute("data-expg")); }
  });

  function exportResultHtml() {
    var r = S.exportLastResult;
    if (!r) return "";
    return '<div class="kv"><span class="k">عدد النتائج</span><span class="v">' + r.count + "</span></div>" +
      '<div class="kv"><span class="k">تكرارات اتشالت</span><span class="v">' + (r.duplicatesRemoved || 0) + "</span></div>" +
      '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">' +
        '<button class="btn btn-sm" data-act="exp-copy"><i class="fa-regular fa-copy"></i> نسخ الأرقام</button>' +
        '<button class="btn btn-sm" data-act="exp-save-preset"><i class="fa-solid fa-bookmark"></i> احفظ كقائمة جمهور للحملات</button>' +
      "</div>";
  }

  function collectExportPayload() {
    var source = $("expSource").value;
    var payload = {
      source: source,
      dedupe: $("expDedupe").checked,
      includeNames: $("expIncludeNames").checked,
      tag: $("expSrcTag") ? $("expSrcTag").value : "all",
      excludeNumbers: ($("expExclude").value || "").split(/[\n,]+/).map(function (s) { return s.trim(); }).filter(Boolean)
    };
    if (source === "groups" || source === "all-groups") {
      payload.adminsOnly = $("expAdminsOnly").checked;
      payload.excludeAdmins = $("expExcludeAdmins").checked;
    }
    if (source === "groups") {
      payload.groupJids = Array.from(S.exportSelectedGroups);
      if (!payload.groupJids.length) return null;
    }
    return payload;
  }

  function doExtract() {
    var payload = collectExportPayload();
    if (!payload) return toast("اختار مجموعة واحدة على الأقل.", "warn");
    var btn = $("expRunBtn");
    if (btn) btn.disabled = true;
    api("/api/export/extract", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (d) {
      if (btn) btn.disabled = false;
      if (!d || !d.success) return toast((d && d.error) || "فشل الاستخراج.", "danger");
      if (!d.count) return toast("مفيش نتائج مطابقة.", "warn");
      S.exportLastResult = d;
      var tile = $("expResultTile");
      if (tile) { tile.classList.remove("hidden"); var body = $("expResultBody"); if (body) body.innerHTML = exportResultHtml(); }
      var blob = new Blob([JSON.stringify(d.data, null, 2)], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = "export_" + payload.source + "_" + Date.now() + ".json";
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast("اتصدّرت " + d.count + " جهة اتصال" + (d.duplicatesRemoved ? " (اتشال " + d.duplicatesRemoved + " تكرار)" : ""), "ok");
    }).catch(function (e) {
      if (btn) btn.disabled = false;
      toast(e.message, "danger");
    });
  }

  function copyExtractNumbers() {
    var r = S.exportLastResult;
    if (!r || !r.data || !r.data.length) return toast("مفيش نتيجة لسه.", "warn");
    var text = r.data.map(function (e) { return e.phone; }).filter(Boolean).join("\n");
    navigator.clipboard.writeText(text)
      .then(function () { toast("اتنسخ " + r.data.length + " رقم", "ok"); })
      .catch(function () { toast("المتصفح منع النسخ", "warn"); });
  }

  function saveExtractAsPreset() {
    var r = S.exportLastResult;
    if (!r || !r.data || !r.data.length) return toast("مفيش نتيجة لسه.", "warn");
    var name = prompt("اسم قائمة الجمهور دي؟");
    if (!name) return;
    var jids = r.data.map(function (e) { return e.jid; }).filter(Boolean);
    api("/api/audience-presets", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name, type: "custom", targetJids: jids, excludedJids: [] })
    }).then(function () { toast("اتحفظت كقائمة جمهور — هتلاقيها في الحملات", "ok"); fetchPresets(); })
      .catch(function (e) { toast(e.message, "danger"); });
  }

  /* ======================================================================
     13 · CORE — لوحة الأوامر
     ====================================================================== */

  var pal = { open: false, items: [], idx: 0 };

  var COMMANDS = [
    { icon: "fa-comments",   label: "المحادثات",        hint: "شاشة", run: function () { go("inbox"); } },
    { icon: "fa-chart-simple", label: "اللوحة",         hint: "شاشة", run: function () { go("board"); } },
    { icon: "fa-receipt",    label: "الطلبات",          hint: "شاشة", run: function () { S.recordsTab = "orders"; go("records"); } },
    { icon: "fa-calendar-check", label: "الحجوزات",     hint: "شاشة", run: function () { S.recordsTab = "bookings"; go("records"); } },
    { icon: "fa-bullhorn",   label: "الحملات",          hint: "شاشة", run: function () { go("campaigns"); } },
    { icon: "fa-wand-magic-sparkles", label: "الأتمتة", hint: "شاشة", run: function () { go("rules"); } },
    { icon: "fa-sliders",    label: "الإعدادات",        hint: "شاشة", run: function () { go("settings"); } },
    { icon: "fa-file-export", label: "تصدير جهات الاتصال والمجموعات", hint: "شاشة", run: function () { go("export"); } },
    { icon: "fa-plus",       label: "تسجيل طلب جديد",   hint: "أمر", run: newOrderSheet },
    { icon: "fa-calendar-plus", label: "حجز موعد جديد", hint: "أمر", run: newBookingSheet },
    { icon: "fa-wand-magic-sparkles", label: "قاعدة ردّ جديدة", hint: "أمر", run: newRuleSheet },
    { icon: "fa-circle-half-stroke", label: "تبديل المظهر", hint: "أمر", run: toggleTheme },
    { icon: "fa-robot",      label: "تشغيل / إيقاف الردّ الآلي", hint: "أمر", run: function () {
        var t = $("botToggle"); t.checked = !t.checked; t.dispatchEvent(new Event("change"));
      } }
  ];

  function openPalette() {
    pal.open = true;
    $("palette").classList.add("open");
    $("paletteScrim").classList.add("open");
    var inp = $("paletteInput");
    inp.value = ""; inp.focus();
    renderPalette("");
  }

  function closePalette() {
    pal.open = false;
    $("palette").classList.remove("open");
    $("paletteScrim").classList.remove("open");
  }

  function renderPalette(q) {
    q = (q || "").trim().toLowerCase();
    var items = [];

    var cmds = COMMANDS.filter(function (c) { return !q || c.label.toLowerCase().indexOf(q) > -1; });
    var qDigits = q.replace(/\D/g, "");
    var contacts = S.contacts.filter(function (c) {
      if (!q) return false;
      var n = displayName(c).toLowerCase();
      if (n.indexOf(q) > -1) return true;
      return qDigits.length >= 3 && cleanPhone(c.phone, c.jid).indexOf(qDigits) > -1;
    }).slice(0, 6);

    var html = "";
    if (contacts.length) {
      html += '<div class="palette-sec">محادثات</div>';
      contacts.forEach(function (c) {
        items.push({ run: function () { go("inbox"); openContact(c.jid); } });
        html += '<button class="palette-item" data-i="' + (items.length - 1) + '"' +
          (items.length === 1 ? ' aria-selected="true"' : "") + ">" +
          '<span class="avatar sm">' + esc(initial(c)) + "</span>" +
          '<span class="grow"><span class="lb" style="display:block">' + esc(displayName(c)) + "</span>" +
          '<span class="sb">' + esc((c.last_message || "").slice(0, 44)) + "</span></span>" +
          '<span class="hint">فتح</span></button>';
      });
    }
    if (cmds.length) {
      html += '<div class="palette-sec">أوامر</div>';
      cmds.forEach(function (c) {
        items.push({ run: c.run });
        html += '<button class="palette-item" data-i="' + (items.length - 1) + '"' +
          (items.length === 1 ? ' aria-selected="true"' : "") + ">" +
          '<span class="avatar sm event"><i class="fa-solid ' + c.icon + '"></i></span>' +
          '<span class="grow"><span class="lb">' + esc(c.label) + "</span></span>" +
          '<span class="hint">' + esc(c.hint) + "</span></button>";
      });
    }
    if (!items.length) html = '<div class="empty" style="padding:32px"><p>مفيش نتائج لـ «' + esc(q) + "»</p></div>";

    pal.items = items; pal.idx = 0;
    $("paletteList").innerHTML = html;
  }

  function movePalette(dir) {
    var els = $("paletteList").querySelectorAll(".palette-item");
    if (!els.length) return;
    els[pal.idx] && els[pal.idx].removeAttribute("aria-selected");
    pal.idx = (pal.idx + dir + els.length) % els.length;
    els[pal.idx].setAttribute("aria-selected", "true");
    els[pal.idx].scrollIntoView({ block: "nearest" });
  }

  function runPalette(i) {
    var it = pal.items[i];
    closePalette();
    if (it && it.run) setTimeout(it.run, 60);
  }

  /* ======================================================================
     14 · التنقّل بين الشاشات
     ====================================================================== */

  function go(view) {
    S.view = view;
    document.querySelectorAll(".rail-btn").forEach(function (b) {
      b.setAttribute("aria-current", String(b.getAttribute("data-view") === view));
    });
    transition(function () {
      if (view === "inbox") {
        replaceStack(S.activeContact ? [inboxPanel(), threadPanel()] : [inboxPanel(), threadPanel()]);
      } else if (view === "board") {
        replaceStack([boardPanel()]);
        fetchAnalytics();
      } else if (view === "records") {
        replaceStack([recordsPanel()]);
        fetchOrders(); fetchBookings();
      } else if (view === "campaigns") {
        replaceStack([campaignsPanel()]);
        fetchCampaigns(); fetchPresets();
      } else if (view === "rules") {
        replaceStack([rulesPanel()]);
        fetchRules();
      } else if (view === "settings") {
        replaceStack([settingsPanel()]);
        fetchSettings().then(function () {
          var f = $("setSheet");
          if (f && S.settings) f.value = S.settings.googleSheetWebhookUrl || "";
        });
      } else if (view === "export") {
        replaceStack([exportPanel()]);
      }
    });
  }

  /* ======================================================================
     15 · الثيم
     ====================================================================== */

  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") || "system";
  }

  function setTheme(t) {
    if (t === "system") { document.documentElement.removeAttribute("data-theme"); }
    else { document.documentElement.setAttribute("data-theme", t); }
    try { localStorage.setItem("wapro.theme", t); } catch (e) {}
    syncThemeSeg();
    setTimeout(drawCharts, 60);
  }

  function toggleTheme() {
    var sysDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    var cur = currentTheme();
    var eff = cur === "system" ? (sysDark ? "dark" : "light") : cur;
    setTheme(eff === "dark" ? "light" : "dark");
  }

  function syncThemeSeg() {
    var seg = $("themeSeg");
    if (!seg) return;
    var cur = currentTheme();
    seg.querySelectorAll("[data-theme-set]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-theme-set") === cur));
    });
  }

  /* ======================================================================
     16 · الأحداث العامة (تفويض واحد)
     ====================================================================== */

  document.addEventListener("click", function (e) {
    var t = e.target;

    /* رابط ميديا / لايت بوكس */
    var lb = t.closest("[data-lightbox]");
    if (lb) {
      e.preventDefault();
      var url = lb.getAttribute("data-lightbox");
      var box = document.createElement("div");
      box.className = "lightbox";
      box.innerHTML = '<img src="' + attr(url) + '" alt="">';
      box.addEventListener("click", function () { box.remove(); });
      document.body.appendChild(box);
      return;
    }

    /* الملاحة */
    var rail = t.closest(".rail-btn");
    if (rail) { go(rail.getAttribute("data-view")); return; }

    /* فتات السياق */
    var crumb = t.closest("[data-crumb]");
    if (crumb) { popTo(Number(crumb.getAttribute("data-crumb"))); return; }

    /* المحادثات */
    var contact = t.closest(".contact");
    if (contact) { openContact(contact.getAttribute("data-jid"), 1); return; }

    var chipEl = t.closest("[data-filter]");
    if (chipEl) {
      S.tagFilter = chipEl.getAttribute("data-filter");
      document.querySelectorAll("[data-filter]").forEach(function (c) {
        c.setAttribute("aria-pressed", String(c.getAttribute("data-filter") === S.tagFilter));
      });
      fetchContacts();
      return;
    }

    var tf = t.closest("[data-tfilter]");
    if (tf) {
      S.threadFilter = tf.getAttribute("data-tfilter");
      document.querySelectorAll("[data-tfilter]").forEach(function (c) {
        c.setAttribute("aria-pressed", String(c.getAttribute("data-tfilter") === S.threadFilter));
      });
      flipThread();
      return;
    }

    /* أحداث داخل الخيط */
    var oc = t.closest("[data-order]");
    if (oc) { openOrderSheet(oc.getAttribute("data-order")); return; }
    var bc = t.closest("[data-booking]");
    if (bc) { openBookingSheet(bc.getAttribute("data-booking")); return; }

    var openChat = t.closest("[data-open-chat]");
    if (openChat) {
      var ident = openChat.getAttribute("data-open-chat");
      var jid = ident.indexOf("@") > -1 ? ident : ident.replace(/\D/g, "") + "@s.whatsapp.net";
      go("inbox"); setTimeout(function () { openContact(jid); }, 80);
      return;
    }

    /* السجلات */
    var rec = t.closest("[data-rec]");
    if (rec) {
      S.recordsTab = rec.getAttribute("data-rec");
      replaceStack([recordsPanel()]);
      return;
    }
    var cb = t.closest("[data-cancel-booking]");
    if (cb) {
      var code = cb.getAttribute("data-cancel-booking"), tok = cb.getAttribute("data-token");
      confirmAsk("هيتلغي الحجز " + code + " وهيتبعت إيميل للعميل. متأكد؟", "إلغاء الحجز", "danger").then(function (ok) {
        if (!ok) return;
        api("/api/bookings/" + encodeURIComponent(code) + "/cancel", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cancelToken: tok })
        }).then(function (d) {
          if (d && d.success) { toast("الحجز اتلغى", "ok"); fetchBookings(); }
          else toast((d && d.error) || "فشل الإلغاء", "danger");
        });
      });
      return;
    }

    /* الحملات */
    var camp = t.closest("[data-campaign]");
    if (camp) { openCampaignLogs(camp.getAttribute("data-campaign")); return; }
    var cc = t.closest("[data-cc]");
    if (cc) {
      var act = cc.getAttribute("data-cc");
      if (act === "cancel") {
        confirmAsk("إلغاء الحملة نهائيًا؟", "إلغاء الحملة", "danger").then(function (ok) { if (ok) controlCampaign("cancel"); });
      } else controlCampaign(act);
      return;
    }
    var g = t.closest("[data-g]");
    if (g) { handleGroupAction(g.getAttribute("data-g")); return; }

    /* القواعد */
    var dr = t.closest("[data-del-rule]");
    if (dr) {
      confirmAsk("تحذف القاعدة دي؟", "حذف", "danger").then(function (ok) {
        if (!ok) return;
        api("/api/rules/" + dr.getAttribute("data-del-rule"), { method: "DELETE" })
          .then(function () { toast("القاعدة اتحذفت", "ok"); fetchRules(); });
      });
      return;
    }

    /* نسخ */
    var cp = t.closest("[data-copy]");
    if (cp) {
      navigator.clipboard.writeText(cp.getAttribute("data-copy"))
        .then(function () { toast("اتنسخ", "ok"); })
        .catch(function () { toast("المتصفح منع النسخ", "warn"); });
      return;
    }

    /* الثيم */
    var ts = t.closest("[data-theme-set]");
    if (ts) { setTheme(ts.getAttribute("data-theme-set")); return; }

    /* أوامر مسمّاة */
    var act2 = t.closest("[data-act]");
    if (act2) { handleAction(act2.getAttribute("data-act"), act2); return; }

    /* لوحة الأوامر */
    var pi = t.closest(".palette-item");
    if (pi) { runPalette(Number(pi.getAttribute("data-i"))); return; }
  });

  function handleAction(a, el) {
    switch (a) {
      case "refresh-contacts": fetchContacts(); toast("اتحدّثت", "ok"); break;
      case "refresh-analytics": fetchAnalytics(); break;
      case "profile": openProfile(); break;
      case "send-text": sendText(); break;
      case "send-voice": sendVoice(); break;
      case "new-order": newOrderSheet(); break;
      case "new-booking": newBookingSheet(); break;
      case "new-rule": newRuleSheet(); break;
      case "start-campaign": startCampaign(); break;
      case "go-records": S.recordsTab = "orders"; go("records"); break;
      case "go-bookings": S.recordsTab = "bookings"; go("records"); break;
      case "go-campaigns": go("campaigns"); break;
      case "save-notes": saveNotes(); break;
      case "save-profile": saveProfile(); break;
      case "save-settings": saveSettings(); break;
      case "export": doExport(el); break;
      case "logout": doLogout(); break;
      case "website-logout": doWebsiteLogout(); break;
      case "exp-extract": doExtract(); break;
      case "exp-copy": copyExtractNumbers(); break;
      case "exp-save-preset": saveExtractAsPreset(); break;
    }
  }

  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t.matches("[data-act='set-tag']")) {
      var tag = t.value;
      api("/api/contacts/" + encodeURIComponent(S.activeContact.jid) + "/tag", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag: tag })
      }).then(function () { S.activeContact.status_tag = tag; fetchContacts(); toast("التصنيف اتغيّر", "ok"); });
      return;
    }
    if (t.matches("[data-act='takeover']")) {
      var paused = t.checked;
      var wrap = t.closest(".takeover");
      if (wrap) {
        wrap.setAttribute("data-paused", paused ? 1 : 0);
        wrap.querySelector("span").textContent = paused ? "تدخّل بشري" : "البوت شغّال";
      }
      api("/api/contacts/" + encodeURIComponent(S.activeContact.jid) + "/toggle-bot", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: paused })
      }).then(function () {
        S.activeContact.bot_paused = paused ? 1 : 0;
        toast(paused ? "البوت اتوقف للعميل ده" : "البوت رجع يشتغل", "ok");
      });
      return;
    }
    if (t.matches("[data-act='quick']")) {
      var ta = $("composerInput");
      if (ta && t.value) { ta.value = t.value; ta.focus(); t.value = ""; }
      return;
    }
    if (t.matches("[data-order-status]")) {
      var id = t.getAttribute("data-order-status");
      api("/api/orders/" + id + "/status", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: t.value })
      }).then(function () { toast("حالة الطلب اتحدّثت", "ok"); fetchOrders(); })
        .catch(function (err) { toast(err.message, "danger"); });
      return;
    }
    if (t.matches("[data-group]")) {
      var jid = t.getAttribute("data-group");
      if (t.checked) S.selectedGroups.add(jid); else S.selectedGroups.delete(jid);
      var cnt = $("cGroupsCount");
      if (cnt) cnt.textContent = "(" + S.selectedGroups.size + " من " + S.groups.length + ")";
      return;
    }
  });

  function handleGroupAction(a) {
    if (a === "all") { S.groups.forEach(function (g) { S.selectedGroups.add(g.jid); }); renderGroups($("cGroupSearch").value); }
    else if (a === "none") { S.selectedGroups.clear(); renderGroups($("cGroupSearch").value); }
    else if (a === "invert") {
      S.groups.forEach(function (g) {
        if (S.selectedGroups.has(g.jid)) S.selectedGroups.delete(g.jid); else S.selectedGroups.add(g.jid);
      });
      renderGroups($("cGroupSearch").value);
    }
    else if (a === "refresh") { fetchGroups(true).then(function () { renderGroups($("cGroupSearch").value); toast("قائمة المجموعات اتحدّثت", "ok"); }); }
    else if (a === "clear-img") { $("cImage").value = ""; }
    else if (a === "save") {
      var name = $("cPresetName").value.trim();
      if (!name) return toast("اكتب اسم للقائمة.", "warn");
      if (!S.selectedGroups.size) return toast("اختار مجموعات الأول.", "warn");
      api("/api/audience-presets", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name, type: "groups", targetJids: Array.from(S.selectedGroups), excludedJids: [] })
      }).then(function () { $("cPresetName").value = ""; toast("القائمة اتحفظت", "ok"); fetchPresets(); });
    }
    else if (a === "delete") {
      if (!S.activePresetId) return;
      confirmAsk("تحذف القائمة المحفوظة دي؟", "حذف", "danger").then(function (ok) {
        if (!ok) return;
        api("/api/audience-presets/" + S.activePresetId, { method: "DELETE" })
          .then(function () { S.activePresetId = null; toast("القائمة اتحذفت", "ok"); fetchPresets(); });
      });
    }
  }

  function saveNotes() {
    var v = $("profNotes").value;
    api("/api/contacts/" + encodeURIComponent(S.activeContact.jid) + "/notes", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: v })
    }).then(function () { S.activeContact.custom_notes = v; toast("الملاحظات اتحفظت", "ok"); });
  }

  function saveProfile() {
    var body = {
      name: $("profName").value.trim(),
      phone: $("profPhone").value.trim(),
      status_tag: S.activeContact.status_tag || "new",
      city: "",
      address: $("profAddr").value.trim(),
      custom_notes: $("profNotes") ? $("profNotes").value : (S.activeContact.custom_notes || "")
    };
    api("/api/contacts/" + encodeURIComponent(S.activeContact.jid) + "/profile", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (d) {
      if (d && d.success) {
        Object.assign(S.activeContact, body);
        toast("البيانات اتحفظت", "ok");
        fetchContacts();
      } else toast((d && d.error) || "فشل الحفظ", "danger");
    });
  }

  function saveSettings() {
    api("/api/settings", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ googleSheetWebhookUrl: $("setSheet").value.trim() })
    }).then(function (d) {
      if (d && d.success) toast("الإعدادات اتحفظت", "ok");
      else toast("فشل الحفظ", "danger");
    });
  }

  function doExport(btn) {
    var tag = $("expTag").value, grp = $("expGroup").value;
    btn.disabled = true;
    api("/api/export/contacts?tag=" + encodeURIComponent(tag) + "&groupJid=" + encodeURIComponent(grp))
      .then(function (d) {
        if (d && d.success && d.data && d.data.length) {
          var blob = new Blob([JSON.stringify(d.data, null, 2)], { type: "application/json" });
          var url = URL.createObjectURL(blob);
          var a = document.createElement("a");
          a.href = url; a.download = "contacts_" + Date.now() + ".json";
          document.body.appendChild(a); a.click(); a.remove();
          URL.revokeObjectURL(url);
          toast("اتصدّرت " + d.count + " جهة اتصال", "ok");
        } else toast("مفيش بيانات مطابقة.", "warn");
      })
      .catch(function (e) { toast(e.message, "danger"); })
      .finally(function () { btn.disabled = false; });
  }

  function doLogout() {
    confirmAsk("هيتفصل الجهاز وهتحتاج تمسح كود QR من تاني. متأكد؟", "فصل الجهاز", "danger").then(function (ok) {
      if (ok) api("/api/logout", { method: "POST" });
    });
  }

  function openOrderSheet(id) {
    var o = null;
    (S.orders || []).forEach(function (x) { if (String(x.id) === String(id)) o = x; });
    if (!o && S.activeContact && S.activeContact._details) {
      (S.activeContact._details.orders || []).forEach(function (x) { if (String(x.id) === String(id)) o = x; });
    }
    if (!o) return;
    openSheet({
      title: "الطلب #" + o.id,
      body:
        '<div class="kv"><span class="k">العميل</span><span class="v">' + esc(o.customer_name || "-") + "</span></div>" +
        '<div class="kv"><span class="k">الرقم</span><span class="v mono" dir="ltr">' + esc(o.phone || "-") + "</span></div>" +
        '<div class="kv"><span class="k">التفاصيل</span><span class="v">' + esc(o.order_details || "-") + "</span></div>" +
        '<div class="kv"><span class="k">العنوان</span><span class="v">' + esc(o.address || "-") + "</span></div>" +
        '<div class="kv"><span class="k">الإجمالي</span><span class="v">' + esc(money(o.total_price)) + "</span></div>" +
        '<div class="kv"><span class="k">التاريخ</span><span class="v">' + esc(fmtDateTime(o.created_at)) + "</span></div>" +
        '<div class="field" style="margin-top:16px"><label>الحالة</label>' +
          '<select data-order-status="' + attr(o.id) + '">' +
          Object.keys(ORDER_STATUS).map(function (k) {
            return '<option value="' + k + '"' + ((o.status || "pending") === k ? " selected" : "") + ">" + esc(ORDER_STATUS[k]) + "</option>";
          }).join("") + "</select></div>",
      foot: '<button class="btn" data-x="close">إغلاق</button>',
      onFoot: function () { closeSheet(); }
    });
  }

  function openBookingSheet(code) {
    var b = null;
    var pool = (S.bookings || []).concat((S.activeContact && S.activeContact._details && S.activeContact._details.bookings) || []);
    pool.forEach(function (x) { if ((x.reference_code || x.referenceCode) === code) b = x; });
    if (!b) return;
    var cancelled = b.status === "CANCELLED";
    openSheet({
      title: "الحجز " + code,
      body:
        '<div class="kv"><span class="k">العميل</span><span class="v">' + esc(b.customer_name || b.customerName || "-") + "</span></div>" +
        '<div class="kv"><span class="k">الرقم</span><span class="v mono" dir="ltr">' + esc(b.customer_phone || b.customerPhone || "-") + "</span></div>" +
        '<div class="kv"><span class="k">الإيميل</span><span class="v mono" dir="ltr">' + esc(b.customer_email || b.customerEmail || "-") + "</span></div>" +
        '<div class="kv"><span class="k">الموعد</span><span class="v">' + esc(fmtDateTime(b.start_time || b.startTime)) + "</span></div>" +
        '<div class="kv"><span class="k">الحالة</span><span class="v">' + (cancelled ? "ملغي" : "مؤكَّد") + "</span></div>" +
        '<div class="kv"><span class="k">ملاحظات</span><span class="v">' + esc(b.notes || "-") + "</span></div>",
      foot: '<button class="btn" data-x="close">إغلاق</button>' +
            (cancelled ? "" : '<button class="btn btn-danger" data-x="cancel">إلغاء الحجز</button>'),
      onFoot: function (a) {
        if (a === "close") return closeSheet();
        closeSheet(true);
        api("/api/bookings/" + encodeURIComponent(code) + "/cancel", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cancelToken: b.cancel_token || b.cancelToken })
        }).then(function (d) {
          if (d && d.success) { toast("الحجز اتلغى", "ok"); fetchBookings(); }
          else toast((d && d.error) || "فشل الإلغاء", "danger");
        });
      }
    });
  }

  /* FLIP — إعادة ترتيب الخيط بحركة بدل قفزة */
  function flipThread() {
    var body = $("threadBody");
    if (!body) return;
    if (RM) { refreshThread(false); return; }
    var before = {};
    body.querySelectorAll("[data-flip-key]").forEach(function (el) {
      before[el.getAttribute("data-flip-key")] = el.getBoundingClientRect().top;
    });
    var prevScroll = body.scrollTop;
    refreshThread(false);
    body.scrollTop = prevScroll;
    var kids = body.children;
    for (var i = 0; i < kids.length; i++) {
      (function (el, idx) {
        el.animate(
          [{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }],
          { duration: 260, delay: Math.min(idx * 14, 140), easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" }
        );
      })(kids[i], i);
    }
  }

  /* ======================================================================
     17 · اختصارات الكيبورد
     ====================================================================== */

  document.addEventListener("keydown", function (e) {
    var mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      pal.open ? closePalette() : openPalette();
      return;
    }
    if (e.key === "Escape") {
      if (pal.open) { closePalette(); return; }
      if ($("sheet").classList.contains("open")) { closeSheet(); return; }
      var floor = S.view === "inbox" ? 2 : 1;   /* الإنبوكس بيفضل دايمًا قايمة + خيط */
      if (stack.length > floor) { popTo(stack.length - 2); return; }
    }
    if (pal.open) {
      if (e.key === "ArrowDown") { e.preventDefault(); movePalette(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); movePalette(-1); }
      else if (e.key === "Enter") { e.preventDefault(); runPalette(pal.idx); }
    }
  });

  $("omniBtn").addEventListener("click", openPalette);
  $("paletteScrim").addEventListener("click", closePalette);
  $("paletteInput").addEventListener("input", function (e) { renderPalette(e.target.value); });
  $("themeBtn").addEventListener("click", toggleTheme);
  $("logoutBtn").addEventListener("click", doLogout);

  $("conn").addEventListener("click", function () {
    if (S.connState === "disconnected" || S.connState === "close") {
      setConnState({ status: "connecting" });
      api("/api/connect", { method: "POST" })
        .then(function (res) {
          if (res && res.status) setConnState(res);
        })
        .catch(function (err) {
          toast("تعذر إعادة الاتصال: " + (err.message || err), "warn");
        });
    }
  });

  $("botToggle").addEventListener("change", function (e) {
    var on = e.target.checked;
    $("botLabel").textContent = on ? "الردّ الآلي" : "الردّ موقوف";
    api("/api/bot/toggle", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: on })
    }).then(function () { toast(on ? "الردّ الآلي اشتغل" : "الردّ الآلي اتوقف", on ? "ok" : "warn"); });
  });

  /* ======================================================================
     18 · PULSE — Socket.io
     ====================================================================== */

  socket.on("connect_error", function (err) {
    if (err && /unauthorized/i.test(err.message || "")) {
      socket.io.opts.reconnection = false; // مفيش فايدة نحاول تاني قبل ما تسجّل دخول
    }
  });

  socket.on("initial_state", function (d) {
    if (!d) return;
    if (d.state) setConnState(d.state);
    if (d.contacts) { S.contacts = d.contacts; refreshContactsList(); }
    if (d.rules) { S.rules = d.rules; var b = $("rulesBody"); if (b) b.innerHTML = rulesHtml(); }
    if (d.analytics) {
      S.analytics = d.analytics;
      tweenNum($("kpiMessages"), d.analytics.totalMessages || 0);
      tweenNum($("kpiContacts"), d.analytics.totalContacts || 0);
      tweenNum($("kpiAuto"), d.analytics.totalAutoReplied || 0);
      if ($("chartActivity")) drawCharts();
    }
    if (d.botEnabled !== undefined) $("botToggle").checked = !!d.botEnabled;
  });

  socket.on("status_change", setConnState);

  socket.on("new_message", function (msg) {
    if (!msg) return;
    if (S.activeJid && msg.sender === S.activeJid) {
      var isAi = Number(msg.autoReplied || msg.auto_replied) === 1;
      var fromMe = Number(msg.fromMe || msg.from_me) === 1;
      S.threadEvents.push({
        kind: "msg",
        sub: isAi ? "ai" : (fromMe ? "out" : "in"),
        media: !!(msg.media_url || msg.mediaUrl),
        ts: Number(msg.timestamp) || Date.now(),
        data: msg
      });
      refreshThread();
    }
    fetchContacts();
    fetchAnalytics();
  });

  socket.on("contact_updated", fetchContacts);

  socket.on("contact_avatar_updated", function (d) {
    if (!d || !d.jid || !d.avatar_url) return;
    S.contacts.forEach(function (c) { if (c.jid === d.jid) c.avatar_url = d.avatar_url; });
    if (S.activeContact && S.activeContact.jid === d.jid) S.activeContact.avatar_url = d.avatar_url;
    refreshContactsList();
  });

  socket.on("new_order", function () {
    fetchOrders(); fetchAnalytics();
    toast("وصل طلب جديد", "ok");
    if (S.activeJid) reloadThreadRecords();
  });

  socket.on("new_booking", function () {
    fetchBookings(); fetchAnalytics();
    toast("اتسجّل حجز جديد", "ok");
    if (S.activeJid) reloadThreadRecords();
  });

  socket.on("booking_cancelled", function () { fetchBookings(); fetchAnalytics(); });

  socket.on("campaign_progress", function (d) {
    if (!d) return;
    var box = $("cProgress");
    if (box) {
      box.classList.remove("hidden");
      var coolingBox = $("cCoolingAlert");
      if (d.status === "cooling") {
        if (coolingBox) coolingBox.classList.remove("hidden");
        var mins = Math.ceil((d.remainingSeconds || 0) / 60);
        $("cProgressText").innerHTML = '<span style="color:var(--warn,#f59e0b)"><i class="fa-solid fa-hourglass-half"></i> فترة راحة أمان: متبقي ~' + mins + ' دقيقة (أرسل ' + d.sentCount + ' من ' + d.total + ')</span>';
      } else {
        if (coolingBox) coolingBox.classList.add("hidden");
        $("cProgressText").textContent = "تم " + d.sentCount + " · فشل " + d.failedCount + " · من " + d.total;
      }
      $("cProgressPct").textContent = d.percent + "%";
      $("cProgressBar").style.width = d.percent + "%";
      box.setAttribute("data-done", d.percent >= 100 ? "1" : "0");
    }
    var bBar = $("boardProgressBar");
    if (bBar) {
      bBar.style.width = d.percent + "%";
      $("boardProgressText").textContent = "تم " + d.sentCount + " من " + d.total;
      $("boardProgressPct").textContent = d.percent + "%";
    }
    if (d.status === "completed" || d.status === "cancelled") {
      var coolingBox = $("cCoolingAlert");
      if (coolingBox) coolingBox.classList.add("hidden");
      toast("الحملة " + (d.status === "completed" ? "اكتملت" : "اتلغت") + " · " + d.sentCount + " ناجحة، " + d.failedCount + " فشلت",
            d.status === "completed" ? "ok" : "warn");
      fetchCampaigns();
    }
  });

  socket.on("campaign_status_changed", function (d) {
    if (!d) return;
    if (String(d.campaignId) === String(S.activeCampaignId)) {
      var p = document.querySelector('[data-cc="pause"]'), r = document.querySelector('[data-cc="resume"]');
      if (p && r) {
        p.classList.toggle("hidden", d.status === "paused");
        r.classList.toggle("hidden", d.status !== "paused");
      }
    }
    fetchCampaigns();
  });

  socket.on("rules_updated", function (d) {
    if (!d) return;
    if (d.rules) { S.rules = d.rules; var b = $("rulesBody"); if (b) b.innerHTML = rulesHtml(); }
    if (d.botEnabled !== undefined) {
      $("botToggle").checked = !!d.botEnabled;
      $("botLabel").textContent = d.botEnabled ? "الردّ الآلي" : "الردّ موقوف";
    }
  });

  socket.on("audience_presets_updated", fetchPresets);

  function reloadThreadRecords() {
    var jid = S.activeJid;
    api("/api/contacts/" + encodeURIComponent(jid) + "/details").then(function (det) {
      if (!det || S.activeJid !== jid) return;
      S.activeContact._details = det;
      var msgs = S.threadEvents.filter(function (e) { return e.kind === "msg"; }).map(function (e) { return e.data; });
      S.threadEvents = buildThread(msgs, det.orders, det.bookings);
      refreshThread();
    }).catch(function () {});
  }

  /* ======================================================================
     19 · الإقلاع
     ====================================================================== */

  function boot() {
    go("inbox");
    fetchContacts();
    fetchOrders();
    fetchBookings();
    fetchAnalytics();
    fetchRules();
    fetchSettings();
    fetchPresets();
    syncThemeSeg();
    pollStatusOnce();
    setTimeout(pollStatusOnce, 2500);
  }

  /* ======================================================================
     20 · تسجيل الدخول بحساب الموقع
     كل شيء (شات واتساب، جهات اتصال، إلخ) مربوط بحساب مسجَّل بإيميل/باسورد،
     عشان كل واحد يشوف بياناته هو بس، وعشان جلسة واتساب تفضل محفوظة
     مع الحساب مش مع المتصفح.
     ====================================================================== */

  function $auth() { return document.getElementById("authOverlay"); }

  function showAuthOverlay(mode) {
    var ov = $auth();
    if (!ov) return;
    ov.classList.remove("hidden");
    document.querySelector(".app").classList.add("hidden");
    setAuthMode(mode || "login");
  }

  function hideAuthOverlay() {
    var ov = $auth();
    if (!ov) return;
    ov.classList.add("hidden");
    document.querySelector(".app").classList.remove("hidden");
  }

  function setAuthMode(mode) {
    var ov = $auth();
    if (!ov) return;
    ov.setAttribute("data-mode", mode);
    var err = document.getElementById("authError");
    if (err) { err.textContent = ""; err.classList.add("hidden"); }
    var nameField = document.getElementById("authNameField");
    if (nameField) nameField.classList.toggle("hidden", mode !== "register");
    var title = document.getElementById("authTitle");
    if (title) title.textContent = mode === "register" ? "إنشاء حساب جديد" : "تسجيل الدخول";
    var submitBtn = document.getElementById("authSubmit");
    if (submitBtn) submitBtn.textContent = mode === "register" ? "إنشاء الحساب" : "دخول";
    var switchLbl = document.getElementById("authSwitchLabel");
    if (switchLbl) {
      switchLbl.innerHTML = mode === "register"
        ? 'عندك حساب؟ <button type="button" class="link-btn" id="authSwitchBtn">سجّل دخولك</button>'
        : 'مفيش حساب؟ <button type="button" class="link-btn" id="authSwitchBtn">اعمل حساب جديد</button>';
    }
  }

  function authErr(msg) {
    var err = document.getElementById("authError");
    if (err) { err.textContent = msg; err.classList.remove("hidden"); }
  }

  document.addEventListener("submit", function (e) {
    if (e.target && e.target.id === "authForm") {
      e.preventDefault();
      var ov = $auth();
      var mode = ov ? ov.getAttribute("data-mode") : "login";
      var email = (document.getElementById("authEmail") || {}).value || "";
      var password = (document.getElementById("authPassword") || {}).value || "";
      var displayName = (document.getElementById("authName") || {}).value || "";
      var btn = document.getElementById("authSubmit");
      if (btn) btn.disabled = true;
      var url = mode === "register" ? "/api/auth/register" : "/api/auth/login";
      fetch(url, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email, password: password, displayName: displayName })
      }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          if (btn) btn.disabled = false;
          if (!res.ok) { authErr((res.d && res.d.error) || "حصل خطأ، حاول تاني."); return; }
          S.account = res.d.user;
          hideAuthOverlay();
          toast("أهلاً " + (res.d.user.displayName || res.d.user.email) + "!", "ok");
          location.reload();
        }).catch(function () {
          if (btn) btn.disabled = false;
          authErr("فشل الاتصال بالسيرفر.");
        });
    }
  });

  document.addEventListener("click", function (e) {
    if (e.target && e.target.id === "authSwitchBtn") {
      var ov = $auth();
      var mode = ov ? ov.getAttribute("data-mode") : "login";
      setAuthMode(mode === "register" ? "login" : "register");
    }
  });

  function checkAuthAndBoot() {
    fetch("/api/auth/me", { credentials: "include" }).then(function (r) {
      if (r.status === 401) { showAuthOverlay("login"); return null; }
      return r.json();
    }).then(function (d) {
      if (!d || !d.success) return;
      S.account = d.user;
      var emailEl = document.getElementById("accountEmail");
      if (emailEl) emailEl.textContent = d.user.email;
      hideAuthOverlay();
      boot();
    }).catch(function () {
      // مفيش اتصال بالسيرفر - جرّب توصل بيانات الأوفلاين لو موجودة، وإلا سيب شاشة الدخول
      showAuthOverlay("login");
    });
  }

  function doWebsiteLogout() {
    confirmAsk("هيتسجّل خروجك من الحساب على الجهاز ده. متأكد؟", "تسجيل الخروج", "danger").then(function (ok) {
      if (!ok) return;
      fetch("/api/auth/logout", { method: "POST", credentials: "include" }).then(function () {
        location.reload();
      });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", checkAuthAndBoot);
  else checkAuthAndBoot();

})();
