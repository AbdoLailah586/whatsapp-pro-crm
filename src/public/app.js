// ==========================================
// WhatsApp Pro Enterprise AI CRM & Automation App
// ==========================================

const socket = io();

// State
let appState = {
  status: "disconnected",
  user: null,
  botEnabled: true,
  contacts: [],
  activeChatJid: null,
  activeContact: null,
  messages: [],
  orders: [],
  bookings: [],
  campaigns: [],
  analytics: null,
  rules: [],
  activityChart: null,
  tagsChart: null,
  searchQuery: "",
  activeFilter: "all",
};

// DOM Elements
const elements = {
  // Status
  statusDot: document.getElementById("statusDot"),
  statusLabel: document.getElementById("statusLabel"),
  userPhone: document.getElementById("userPhone"),
  logoutBtn: document.getElementById("logoutBtn"),
  globalBotToggle: document.getElementById("globalBotToggle"),
  botStatusText: document.getElementById("botStatusText"),
  qrOverlay: document.getElementById("qrOverlay"),
  qrImage: document.getElementById("qrImage"),
  qrLoader: document.getElementById("qrLoader"),

  // Navigation
  navItems: document.querySelectorAll(".nav-item"),
  tabPanels: document.querySelectorAll(".tab-panel"),
  inboxUnreadBadge: document.getElementById("inboxUnreadBadge"),
  ordersBadge: document.getElementById("ordersBadge"),

  // Inbox
  contactsList: document.getElementById("contactsList"),
  contactSearchInput: document.getElementById("contactSearchInput"),
  tagFilterPills: document.querySelectorAll(".tag-filter-pills .pill"),
  chatEmptyView: document.getElementById("chatEmptyView"),
  chatActiveView: document.getElementById("chatActiveView"),
  activeChatAvatar: document.getElementById("activeChatAvatar"),
  activeChatName: document.getElementById("activeChatName"),
  activeChatPhone: document.getElementById("activeChatPhone"),
  activeChatTagSelect: document.getElementById("activeChatTagSelect"),
  takeoverToggle: document.getElementById("takeoverToggle"),
  takeoverStatusText: document.getElementById("takeoverStatusText"),
  chatNotesBtn: document.getElementById("chatNotesBtn"),
  messagesContainer: document.getElementById("messagesContainer"),
  chatTextInput: document.getElementById("chatTextInput"),
  sendTextBtn: document.getElementById("sendTextBtn"),
  sendVoiceBtn: document.getElementById("sendVoiceBtn"),
  quickRepliesSelect: document.getElementById("quickRepliesSelect"),

  // Orders
  ordersTableBody: document.getElementById("ordersTableBody"),
  addNewOrderBtn: document.getElementById("addNewOrderBtn"),
  addOrderModal: document.getElementById("addOrderModal"),
  closeAddOrderModalBtn: document.getElementById("closeAddOrderModalBtn"),
  cancelAddOrderBtn: document.getElementById("cancelAddOrderBtn"),
  submitAddOrderBtn: document.getElementById("submitAddOrderBtn"),

  // Bookings & Appointments
  bookingsBadge: document.getElementById("bookingsBadge"),
  bookingsTableBody: document.getElementById("bookingsTableBody"),
  openNewBookingModalBtn: document.getElementById("openNewBookingModalBtn"),
  addBookingModal: document.getElementById("addBookingModal"),
  closeAddBookingModalBtn: document.getElementById("closeAddBookingModalBtn"),
  cancelAddBookingBtn: document.getElementById("cancelAddBookingBtn"),
  submitAddBookingBtn: document.getElementById("submitAddBookingBtn"),
  newBookingDate: document.getElementById("newBookingDate"),
  newBookingSlotSelect: document.getElementById("newBookingSlotSelect"),

  // Campaigns
  campaignTitle: document.getElementById("campaignTitle"),
  campaignAudienceSelect: document.getElementById("campaignAudienceSelect"),
  customNumbersGroup: document.getElementById("customNumbersGroup"),
  campaignCustomNumbers: document.getElementById("campaignCustomNumbers"),
  campaignTemplate: document.getElementById("campaignTemplate"),
  campaignDelay: document.getElementById("campaignDelay"),
  startCampaignBtn: document.getElementById("startCampaignBtn"),
  campaignProgressBox: document.getElementById("campaignProgressBox"),
  campaignProgressText: document.getElementById("campaignProgressText"),
  campaignProgressPercent: document.getElementById("campaignProgressPercent"),
  campaignProgressBar: document.getElementById("campaignProgressBar"),
  campaignsHistoryList: document.getElementById("campaignsHistoryList"),

  // Analytics
  statTotalContacts: document.getElementById("statTotalContacts"),
  statTotalMessages: document.getElementById("statTotalMessages"),
  statTotalAutoReplies: document.getElementById("statTotalAutoReplies"),
  statTotalOrders: document.getElementById("statTotalOrders"),
  refreshAnalyticsBtn: document.getElementById("refreshAnalyticsBtn"),

  // Rules
  rulesContainer: document.getElementById("rulesContainer"),
  openAddRuleModalBtn: document.getElementById("openAddRuleModalBtn"),
  addRuleModal: document.getElementById("addRuleModal"),
  closeAddRuleModalBtn: document.getElementById("closeAddRuleModalBtn"),
  cancelAddRuleBtn: document.getElementById("cancelAddRuleBtn"),
  submitAddRuleBtn: document.getElementById("submitAddRuleBtn"),

  // Notes Modal
  notesModal: document.getElementById("notesModal"),
  closeNotesModalBtn: document.getElementById("closeNotesModalBtn"),
  cancelNotesBtn: document.getElementById("cancelNotesBtn"),
  saveNotesBtn: document.getElementById("saveNotesBtn"),
  contactNotesTextarea: document.getElementById("contactNotesTextarea"),

  // Edit Contact Modal
  editContactBtn: document.getElementById("editContactBtn"),
  editContactModal: document.getElementById("editContactModal"),
  closeEditContactModalBtn: document.getElementById("closeEditContactModalBtn"),
  cancelEditContactBtn: document.getElementById("cancelEditContactBtn"),
  saveEditContactBtn: document.getElementById("saveEditContactBtn"),
  editContactName: document.getElementById("editContactName"),
  editContactPhone: document.getElementById("editContactPhone"),
  editContactTag: document.getElementById("editContactTag"),
  editContactCity: document.getElementById("editContactCity"),
  editContactAddress: document.getElementById("editContactAddress"),
  editContactNotes: document.getElementById("editContactNotes"),

  // Contact Profile Details Modal (Popup)
  viewContactProfileBtn: document.getElementById("viewContactProfileBtn"),
  contactProfileModal: document.getElementById("contactProfileModal"),
  closeContactProfileModalBtn: document.getElementById("closeContactProfileModalBtn"),
  cancelContactProfileBtn: document.getElementById("cancelContactProfileBtn"),
  drawerAvatar: document.getElementById("drawerAvatar"),
  drawerAvatarLetter: document.getElementById("drawerAvatarLetter"),
  drawerAvatarImg: document.getElementById("drawerAvatarImg"),
  drawerName: document.getElementById("drawerName"),
  drawerPhone: document.getElementById("drawerPhone"),
  drawerBio: document.getElementById("drawerBio"),
  drawerBioBox: document.getElementById("drawerBioBox"),
  drawerWhatsAppLink: document.getElementById("drawerWhatsAppLink"),
  drawerEditBtn: document.getElementById("drawerEditBtn"),
  drawerTagBadge: document.getElementById("drawerTagBadge"),
  drawerOrdersCount: document.getElementById("drawerOrdersCount"),
  drawerTotalSpent: document.getElementById("drawerTotalSpent"),
  drawerLeadScore: document.getElementById("drawerLeadScore"),
  drawerAddress: document.getElementById("drawerAddress"),
  drawerNotes: document.getElementById("drawerNotes"),
  drawerOrdersTotalBadge: document.getElementById("drawerOrdersTotalBadge"),
  drawerOrdersList: document.getElementById("drawerOrdersList"),
  drawerBookingsTotalBadge: document.getElementById("drawerBookingsTotalBadge"),
  drawerBookingsList: document.getElementById("drawerBookingsList"),
  drawerGroupMsgsCard: document.getElementById("drawerGroupMsgsCard"),
  drawerGroupMsgsTotalBadge: document.getElementById("drawerGroupMsgsTotalBadge"),
  drawerGroupMsgsList: document.getElementById("drawerGroupMsgsList"),
  groupProfileSection: document.getElementById("groupProfileSection"),
  individualProfileSection: document.getElementById("individualProfileSection"),
  groupDescCard: document.getElementById("groupDescCard"),
  groupDescText: document.getElementById("groupDescText"),
  groupMembersCountBadge: document.getElementById("groupMembersCountBadge"),
  groupMemberSearchInput: document.getElementById("groupMemberSearchInput"),
  groupMembersList: document.getElementById("groupMembersList"),
  drawerMediaTotalBadge: document.getElementById("drawerMediaTotalBadge"),
  drawerMediaGallery: document.getElementById("drawerMediaGallery"),

  // Settings
  tunnelOrderWebhookUrl: document.getElementById("tunnelOrderWebhookUrl"),
  tunnelVoiceWebhookUrl: document.getElementById("tunnelVoiceWebhookUrl"),
  dbStatusBadge: document.getElementById("dbStatusBadge"),
};

// ==========================================
// Initialization & Socket Events
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
  setupNavigation();
  setupEventListeners();
  loadInitialData();
  updateWebhookUrls();
});

// Socket listeners
socket.on("initial_state", (data) => {
  if (data.state) updateConnectionState(data.state);
  if (data.contacts) {
    appState.contacts = data.contacts;
    renderContactsList();
  }
  if (data.rules) {
    appState.rules = data.rules;
    renderRules();
  }
  if (data.analytics) {
    appState.analytics = data.analytics;
    renderAnalytics();
  }
});

socket.on("status_change", (state) => {
  updateConnectionState(state);
});

socket.on("new_message", (msg) => {
  // If the message belongs to currently open active chat, append it!
  if (appState.activeContact && (msg.sender === appState.activeContact.jid)) {
    appendMessageToChat(msg);
    scrollChatToBottom();
  }
  // Refresh contacts to update last message & unread badge
  fetchContacts();
  fetchAnalytics();
});

socket.on("contact_updated", () => {
  fetchContacts();
});

socket.on("contact_avatar_updated", ({ jid, avatar_url }) => {
  if (!jid || !avatar_url) return;
  const contact = appState.contacts.find((c) => c.jid === jid);
  if (contact) {
    contact.avatar_url = avatar_url;
  }
  // Update sidebar contact avatar DOM immediately
  const sidebarAvatar = document.querySelector(`.contact-item[onclick*="${jid}"] .avatar`);
  if (sidebarAvatar) {
    sidebarAvatar.innerHTML = `<img src="${escapeHtml(avatar_url)}" class="avatar-img" alt="avatar" />`;
  }
  // If this contact is currently open in active chat, update header & modal immediately
  if (appState.activeContact && appState.activeContact.jid === jid) {
    appState.activeContact.avatar_url = avatar_url;
    if (elements.activeChatAvatar) {
      elements.activeChatAvatar.innerHTML = `<img src="${escapeHtml(avatar_url)}" class="avatar-img" alt="avatar" />`;
    }
    if (elements.drawerAvatarImg) {
      elements.drawerAvatarImg.src = avatar_url;
      elements.drawerAvatarImg.style.display = "block";
      if (elements.drawerAvatarLetter) elements.drawerAvatarLetter.style.display = "none";
    }
  }
});

socket.on("new_order", () => {
  fetchOrders();
  fetchAnalytics();
});

socket.on("new_booking", () => {
  fetchBookings();
  fetchAnalytics();
});

socket.on("booking_cancelled", () => {
  fetchBookings();
  fetchAnalytics();
});

socket.on("campaign_progress", (data) => {
  elements.campaignProgressBox.style.display = "block";
  elements.campaignProgressText.innerText = `جاري الإرسال: ${data.sentCount} تم، ${data.failedCount} فشل / إجمالي ${data.total}`;
  elements.campaignProgressPercent.innerText = `${data.percent}%`;
  elements.campaignProgressBar.style.width = `${data.percent}%`;

  if (data.status === "completed") {
    setTimeout(() => {
      alert("🎉 اكتمل إرسال الحملة التسويقية بنجاح!");
      fetchCampaigns();
    }, 1000);
  }
});

socket.on("rules_updated", (data) => {
  if (data.rules) {
    appState.rules = data.rules;
    renderRules();
  }
  if (data.botEnabled !== undefined) {
    elements.globalBotToggle.checked = data.botEnabled;
    elements.botStatusText.innerText = data.botEnabled ? "مفعل للرد التلقائي" : "متوقف مؤقتاً";
  }
});

// ==========================================
// Navigation & Tabs
// ==========================================
function setupNavigation() {
  elements.navItems.forEach((item) => {
    item.addEventListener("click", () => {
      const tabId = item.getAttribute("data-tab");
      
      // Update nav active
      elements.navItems.forEach((i) => i.classList.remove("active"));
      item.classList.add("active");

      // Show active tab
      elements.tabPanels.forEach((panel) => {
        panel.classList.remove("active");
        if (panel.id === tabId) panel.classList.add("active");
      });

      // Fetch tab specific data
      if (tabId === "ordersTab") fetchOrders();
      if (tabId === "bookingsTab") fetchBookings();
      if (tabId === "campaignsTab") fetchCampaigns();
      if (tabId === "analyticsTab") fetchAnalytics();
      if (tabId === "rulesTab") fetchRules();
      if (tabId === "settingsTab") loadSettings();
    });
  });
}

// ==========================================
// Connection & QR Handling
// ==========================================
function updateConnectionState(state) {
  appState.status = state.status;
  appState.user = state.user;

  if (state.botEnabled !== undefined) {
    elements.globalBotToggle.checked = state.botEnabled;
    elements.botStatusText.innerText = state.botEnabled ? "مفعل للرد التلقائي" : "متوقف مؤقتاً";
  }

  elements.statusDot.className = "status-indicator-dot " + (state.status || "disconnected");

  if (state.status === "connected") {
    elements.statusLabel.innerText = "متصل بنجاح";
    elements.userPhone.innerText = state.user?.name || state.user?.id?.split(":")[0] || "نشط";
    elements.logoutBtn.style.display = "block";
    elements.qrOverlay.style.display = "none";
  } else if (state.qr) {
    // Only show QR modal when an actual QR code is ready to scan
    elements.statusLabel.innerText = "بانتظار المسح";
    elements.userPhone.innerText = "امسح رمز QR";
    elements.logoutBtn.style.display = "none";
    elements.qrOverlay.style.display = "flex";
    elements.qrLoader.style.display = "none";
    elements.qrImage.src = state.qr;
    elements.qrImage.style.display = "block";
  } else {
    // Disconnected / Reconnecting in background without blocking screen
    elements.statusLabel.innerText = state.status === "connecting" ? "جاري الاتصال..." : "غير متصل";
    elements.userPhone.innerText = state.status === "connecting" ? "يرجى الانتظار" : "انقطع الاتصال";
    elements.logoutBtn.style.display = "none";
    elements.qrOverlay.style.display = "none";
    elements.qrLoader.style.display = "none";
    elements.qrImage.style.display = "none";
  }
}

// ==========================================
// Smart Inbox (CRM Contacts & Chat)
// ==========================================
async function fetchContacts() {
  try {
    const search = (appState.searchQuery || "").trim();
    const tag = (appState.activeFilter || "all").trim();
    const res = await fetch(`/api/contacts?search=${encodeURIComponent(search)}&tag=${encodeURIComponent(tag)}`);
    const data = await res.json();
    if (data.success) {
      appState.contacts = data.contacts;
      renderContactsList();
    }
  } catch (e) {
    console.error("fetchContacts error:", e);
  }
}

function renderContactsList() {
  if (!appState.contacts || appState.contacts.length === 0) {
    elements.contactsList.innerHTML = `
      <div class="empty-state">
        <i class="fa-regular fa-comments"></i>
        <p>لا توجد محادثات مطابقة</p>
      </div>`;
    return;
  }

  let totalUnread = 0;

  elements.contactsList.innerHTML = appState.contacts.map((c) => {
    const unread = Number(c.unread_count || 0);
    totalUnread += unread;
    const isSelected = appState.activeContact && appState.activeContact.jid === c.jid;
    const isGroup = c.is_group === 1 || (c.jid && c.jid.endsWith("@g.us"));
    const displayName = isGroup ? `👥 ${escapeHtml(c.name || 'مجموعة واتساب')}` : escapeHtml(getDisplayName(c));
    const firstLetter = isGroup ? '<i class="fa-solid fa-users"></i>' : (getDisplayName(c) || "ع").trim().charAt(0);
    const tagLabel = isGroup ? "مجموعة 👥" : getTagArabicLabel(c.status_tag || "new");
    const timeFormatted = c.last_message_time ? formatMessageTime(c.last_message_time) : "";
    const snippet = (c.last_message || (isGroup ? "مجموعة جديدة" : "محادثة جديدة")).replace(/[\r\n]+/g, " ");

    const avatarHtml = c.avatar_url 
      ? `<img src="${escapeHtml(c.avatar_url)}" class="avatar-img" onerror="this.style.display='none'; this.parentElement.innerHTML='${firstLetter}';" alt="${escapeHtml(c.name || 'avatar')}"/>` 
      : firstLetter;

    return `
      <div class="contact-item ${isSelected ? "active" : ""}" onclick="selectContact('${c.jid}')">
        <div class="avatar">${avatarHtml}</div>
        <div class="contact-info">
          <div class="contact-top-row">
            <span class="contact-name">${displayName}</span>
            <span class="contact-time">${timeFormatted}</span>
          </div>
          <div class="contact-bottom-row">
            <span class="contact-last-msg">${escapeHtml(snippet)}</span>
            <div class="contact-badges">
              <span class="tag-badge ${isGroup ? 'group' : (c.status_tag || 'new')}">${tagLabel}</span>
              ${unread > 0 ? `<span class="unread-count-badge">${unread}</span>` : ""}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join("");

  if (totalUnread > 0) {
    elements.inboxUnreadBadge.style.display = "inline-block";
    elements.inboxUnreadBadge.innerText = totalUnread;
  } else {
    elements.inboxUnreadBadge.style.display = "none";
  }
}

window.selectContact = async function(jid) {
  const contact = appState.contacts.find((c) => c.jid === jid);
  if (!contact) return;

  appState.activeContact = contact;
  renderContactsList();

  const isGroup = contact.is_group === 1 || (contact.jid && contact.jid.endsWith("@g.us"));

  // Show active chat panel
  elements.chatEmptyView.style.display = "none";
  elements.chatActiveView.style.display = "flex";

  // Fill Header
  const firstChar = isGroup ? '<i class="fa-solid fa-users"></i>' : (getDisplayName(contact) || "ع").trim().charAt(0);
  if (contact.avatar_url) {
    elements.activeChatAvatar.innerHTML = `<img src="${escapeHtml(contact.avatar_url)}" class="avatar-img" onerror="this.style.display='none'; this.parentElement.innerHTML='${firstChar}';" alt="${escapeHtml(contact.name || 'avatar')}" />`;
  } else {
    elements.activeChatAvatar.innerHTML = firstChar;
  }

  elements.activeChatName.innerText = isGroup ? `👥 ${contact.name || 'مجموعة واتساب'}` : getDisplayName(contact);
  
  const displayPhone = isGroup 
    ? "مجموعة واتساب المشتركة"
    : formatPhoneArabicDisplay(contact.phone, contact.jid);
  elements.activeChatPhone.innerText = displayPhone;
  elements.activeChatTagSelect.value = contact.status_tag || "new";
  
  const isPaused = Number(contact.bot_paused) === 1;
  elements.takeoverToggle.checked = isPaused;
  elements.takeoverStatusText.innerText = isPaused ? "البوت متوقف (يدوي)" : "البوت نشط";

  // Mark Read
  await fetch(`/api/contacts/${encodeURIComponent(jid)}/read`, { method: "POST" });
  contact.unread_count = 0;
  renderContactsList();

  // If avatar is missing, trigger background details load so avatar gets fetched & cached right away
  if (!contact.avatar_url && !isGroup) {
    fetch(`/api/contacts/${encodeURIComponent(jid)}/details`)
      .then(res => res.json())
      .then(d => {
        if (d && d.contact && d.contact.avatar_url) {
          contact.avatar_url = d.contact.avatar_url;
          const sidebarAvatar = document.querySelector(`.contact-item[onclick*="${jid}"] .avatar`);
          if (sidebarAvatar) {
            sidebarAvatar.innerHTML = `<img src="${escapeHtml(d.contact.avatar_url)}" class="avatar-img" alt="avatar" />`;
          }
          if (appState.activeContact && appState.activeContact.jid === jid && elements.activeChatAvatar) {
            elements.activeChatAvatar.innerHTML = `<img src="${escapeHtml(d.contact.avatar_url)}" class="avatar-img" alt="avatar" />`;
          }
        }
      })
      .catch(() => {});
  }

  // If Details Modal is currently open, refresh its data for this contact
  if (elements.contactProfileModal && elements.contactProfileModal.style.display === "flex") {
    loadContactProfileDrawer(jid);
  }

  // Load Messages
  loadContactMessages(jid);
};

let currentGroupParticipants = [];

function renderGroupParticipantsList(participants) {
  if (!elements.groupMembersList) return;
  if (!participants || participants.length === 0) {
    elements.groupMembersList.innerHTML = `<p class="drawer-empty-hint">لا توجد نتائج مطابقة في الأعضاء</p>`;
    return;
  }

  elements.groupMembersList.innerHTML = participants.map((p) => {
    const phone = p.phone || (p.id ? p.id.split("@")[0].replace(/\D/g, "") : "");
    const formattedPhone = formatPhoneArabicDisplay(phone, p.id);
    const nameRaw = p.name || "";
    // Detect if name is just a phone number
    const nameClean = nameRaw.replace(/\D/g, "");
    const hasRealName = nameRaw && nameClean !== phone && !(nameClean.length >= 8 && phone.includes(nameClean));
    const displayName = hasRealName ? escapeHtml(nameRaw) : (formattedPhone || "عضو");
    const showPhone = hasRealName && formattedPhone; // Only show phone below name if there's a distinct name
    const firstLetter = hasRealName ? nameRaw.charAt(0) : (phone ? phone.charAt(0) : "ع");
    const avatarHtml = p.avatarUrl
      ? `<img src="${escapeHtml(p.avatarUrl)}" alt="avatar" onerror="this.style.display='none'; this.parentElement.innerText='${firstLetter}';" />`
      : firstLetter;

    let roleBadge = "";
    if (p.isSuperAdmin) {
      roleBadge = `<span class="member-badge superadmin">👑 المالك</span>`;
    } else if (p.isAdmin) {
      roleBadge = `<span class="member-badge admin">⭐ مشرف</span>`;
    }

    return `
      <div class="group-member-item">
        <div class="group-member-left">
          <div class="member-avatar">${avatarHtml}</div>
          <div class="member-info">
            <div class="member-name">${displayName}</div>
            ${showPhone ? `<div class="member-phone">${formattedPhone}</div>` : ''}
          </div>
        </div>
        <div class="member-actions">
          ${roleBadge}
          <button class="member-chat-btn" onclick="startChatWithMember('${phone}', '${p.id}')">
            <i class="fa-solid fa-comment-dots"></i> <span>مراسلة</span>
          </button>
        </div>
      </div>
    `;
  }).join("");
}

window.startChatWithMember = async function(phone, jid) {
  if (elements.contactProfileModal) {
    elements.contactProfileModal.style.display = "none";
  }
  const cleanPhone = (phone || "").replace(/\D/g, "");
  const targetJid = jid || (cleanPhone ? `${cleanPhone}@s.whatsapp.net` : null);
  if (!targetJid) return;

  // Find or create in state
  let contact = appState.contacts.find(c => c.jid === targetJid || (c.phone && c.phone === cleanPhone));
  if (!contact) {
    try {
      await fetch(`/api/contacts/${encodeURIComponent(targetJid)}/details`);
      await fetchContacts();
      contact = appState.contacts.find(c => c.jid === targetJid || (c.phone && c.phone === cleanPhone)) || {
        jid: targetJid,
        name: phone ? `+${phone}` : targetJid.split("@")[0],
        phone: cleanPhone,
        status_tag: "new"
      };
    } catch (e) {}
  }
  if (contact) {
    selectContact(contact.jid);
  }
};

window.loadContactProfileDrawer = async function(jid) {
  if (!jid) return;
  if (elements.contactProfileModal) {
    elements.contactProfileModal.style.display = "flex";
  }

  try {
    const res = await fetch(`/api/contacts/${encodeURIComponent(jid)}/details`);
    const data = await res.json();
    if (!data.success) return;

    const { contact, isGroup, groupDetails, orders, bookings, sharedMedia, sharedGroupMessages } = data;
    const isGroupContact = isGroup || contact.is_group === 1 || (contact.jid && contact.jid.endsWith("@g.us"));
    const phoneDisplay = isGroupContact ? "مجموعة واتساب" : formatPhoneArabicDisplay(contact.phone, jid);
    const nameDisplay = isGroupContact ? `👥 ${contact.name || 'مجموعة واتساب'}` : getDisplayName(contact);
    const firstChar = isGroupContact ? '<i class="fa-solid fa-users"></i>' : (nameDisplay || "ع").trim().charAt(0);

    // Profile Info
    if (elements.drawerName) elements.drawerName.innerText = nameDisplay;
    if (elements.drawerPhone) elements.drawerPhone.innerText = phoneDisplay;

    const avatarUrl = (isGroupContact && groupDetails?.avatarUrl) ? groupDetails.avatarUrl : contact.avatar_url;
    if (avatarUrl) {
      // Also update contact in state and sidebar immediately!
      contact.avatar_url = avatarUrl;
      const targetContact = appState.contacts.find(c => c.jid === jid);
      if (targetContact) targetContact.avatar_url = avatarUrl;
      const sidebarAvatar = document.querySelector(`.contact-item[onclick*="${jid}"] .avatar`);
      if (sidebarAvatar) {
        sidebarAvatar.innerHTML = `<img src="${escapeHtml(avatarUrl)}" class="avatar-img" alt="avatar" />`;
      }
      if (elements.activeChatAvatar && appState.activeContact?.jid === jid) {
        elements.activeChatAvatar.innerHTML = `<img src="${escapeHtml(avatarUrl)}" class="avatar-img" alt="avatar" />`;
      }

      if (elements.drawerAvatarLetter) elements.drawerAvatarLetter.style.display = "none";
      if (elements.drawerAvatarImg) {
        elements.drawerAvatarImg.src = avatarUrl;
        elements.drawerAvatarImg.style.display = "block";
      }
    } else {
      if (elements.drawerAvatarImg) elements.drawerAvatarImg.style.display = "none";
      if (elements.drawerAvatarLetter) {
        elements.drawerAvatarLetter.innerHTML = firstChar;
        elements.drawerAvatarLetter.style.display = "inline-block";
      }
    }

    if (isGroupContact) {
      // Group Profile View
      if (elements.groupProfileSection) elements.groupProfileSection.style.display = "block";
      if (elements.individualProfileSection) elements.individualProfileSection.style.display = "none";
      if (elements.drawerEditBtn) elements.drawerEditBtn.style.display = "none";
      if (elements.drawerWhatsAppLink) elements.drawerWhatsAppLink.style.display = "none";
      if (elements.drawerBioBox) elements.drawerBioBox.style.display = "none";

      const gMeta = groupDetails || {};
      const participants = gMeta.participants || [];
      currentGroupParticipants = participants;

      if (elements.groupDescText) {
        elements.groupDescText.innerText = gMeta.desc || "لا يوجد وصف مسجل لهذه المجموعة";
      }
      if (elements.groupMembersCountBadge) {
        elements.groupMembersCountBadge.innerText = participants.length;
      }
      if (elements.groupMemberSearchInput) {
        elements.groupMemberSearchInput.value = "";
      }
      renderGroupParticipantsList(participants);
    } else {
      // Individual Contact View
      if (elements.groupProfileSection) elements.groupProfileSection.style.display = "none";
      if (elements.individualProfileSection) elements.individualProfileSection.style.display = "block";
      if (elements.drawerEditBtn) elements.drawerEditBtn.style.display = "flex";
      if (elements.drawerWhatsAppLink) {
        elements.drawerWhatsAppLink.style.display = "flex";
        const rawDigits = cleanPhoneDisplay(contact.phone, jid);
        elements.drawerWhatsAppLink.href = `https://wa.me/${rawDigits.startsWith("0") ? "2" + rawDigits : rawDigits}`;
      }

      if (contact.status_bio) {
        if (elements.drawerBio) elements.drawerBio.innerText = contact.status_bio;
        if (elements.drawerBioBox) elements.drawerBioBox.style.display = "flex";
      } else {
        if (elements.drawerBio) elements.drawerBio.innerText = "متاح على واتساب";
        if (elements.drawerBioBox) elements.drawerBioBox.style.display = "flex";
      }

      // CRM Metrics
      const tagLabel = getTagArabicLabel(contact.status_tag || "new");
      if (elements.drawerTagBadge) {
        elements.drawerTagBadge.className = `tag-badge ${contact.status_tag || "new"}`;
        elements.drawerTagBadge.innerText = tagLabel;
      }
      if (elements.drawerOrdersCount) elements.drawerOrdersCount.innerText = contact.total_orders_count || (orders ? orders.length : 0);
      if (elements.drawerTotalSpent) elements.drawerTotalSpent.innerText = `${contact.total_spent || 0} ج.م`;
      if (elements.drawerLeadScore) elements.drawerLeadScore.innerText = `⭐ ${contact.lead_score || 100}%`;

      // Location & Notes
      const fullLoc = [contact.governorate, contact.city, contact.address].filter(Boolean).join(" - ");
      if (elements.drawerAddress) elements.drawerAddress.innerText = fullLoc || "غير محدد";
      if (elements.drawerNotes) elements.drawerNotes.innerText = contact.custom_notes || "لا توجد ملاحظات مسجلة";

      // Orders List
      if (elements.drawerOrdersTotalBadge) elements.drawerOrdersTotalBadge.innerText = orders ? orders.length : 0;
      if (elements.drawerOrdersList) {
        if (orders && orders.length > 0) {
          elements.drawerOrdersList.innerHTML = orders.map((o) => `
            <div class="drawer-item-card">
              <div class="item-header">
                <strong>${escapeHtml(o.order_number || `#${o.id}`)}</strong>
                <span class="tag-badge ${o.status || 'pending'}">${escapeHtml(o.status || 'قيد الانتظار')}</span>
              </div>
              <p style="margin: 2px 0; color: var(--text-main); font-weight: 600;">${escapeHtml(o.order_details || 'طلب عام')}</p>
              <small style="color: var(--primary); font-weight: 700;">${escapeHtml(o.total_price || '0')} EGP</small>
            </div>
          `).join("");
        } else {
          elements.drawerOrdersList.innerHTML = `<p class="drawer-empty-hint">لا توجد طلبات مسجلة</p>`;
        }
      }

      // Bookings List
      if (elements.drawerBookingsTotalBadge) elements.drawerBookingsTotalBadge.innerText = bookings ? bookings.length : 0;
      if (elements.drawerBookingsList) {
        if (bookings && bookings.length > 0) {
          elements.drawerBookingsList.innerHTML = bookings.map((b) => {
            const timeStr = b.start_time ? new Date(b.start_time).toLocaleString("ar-EG", { timeZone: "Africa/Cairo", dateStyle: "short", timeStyle: "short" }) : "";
            return `
              <div class="drawer-item-card">
                <div class="item-header">
                  <strong style="color: #38bdf8;">${escapeHtml(b.reference_code || `#${b.id}`)}</strong>
                  <span class="tag-badge ${b.status === 'CONFIRMED' ? 'ordered' : 'closed'}">${escapeHtml(b.status || 'مؤكد')}</span>
                </div>
                <p style="margin: 2px 0; font-size: 0.75rem; color: var(--text-dim);">${timeStr}</p>
                ${b.notes ? `<small style="color: var(--text-muted);">${escapeHtml(b.notes)}</small>` : ""}
              </div>
            `;
          }).join("");
        } else {
          elements.drawerBookingsList.innerHTML = `<p class="drawer-empty-hint">لا توجد مواعيد مسجلة</p>`;
        }
      }

      // Shared Groups Messages (نشاط ورسائل العضو في كافة الجروبات المشتركة)
      const groupMsgs = sharedGroupMessages || [];
      if (elements.drawerGroupMsgsTotalBadge) elements.drawerGroupMsgsTotalBadge.innerText = groupMsgs.length;
      if (elements.drawerGroupMsgsList) {
        if (groupMsgs.length > 0) {
          elements.drawerGroupMsgsList.innerHTML = groupMsgs.map((gm) => {
            const timeStr = gm.timestamp ? formatMessageTime(gm.timestamp) : "";
            const mediaTag = gm.media_url ? `[${gm.media_type || "وسائط"}] ` : "";
            return `
              <div class="group-msg-item" onclick="selectContact('${escapeHtml(gm.group_jid)}'); elements.contactProfileModal.style.display='none';">
                <div class="group-msg-top">
                  <span class="group-msg-name"><i class="fa-solid fa-users"></i> ${escapeHtml(gm.group_name || 'مجموعة واتساب')}</span>
                  <span class="group-msg-time">${timeStr}</span>
                </div>
                <p class="group-msg-text">${escapeHtml(mediaTag + (gm.text || ''))}</p>
              </div>
            `;
          }).join("");
        } else {
          elements.drawerGroupMsgsList.innerHTML = `<p class="drawer-empty-hint">لا توجد رسائل مسجلة لهذا العضو في أي جروب مشترك</p>`;
        }
      }
    }

    // Shared Media Gallery
    if (elements.drawerMediaTotalBadge) elements.drawerMediaTotalBadge.innerText = sharedMedia ? sharedMedia.length : 0;
    if (elements.drawerMediaGallery) {
      if (sharedMedia && sharedMedia.length > 0) {
        elements.drawerMediaGallery.innerHTML = sharedMedia.map((m) => {
          if (m.media_type === "image") {
            return `
              <div class="drawer-media-thumb" onclick="openLightbox('${escapeHtml(m.media_url)}')">
                <img src="${escapeHtml(m.media_url)}" alt="media" />
              </div>
            `;
          } else if (m.media_type === "video") {
            return `
              <div class="drawer-media-thumb">
                <video src="${escapeHtml(m.media_url)}"></video>
              </div>
            `;
          } else if (m.media_type === "audio") {
            return `
              <div class="drawer-media-doc">
                <i class="fa-solid fa-microphone"></i>
                <span>صوت</span>
              </div>
            `;
          } else {
            return `
              <a href="${escapeHtml(m.media_url)}" target="_blank" download class="drawer-media-doc">
                <i class="fa-solid fa-file-arrow-down"></i>
                <span>مستند</span>
              </a>
            `;
          }
        }).join("");
      } else {
        elements.drawerMediaGallery.innerHTML = `<p class="drawer-empty-hint">لا توجد وسائط مرسلة</p>`;
      }
    }

  } catch (e) {
    console.error("loadContactProfileDrawer error:", e);
  }
};

async function loadContactMessages(jid) {
  elements.messagesContainer.innerHTML = `<div class="text-center" style="color: var(--text-dim);">جاري تحميل المحادثة...</div>`;
  try {
    const res = await fetch(`/api/contacts/${encodeURIComponent(jid)}/messages`);
    const data = await res.json();
    if (data.success) {
      renderMessages(data.messages);
    }
  } catch (e) {
    elements.messagesContainer.innerHTML = `<div class="text-center" style="color: var(--accent-red);">فشل تحميل الرسائل</div>`;
  }
}

function buildMessageMediaAndTextHtml(m) {
  const mediaUrl = m.media_url || m.mediaUrl;
  const mediaType = m.media_type || m.mediaType || (mediaUrl ? "image" : "text");
  let html = "";

  if (mediaUrl) {
    if (mediaType === "image") {
      html += `<div class="media-container"><img src="${escapeHtml(mediaUrl)}" class="chat-media-img" onclick="openLightbox('${escapeHtml(mediaUrl)}')" alt="صورة"/></div>`;
    } else if (mediaType === "audio") {
      html += `<div class="media-container"><div class="audio-player-wrap"><audio controls src="${escapeHtml(mediaUrl)}" preload="metadata"></audio></div></div>`;
    } else if (mediaType === "video") {
      html += `<div class="media-container"><video controls src="${escapeHtml(mediaUrl)}" class="chat-media-video"></video></div>`;
    } else if (mediaType === "document") {
      html += `<div class="media-container"><a href="${escapeHtml(mediaUrl)}" target="_blank" download class="chat-doc-card"><i class="fa-solid fa-file-arrow-down"></i> <span>${escapeHtml(m.text || "تحميل الملف")}</span></a></div>`;
    }
  }

  let cleanText = (m.text || "").trim();
  // Filter out raw media prefix tags if media is already displayed
  if (cleanText) {
    const isPrefixOnly = (mediaUrl && (
      cleanText === "📷 [صورة / Image]" || 
      cleanText === "🎤 [تسجيل صوتي / Voice Note]" || 
      cleanText === "🎥 [فيديو / Video]" || 
      cleanText === "📄 [ملف / Document]" || 
      cleanText === "✨ [ملصق / Sticker]"
    ));
    if (!isPrefixOnly) {
      // Strip starting tag if attached to actual user caption
      cleanText = cleanText
        .replace(/^📷 \[صورة \/ Image\]\s*/, "")
        .replace(/^🎤 \[تسجيل صوتي \/ Voice Note\]\s*/, "")
        .replace(/^🎥 \[فيديو \/ Video\]\s*/, "")
        .replace(/^📄 \[ملف \/ Document\]\s*/, "")
        .replace(/^✨ \[ملصق \/ Sticker\]\s*/, "");

      if (cleanText.length > 0) {
        html += `<div class="msg-text">${escapeHtml(cleanText)}</div>`;
      }
    }
  }

  return html || `<div class="msg-text">${escapeHtml(cleanText || "ملف ميديا")}</div>`;
}

window.openLightbox = function(url) {
  const modal = document.createElement("div");
  modal.className = "lightbox-modal";
  modal.innerHTML = `<img src="${url}" alt="عرض كامل"/>`;
  modal.onclick = () => modal.remove();
  document.body.appendChild(modal);
};

function renderMessages(messages) {
  if (!messages || messages.length === 0) {
    elements.messagesContainer.innerHTML = `
      <div class="empty-state" style="margin: auto;">
        <p>لا توجد رسائل سابقة مع هذا العميل</p>
      </div>`;
    return;
  }

  const isGroupChat = appState.activeContact && (appState.activeContact.is_group === 1 || (appState.activeContact.jid && appState.activeContact.jid.endsWith("@g.us")));

  elements.messagesContainer.innerHTML = messages.map((m) => {
    const isFromMe = Number(m.from_me) === 1;
    const isAi = Number(m.auto_replied) === 1;
    let bubbleClass = isFromMe ? (isAi ? "ai-reply" : "outgoing") : "incoming";
    const timeFormatted = formatMessageTime(m.timestamp);
    const contentHtml = buildMessageMediaAndTextHtml(m);
    const senderHeader = (isGroupChat && !isFromMe && m.sender_name)
      ? `<div class="msg-sender-header"><i class="fa-solid fa-user-circle"></i> ${escapeHtml(m.sender_name)}</div>`
      : "";

    return `
      <div class="msg-bubble ${bubbleClass}">
        ${senderHeader}
        ${contentHtml}
        <div class="msg-meta">
          ${isAi ? `<span class="ai-tag">🤖 رد تلقائي ذكي</span>` : ""}
          <span>${timeFormatted}</span>
        </div>
      </div>
    `;
  }).join("");

  scrollChatToBottom();
}

function appendMessageToChat(msg) {
  const isFromMe = Number(msg.fromMe || msg.from_me) === 1;
  const isAi = Number(msg.autoReplied || msg.auto_replied) === 1;
  let bubbleClass = isFromMe ? (isAi ? "ai-reply" : "outgoing") : "incoming";
  const timeFormatted = formatMessageTime(msg.timestamp || Date.now());
  const contentHtml = buildMessageMediaAndTextHtml(msg);
  const isGroupChat = appState.activeContact && (appState.activeContact.is_group === 1 || (appState.activeContact.jid && appState.activeContact.jid.endsWith("@g.us")));
  const senderHeader = (isGroupChat && !isFromMe && (msg.senderName || msg.sender_name))
    ? `<div class="msg-sender-header"><i class="fa-solid fa-user-circle"></i> ${escapeHtml(msg.senderName || msg.sender_name)}</div>`
    : "";

  const bubble = document.createElement("div");
  bubble.className = `msg-bubble ${bubbleClass}`;
  bubble.innerHTML = `
    ${senderHeader}
    ${contentHtml}
    <div class="msg-meta">
      ${isAi ? `<span class="ai-tag">🤖 رد تلقائي ذكي</span>` : ""}
      <span>${timeFormatted}</span>
    </div>
  `;
  elements.messagesContainer.appendChild(bubble);
}

function scrollChatToBottom() {
  setTimeout(() => {
    elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
  }, 50);
}

// ==========================================
// Chat Actions (Send Text & Voice Notes)
// ==========================================
async function sendChatMessage() {
  const text = elements.chatTextInput.value.trim();
  if (!text || !appState.activeContact) return;

  const jid = appState.activeContact.jid;
  elements.chatTextInput.value = "";

  try {
    const res = await fetch(`/api/contacts/${encodeURIComponent(jid)}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, autoPauseBot: false }),
    });
    const data = await res.json();
    if (data.success) {
      appendMessageToChat({ text, fromMe: 1, autoReplied: 0, timestamp: Date.now() });
      scrollChatToBottom();
    }
  } catch (err) {
    alert("حدث خطأ أثناء الإرسال: " + err.message);
  }
}

async function sendVoiceNoteMessage() {
  const text = elements.chatTextInput.value.trim();
  if (!text) {
    alert("يرجى كتابة النص المراد تحويله إلى رسالة صوتية (Voice Note) وإرسالها!");
    return;
  }
  if (!appState.activeContact) return;

  const jid = appState.activeContact.jid;
  elements.chatTextInput.value = "";
  elements.sendVoiceBtn.disabled = true;

  try {
    const res = await fetch(`/api/contacts/${encodeURIComponent(jid)}/send-voice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, lang: "ar" }),
    });
    const data = await res.json();
    if (data.success) {
      appendMessageToChat({ text: `🎙️ رسالة صوتية ناطقة: "${text}"`, fromMe: 1, autoReplied: 0, timestamp: Date.now() });
      scrollChatToBottom();
    } else {
      alert("فشل توليد الصوت: " + data.error);
    }
  } catch (err) {
    alert("خطأ: " + err.message);
  } finally {
    elements.sendVoiceBtn.disabled = false;
  }
}

// ==========================================
// Orders & Leads Tab
// ==========================================
async function fetchOrders() {
  try {
    const res = await fetch("/api/orders");
    const data = await res.json();
    if (data.success) {
      appState.orders = data.orders;
      renderOrdersTable();
      elements.ordersBadge.innerText = data.orders.length;
    }
  } catch (e) {
    console.error("fetchOrders error:", e);
  }
}

function renderOrdersTable() {
  if (!appState.orders || appState.orders.length === 0) {
    elements.ordersTableBody.innerHTML = `
      <tr>
        <td colspan="10" class="text-center" style="padding: 40px; color: var(--text-dim);">
          <i class="fa-solid fa-receipt" style="font-size: 2rem; margin-bottom: 10px; display: block;"></i>
          لا توجد طلبات مسجلة بعد. عند طلب العميل لخدمة أو منتج سيقوم الذكاء الاصطناعي بتسجيله هنا تلقائياً!
        </td>
      </tr>`;
    return;
  }

  elements.ordersTableBody.innerHTML = appState.orders.map((o) => {
    const isSynced = Number(o.google_sheet_synced) === 1;
    const dateFormatted = new Date(Number(o.created_at)).toLocaleString("ar-EG", { timeZone: "Africa/Cairo" });

    return `
      <tr>
        <td><b>#${o.id}</b></td>
        <td><b>${escapeHtml(o.customer_name)}</b></td>
        <td><a href="https://wa.me/${o.phone}" target="_blank" style="color: var(--primary); text-decoration: none;">${o.phone}</a></td>
        <td>${escapeHtml(o.order_details)}</td>
        <td>${escapeHtml(o.address || "غير محدد")}</td>
        <td><span style="color: var(--accent-amber); font-weight: 700;">${escapeHtml(o.total_price || "0")}</span></td>
        <td>
          <select onchange="updateOrderStatus(${o.id}, this.value)" style="background: var(--bg-input); border: 1px solid var(--border-color); color: white; padding: 4px 8px; border-radius: 6px;">
            <option value="pending" ${o.status === 'pending' ? 'selected' : ''}>قيد الانتظار</option>
            <option value="confirmed" ${o.status === 'confirmed' ? 'selected' : ''}>مؤكد</option>
            <option value="shipped" ${o.status === 'shipped' ? 'selected' : ''}>تم الشحن</option>
            <option value="cancelled" ${o.status === 'cancelled' ? 'selected' : ''}>ملغي</option>
          </select>
        </td>
        <td>
          ${isSynced 
            ? `<span class="tag-badge ordered"><i class="fa-solid fa-check"></i> متزامن</span>` 
            : `<span class="tag-badge new">محلي فقط</span>`}
        </td>
        <td><small style="color: var(--text-dim);">${dateFormatted}</small></td>
        <td>
          <button class="btn-secondary btn-sm" onclick="openChatFromOrder('${o.contact_jid || o.phone}')" title="فتح المحادثة">
            <i class="fa-solid fa-comment-dots"></i>
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

window.updateOrderStatus = async function(id, status) {
  try {
    await fetch(`/api/orders/${id}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
  } catch (e) {
    alert("فشل تحديث الحالة: " + e.message);
  }
};

window.openChatFromOrder = function(identifier) {
  const cleanPhone = identifier.replace(/\D/g, "");
  const jid = identifier.includes("@") ? identifier : `${cleanPhone}@s.whatsapp.net`;
  
  // Switch to inbox tab
  document.querySelector('.nav-item[data-tab="inboxTab"]').click();
  setTimeout(() => {
    selectContact(jid);
  }, 100);
};

// ==========================================
// ReserveFlow Bookings & Appointments Tab
// ==========================================
async function fetchBookings() {
  try {
    const res = await fetch("/api/admin/bookings");
    const data = await res.json();
    if (data.success && Array.isArray(data.bookings)) {
      appState.bookings = data.bookings;
      renderBookingsTable();
      if (elements.bookingsBadge) elements.bookingsBadge.innerText = data.bookings.length;
    }
  } catch (e) {
    console.error("fetchBookings error:", e);
  }
}

function renderBookingsTable() {
  if (!elements.bookingsTableBody) return;
  if (!appState.bookings || appState.bookings.length === 0) {
    elements.bookingsTableBody.innerHTML = `
      <tr>
        <td colspan="9" class="text-center" style="padding: 40px; color: var(--text-dim);">
          <i class="fa-solid fa-calendar-xmark" style="font-size: 2rem; margin-bottom: 10px; display: block;"></i>
          لا توجد حجوزات أو مواعيد مسجلة حتى الآن. عند طلب العميل لحجز موعد سيقوم الذكاء الاصطناعي بتسجيله هنا تلقائياً!
        </td>
      </tr>`;
    return;
  }

  elements.bookingsTableBody.innerHTML = appState.bookings.map((b) => {
    const code = b.reference_code || b.referenceCode;
    const name = b.customer_name || b.customerName || "عميل";
    const phone = b.customer_phone || b.customerPhone || "";
    const email = b.customer_email || b.customerEmail || "غير محدد";
    const notes = b.notes || "";
    const isCancelled = b.status === "CANCELLED";
    const rawStart = b.start_time || b.startTime;
    const rawCreated = b.created_at || b.createdAt;

    const startFormatted = rawStart 
      ? new Date(rawStart).toLocaleString("ar-EG", { timeZone: "Africa/Cairo", dateStyle: "medium", timeStyle: "short" }) 
      : "-";
    const createdFormatted = rawCreated
      ? new Date(Number(rawCreated) || rawCreated).toLocaleDateString("ar-EG", { timeZone: "Africa/Cairo" })
      : "-";

    return `
      <tr style="${isCancelled ? 'opacity: 0.6; text-decoration: line-through;' : ''}">
        <td><strong style="color: var(--accent-cyan);"><i class="fa-solid fa-ticket"></i> ${escapeHtml(code)}</strong></td>
        <td><b>${escapeHtml(name)}</b></td>
        <td><a href="https://wa.me/${phone}" target="_blank" style="color: var(--primary); text-decoration: none;">${phone}</a></td>
        <td><small>${escapeHtml(email)}</small></td>
        <td><span class="tag-badge ${isCancelled ? 'support' : 'interested'}">${startFormatted}</span></td>
        <td>
          <span class="tag-badge ${isCancelled ? 'churned' : 'vip'}">
            ${isCancelled ? 'ملغي' : 'مؤكد'}
          </span>
        </td>
        <td><small>${escapeHtml(notes || "-")}</small></td>
        <td><small style="color: var(--text-dim);">${createdFormatted}</small></td>
        <td>
          ${!isCancelled ? `
            <button class="btn-danger btn-sm" onclick="cancelBookingBtn('${code}', '${b.cancel_token || b.cancelToken}')" title="إلغاء الموعد">
              <i class="fa-solid fa-ban"></i>
            </button>
          ` : `
            <span style="color: var(--text-dim); font-size: 0.8rem;">تم الإلغاء</span>
          `}
        </td>
      </tr>
    `;
  }).join("");
}

window.cancelBookingBtn = async function(code, token) {
  if (!confirm(`هل أنت متأكد من إلغاء تذكرة الحجز ${code}؟`)) return;
  try {
    const res = await fetch(`/api/bookings/${code}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cancelToken: token }),
    });
    const data = await res.json();
    if (data.success) {
      alert(`تم إلغاء الحجز ${code} بنجاح!`);
      fetchBookings();
    } else {
      alert("فشل الإلغاء: " + (data.error || "خطأ غير معروف"));
    }
  } catch (e) {
    alert("حدث خطأ في الاتصال: " + e.message);
  }
};

// ==========================================
// Campaigns & Broadcast Engine
// ==========================================
async function fetchCampaigns() {
  try {
    const res = await fetch("/api/campaigns");
    const data = await res.json();
    if (data.success) {
      appState.campaigns = data.campaigns;
      renderCampaignsHistory();
    }
  } catch (e) {
    console.error("fetchCampaigns error:", e);
  }
}

function renderCampaignsHistory() {
  if (!appState.campaigns || appState.campaigns.length === 0) {
    elements.campaignsHistoryList.innerHTML = `<div class="empty-state"><p>لم يتم إطلاق أي حملات بعد.</p></div>`;
    return;
  }

  elements.campaignsHistoryList.innerHTML = appState.campaigns.map((c) => {
    const dateFormatted = new Date(Number(c.created_at)).toLocaleString("ar-EG", { timeZone: "Africa/Cairo" });
    return `
      <div style="background: var(--bg-input); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 14px; margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <h4 style="font-size: 0.95rem;">${escapeHtml(c.title)}</h4>
          <span class="tag-badge ${c.status === 'completed' ? 'ordered' : 'new'}">${c.status === 'completed' ? 'مكتملة' : 'جارية'}</span>
        </div>
        <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 8px;">${escapeHtml(c.message_template)}</p>
        <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-dim);">
          <span>🎯 المستهدف: ${c.target_count} | ✅ تم: ${c.sent_count} | ❌ فشل: ${c.failed_count}</span>
          <span>${dateFormatted}</span>
        </div>
      </div>
    `;
  }).join("");
}

async function startCampaign() {
  const title = elements.campaignTitle.value.trim();
  const template = elements.campaignTemplate.value.trim();
  const audience = elements.campaignAudienceSelect.value;
  const delaySeconds = Number(elements.campaignDelay.value) || 8;

  if (!title || !template) {
    alert("يرجى كتابة عنوان الحملة ونموذج الرسالة!");
    return;
  }

  let contacts = [];
  if (audience === "custom") {
    const rawNumbers = elements.campaignCustomNumbers.value.split(/[\n,]+/);
    contacts = rawNumbers.map((n) => n.trim()).filter((n) => n.length > 5);
  } else if (audience === "all") {
    contacts = appState.contacts.map((c) => ({ phone: c.phone || c.jid.split("@")[0], name: c.name }));
  } else {
    // Filter by tag
    contacts = appState.contacts
      .filter((c) => c.status_tag === audience)
      .map((c) => ({ phone: c.phone || c.jid.split("@")[0], name: c.name }));
  }

  if (contacts.length === 0) {
    alert("لم يتم العثور على أي أرقام مطابقة للجمهور المستهدف!");
    return;
  }

  if (!confirm(`هل أنت متأكد من إطلاق الحملة إلى ${contacts.length} عميل بفاصل ${delaySeconds} ثواني؟`)) {
    return;
  }

  elements.startCampaignBtn.disabled = true;
  elements.campaignProgressBox.style.display = "block";

  try {
    const res = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, template, contacts, delaySeconds }),
    });
    const data = await res.json();
    if (!data.success) {
      alert("خطأ: " + data.error);
    }
  } catch (err) {
    alert("حدث خطأ أثناء بدء الحملة: " + err.message);
  } finally {
    elements.startCampaignBtn.disabled = false;
  }
}

// ==========================================
// Analytics Tab
// ==========================================
async function fetchAnalytics() {
  try {
    const res = await fetch("/api/analytics");
    const data = await res.json();
    if (data.success) {
      appState.analytics = data.analytics;
      renderAnalytics();
    }
  } catch (e) {
    console.error("fetchAnalytics error:", e);
  }
}

function renderAnalytics() {
  if (!appState.analytics) return;
  const a = appState.analytics;

  elements.statTotalContacts.innerText = a.totalContacts || 0;
  elements.statTotalMessages.innerText = a.totalMessages || 0;
  elements.statTotalAutoReplies.innerText = a.totalAutoReplied || 0;
  elements.statTotalOrders.innerText = a.totalOrders || 0;

  // Render Activity Line Chart
  renderActivityChart(a.dailyVolume || []);

  // Render Tags Doughnut Chart
  renderTagsChart(a.tagsBreakdown || []);
}

function renderActivityChart(dailyData) {
  const ctx = document.getElementById("messagesActivityChart");
  if (!ctx) return;

  const labels = dailyData.map((d) => d.day || "يوم");
  const incomingData = dailyData.map((d) => Number(d.incoming || 0));
  const outgoingData = dailyData.map((d) => Number(d.outgoing || 0));

  if (appState.activityChart) {
    appState.activityChart.destroy();
  }

  appState.activityChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "رسائل واردة (من العملاء)",
          data: incomingData,
          borderColor: "#3b82f6",
          backgroundColor: "rgba(59, 130, 246, 0.1)",
          tension: 0.3,
          fill: true,
        },
        {
          label: "رسائل صادرة (ردود ذكية + يدوية)",
          data: outgoingData,
          borderColor: "#10b981",
          backgroundColor: "rgba(16, 185, 129, 0.1)",
          tension: 0.3,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: "#94a3b8", font: { family: "Cairo" } } },
      },
      scales: {
        x: { ticks: { color: "#64748b", font: { family: "Cairo" } }, grid: { color: "rgba(255,255,255,0.05)" } },
        y: { ticks: { color: "#64748b" }, grid: { color: "rgba(255,255,255,0.05)" } },
      },
    },
  });
}

function renderTagsChart(tagsData) {
  const ctx = document.getElementById("tagsDistributionChart");
  if (!ctx) return;

  const labels = tagsData.map((t) => getTagArabicLabel(t.status_tag));
  const counts = tagsData.map((t) => Number(t.count || 0));
  const colors = ["#3b82f6", "#f59e0b", "#10b981", "#8b5cf6", "#06b6d4", "#64748b"];

  if (appState.tagsChart) {
    appState.tagsChart.destroy();
  }

  appState.tagsChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: labels.length ? labels : ["لا توجد بيانات"],
      datasets: [
        {
          data: counts.length ? counts : [1],
          backgroundColor: colors,
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { color: "#94a3b8", font: { family: "Cairo" } } },
      },
    },
  });
}

// ==========================================
// AI Rules Tab
// ==========================================
async function fetchRules() {
  try {
    const res = await fetch("/api/rules");
    const data = await res.json();
    appState.rules = data.rules || [];
    renderRules();
  } catch (e) {
    console.error("fetchRules error:", e);
  }
}

function renderRules() {
  if (!appState.rules || appState.rules.length === 0) {
    elements.rulesContainer.innerHTML = `
      <div class="empty-state">
        <p>لا توجد قواعد رد مخصصة. سيتولى المساعد الذكي الرد على جميع الاستفسارات تلقائياً!</p>
      </div>`;
    return;
  }

  elements.rulesContainer.innerHTML = appState.rules.map((r) => `
    <div class="card" style="margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
      <div>
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 6px;">
          <span style="font-weight: 800; font-size: 1rem; color: var(--primary);">"${escapeHtml(r.keyword)}"</span>
          <span class="tag-badge new">${r.matchType}</span>
        </div>
        <p style="color: var(--text-muted); font-size: 0.85rem;">${escapeHtml(r.response)}</p>
      </div>
      <button class="btn-icon-danger" onclick="deleteRule('${r.id}')" title="حذف القاعدة">
        <i class="fa-solid fa-trash-can"></i>
      </button>
    </div>
  `).join("");
}

window.deleteRule = async function(id) {
  if (!confirm("هل أنت متأكد من حذف هذه القاعدة؟")) return;
  try {
    await fetch(`/api/rules/${id}`, { method: "DELETE" });
    fetchRules();
  } catch (e) {
    alert("فشل الحذف: " + e.message);
  }
};

// ==========================================
// General Event Listeners
// ==========================================
function setupEventListeners() {
  // Global Bot Toggle
  elements.globalBotToggle.addEventListener("change", async (e) => {
    const enabled = e.target.checked;
    await fetch("/api/bot/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
  });

  // Logout
  elements.logoutBtn.addEventListener("click", async () => {
    if (confirm("هل تريد بالتأكيد تسجيل الخروج وإعادة ربط جهاز جديد؟")) {
      await fetch("/api/logout", { method: "POST" });
    }
  });

  // Contacts Search
  if (elements.contactSearchInput) {
    elements.contactSearchInput.addEventListener("input", (e) => {
      appState.searchQuery = (e.target.value || "").trim();
      fetchContacts();
    });
  }

  // Tag Filters Pills
  if (elements.tagFilterPills) {
    elements.tagFilterPills.forEach((pill) => {
      pill.addEventListener("click", () => {
        elements.tagFilterPills.forEach((p) => p.classList.remove("active"));
        pill.classList.add("active");
        appState.activeFilter = pill.getAttribute("data-filter") || "all";
        fetchContacts();
      });
    });
  }

  // Chat Tag Select
  elements.activeChatTagSelect.addEventListener("change", async (e) => {
    if (!appState.activeContact) return;
    const tag = e.target.value;
    await fetch(`/api/contacts/${encodeURIComponent(appState.activeContact.jid)}/tag`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag }),
    });
    appState.activeContact.status_tag = tag;
    fetchContacts();
  });

  // Human Takeover Toggle per chat
  elements.takeoverToggle.addEventListener("change", async (e) => {
    if (!appState.activeContact) return;
    const paused = e.target.checked;
    await fetch(`/api/contacts/${encodeURIComponent(appState.activeContact.jid)}/toggle-bot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paused }),
    });
    appState.activeContact.bot_paused = paused ? 1 : 0;
    elements.takeoverStatusText.innerText = paused ? "البوت متوقف (يدوي)" : "البوت نشط";
  });

  // Send Text Button & Enter key
  elements.sendTextBtn.addEventListener("click", sendChatMessage);
  elements.chatTextInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });

  // Send Voice Note Button
  elements.sendVoiceBtn.addEventListener("click", sendVoiceNoteMessage);

  // Quick Replies Select
  elements.quickRepliesSelect.addEventListener("change", (e) => {
    if (e.target.value) {
      elements.chatTextInput.value = e.target.value;
      elements.quickRepliesSelect.value = "";
    }
  });

  // Audience select for campaign
  elements.campaignAudienceSelect.addEventListener("change", (e) => {
    elements.customNumbersGroup.style.display = e.target.value === "custom" ? "block" : "none";
  });

  // Start campaign button
  elements.startCampaignBtn.addEventListener("click", startCampaign);

  // Refresh Analytics
  elements.refreshAnalyticsBtn.addEventListener("click", fetchAnalytics);

  // Edit Contact Modal
  window.openEditContactModal = function(contact) {
    contact = contact || appState.activeContact;
    if (!contact) {
      alert("برجاء اختيار محادثة عميل أولاً لتعديل بياناته");
      return;
    }
    if (elements.contactProfileModal) {
      elements.contactProfileModal.style.display = "none";
    }
    if (elements.editContactName) elements.editContactName.value = contact.name || "";
    if (elements.editContactPhone) {
      elements.editContactPhone.value = cleanPhoneDisplay(contact.phone, contact.jid);
    }
    if (elements.editContactTag) elements.editContactTag.value = contact.status_tag || "new";
    if (elements.editContactCity) elements.editContactCity.value = contact.city || "";
    if (elements.editContactAddress) elements.editContactAddress.value = contact.address || "";
    if (elements.editContactNotes) elements.editContactNotes.value = contact.custom_notes || "";
    if (elements.editContactModal) elements.editContactModal.style.display = "flex";
  };

  const chatUserInfo = document.querySelector(".chat-user-info");
  if (chatUserInfo) {
    chatUserInfo.addEventListener("click", () => {
      if (appState.activeContact) {
        loadContactProfileDrawer(appState.activeContact.jid);
      }
    });
  }

  if (elements.editContactBtn) {
    elements.editContactBtn.addEventListener("click", () => {
      openEditContactModal();
    });
  }

  if (elements.closeEditContactModalBtn) {
    elements.closeEditContactModalBtn.addEventListener("click", () => elements.editContactModal.style.display = "none");
  }
  if (elements.cancelEditContactBtn) {
    elements.cancelEditContactBtn.addEventListener("click", () => elements.editContactModal.style.display = "none");
  }

  if (elements.saveEditContactBtn) {
    elements.saveEditContactBtn.addEventListener("click", async () => {
      if (!appState.activeContact) return;
      const jid = appState.activeContact.jid;
      const name = elements.editContactName ? elements.editContactName.value.trim() : "";
      const phone = elements.editContactPhone ? elements.editContactPhone.value.trim() : "";
      const status_tag = elements.editContactTag ? elements.editContactTag.value : "new";
      const city = elements.editContactCity ? elements.editContactCity.value.trim() : "";
      const address = elements.editContactAddress ? elements.editContactAddress.value.trim() : "";
      const custom_notes = elements.editContactNotes ? elements.editContactNotes.value.trim() : "";

      try {
        const res = await fetch(`/api/contacts/${encodeURIComponent(jid)}/profile`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, phone, status_tag, city, address, custom_notes }),
        });
        const data = await res.json();
        if (data.success) {
          appState.activeContact.name = name || appState.activeContact.name;
          appState.activeContact.phone = phone || appState.activeContact.phone;
          appState.activeContact.status_tag = status_tag;
          appState.activeContact.city = city;
          appState.activeContact.address = address;
          appState.activeContact.custom_notes = custom_notes;

          const firstChar = (appState.activeContact.name || appState.activeContact.phone || "ع").trim().charAt(0);
          if (appState.activeContact.avatar_url) {
            elements.activeChatAvatar.innerHTML = `<img src="${escapeHtml(appState.activeContact.avatar_url)}" class="avatar-img" alt="avatar" />`;
          } else {
            elements.activeChatAvatar.innerText = firstChar;
          }

          elements.activeChatName.innerText = appState.activeContact.name || appState.activeContact.phone;
          elements.activeChatPhone.innerText = appState.activeContact.phone || jid.split("@")[0];
          elements.activeChatTagSelect.value = status_tag;

          elements.editContactModal.style.display = "none";
          fetchContacts();
        }
      } catch (err) {
        alert("فشل حفظ التعديلات: " + err.message);
      }
    });
  }

  // Contact Profile Details Modal (Popup)
  if (elements.viewContactProfileBtn) {
    elements.viewContactProfileBtn.addEventListener("click", () => {
      if (!appState.activeContact) return;
      loadContactProfileDrawer(appState.activeContact.jid);
    });
  }

  if (elements.closeContactProfileModalBtn) {
    elements.closeContactProfileModalBtn.addEventListener("click", () => {
      elements.contactProfileModal.style.display = "none";
    });
  }

  if (elements.cancelContactProfileBtn) {
    elements.cancelContactProfileBtn.addEventListener("click", () => {
      elements.contactProfileModal.style.display = "none";
    });
  }

  if (elements.drawerEditBtn) {
    elements.drawerEditBtn.addEventListener("click", () => {
      openEditContactModal();
    });
  }

  // Live Group Members Search
  if (elements.groupMemberSearchInput) {
    elements.groupMemberSearchInput.addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase().trim();
      if (!q) {
        renderGroupParticipantsList(currentGroupParticipants);
      } else {
        const filtered = currentGroupParticipants.filter((p) => 
          (p.phone && p.phone.includes(q)) || 
          (p.name && p.name.toLowerCase().includes(q)) ||
          (p.id && p.id.toLowerCase().includes(q))
        );
        renderGroupParticipantsList(filtered);
      }
    });
  }

  // Notes Modal
  elements.chatNotesBtn.addEventListener("click", () => {
    if (!appState.activeContact) return;
    elements.contactNotesTextarea.value = appState.activeContact.custom_notes || "";
    elements.notesModal.style.display = "flex";
  });
  elements.closeNotesModalBtn.addEventListener("click", () => elements.notesModal.style.display = "none");
  elements.cancelNotesBtn.addEventListener("click", () => elements.notesModal.style.display = "none");
  elements.saveNotesBtn.addEventListener("click", async () => {
    if (!appState.activeContact) return;
    const notes = elements.contactNotesTextarea.value;
    await fetch(`/api/contacts/${encodeURIComponent(appState.activeContact.jid)}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    appState.activeContact.custom_notes = notes;
    elements.notesModal.style.display = "none";
    alert("تم حفظ الملاحظات بنجاح!");
  });

  // Add Order Modal
  elements.addNewOrderBtn.addEventListener("click", () => elements.addOrderModal.style.display = "flex");
  elements.closeAddOrderModalBtn.addEventListener("click", () => elements.addOrderModal.style.display = "none");
  elements.cancelAddOrderBtn.addEventListener("click", () => elements.addOrderModal.style.display = "none");
  elements.submitAddOrderBtn.addEventListener("click", async () => {
    const name = document.getElementById("newOrderName").value.trim();
    const phone = document.getElementById("newOrderPhone").value.trim();
    const details = document.getElementById("newOrderDetails").value.trim();
    const address = document.getElementById("newOrderAddress").value.trim();
    const price = document.getElementById("newOrderPrice").value.trim();

    if (!name || !phone) {
      alert("يرجى إدخال اسم العميل ورقم الهاتف!");
      return;
    }

    try {
      await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerName: name, phone, orderDetails: details, address, totalPrice: price }),
      });
      elements.addOrderModal.style.display = "none";
      fetchOrders();
      alert("تم تسجيل الطلب بنجاح!");
    } catch (e) {
      alert("فشل تسجيل الطلب: " + e.message);
    }
  });

  // Add Booking Modal
  if (elements.openNewBookingModalBtn) {
    elements.openNewBookingModalBtn.addEventListener("click", () => {
      // Set default date to tomorrow
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const yyyy = tomorrow.getFullYear();
      const mm = String(tomorrow.getMonth() + 1).padStart(2, "0");
      const dd = String(tomorrow.getDate()).padStart(2, "0");
      const defaultDateStr = `${yyyy}-${mm}-${dd}`;
      
      if (elements.newBookingDate) {
        elements.newBookingDate.value = defaultDateStr;
        loadAvailableSlots(defaultDateStr);
      }
      elements.addBookingModal.style.display = "flex";
    });
  }

  if (elements.closeAddBookingModalBtn) {
    elements.closeAddBookingModalBtn.addEventListener("click", () => elements.addBookingModal.style.display = "none");
  }
  if (elements.cancelAddBookingBtn) {
    elements.cancelAddBookingBtn.addEventListener("click", () => elements.addBookingModal.style.display = "none");
  }

  if (elements.newBookingDate) {
    elements.newBookingDate.addEventListener("change", (e) => {
      loadAvailableSlots(e.target.value);
    });
  }

  if (elements.submitAddBookingBtn) {
    elements.submitAddBookingBtn.addEventListener("click", async () => {
      const name = document.getElementById("newBookingName").value.trim();
      const phone = document.getElementById("newBookingPhone").value.trim();
      const email = document.getElementById("newBookingEmail").value.trim();
      const slotStartTime = elements.newBookingSlotSelect.value;
      const notes = document.getElementById("newBookingNotes").value.trim();

      if (!name || !phone || !slotStartTime) {
        alert("يرجى إدخال اسم العميل، رقم الهاتف، واختيار موعد متاح!");
        return;
      }

      try {
        const res = await fetch("/api/bookings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerName: name,
            customerPhone: phone,
            customerEmail: email,
            startTime: slotStartTime,
            notes,
          }),
        });
        const data = await res.json();
        if (data.success) {
          elements.addBookingModal.style.display = "none";
          document.getElementById("newBookingName").value = "";
          document.getElementById("newBookingPhone").value = "";
          document.getElementById("newBookingEmail").value = "";
          document.getElementById("newBookingNotes").value = "";
          fetchBookings();
          alert(`🎉 تم حجز الموعد بنجاح! كود التذكرة: ${data.booking.referenceCode}`);
        } else {
          alert("فشل الحجز: " + (data.error || "تعارض في الموعد"));
        }
      } catch (err) {
        alert("حدث خطأ في الاتصال: " + err.message);
      }
    });
  }

  // Add Rule Modal
  elements.openAddRuleModalBtn.addEventListener("click", () => elements.addRuleModal.style.display = "flex");
  elements.closeAddRuleModalBtn.addEventListener("click", () => elements.addRuleModal.style.display = "none");
  elements.cancelAddRuleBtn.addEventListener("click", () => elements.addRuleModal.style.display = "none");
  elements.submitAddRuleBtn.addEventListener("click", async () => {
    const keyword = document.getElementById("ruleKeyword").value.trim();
    const matchType = document.getElementById("ruleMatchType").value;
    const response = document.getElementById("ruleResponse").value.trim();

    if (!keyword || !response) {
      alert("يرجى إدخال الكلمة المفتاحية ونص الرد!");
      return;
    }

    try {
      await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword, matchType, response }),
      });
      elements.addRuleModal.style.display = "none";
      fetchRules();
    } catch (e) {
      alert("فشل إضافة القاعدة: " + e.message);
    }
  });
}

async function loadAvailableSlots(dateStr) {
  if (!elements.newBookingSlotSelect) return;
  elements.newBookingSlotSelect.innerHTML = `<option value="">جاري فحص المواعيد المتاحة...</option>`;
  try {
    const res = await fetch(`/api/availability?date=${dateStr}`);
    const data = await res.json();
    if (data.available && data.slots && data.slots.length > 0) {
      elements.newBookingSlotSelect.innerHTML = data.slots.map(s => `
        <option value="${s.startTime}">🕒 ${s.displayTime} (${data.durationMinutes} دقيقة)</option>
      `).join("");
    } else {
      elements.newBookingSlotSelect.innerHTML = `<option value="">${data.reason || 'لا توجد مواعيد متاحة في هذا اليوم'}</option>`;
    }
  } catch (e) {
    elements.newBookingSlotSelect.innerHTML = `<option value="">فشل جلب المواعيد المتاحة</option>`;
  }
}

function loadInitialData() {
  fetchContacts();
  fetchOrders();
  fetchBookings();
}

function updateWebhookUrls() {
  const origin = window.location.origin;
  if (elements.tunnelOrderWebhookUrl) elements.tunnelOrderWebhookUrl.innerText = `${origin}/api/tools/order`;
  if (elements.tunnelVoiceWebhookUrl) elements.tunnelVoiceWebhookUrl.innerText = `${origin}/api/tools/voice`;
  const bookingWebhook = document.getElementById("tunnelBookingWebhookUrl");
  if (bookingWebhook) bookingWebhook.innerText = `${origin}/api/tools/book-appointment`;
}

async function loadSettings() {
  try {
    const res = await fetch("/api/settings");
    const data = await res.json();
    if (data.success && data.settings) {
      const s = data.settings;
      const sheetEl = document.getElementById("settingGoogleSheetUrl");
      if (sheetEl) sheetEl.value = s.googleSheetWebhookUrl || "";
    }
  } catch (e) {
    console.error("loadSettings error:", e);
  }
}

const saveSettingsBtn = document.getElementById("saveSettingsBtn");
if (saveSettingsBtn) {
  saveSettingsBtn.addEventListener("click", async () => {
    const googleSheetWebhookUrl = document.getElementById("settingGoogleSheetUrl")?.value.trim() || "";

    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          googleSheetWebhookUrl,
        }),
      });
      const data = await res.json();
      if (data.success) {
        alert("✅ تم حفظ رابط Google Sheets بنجاح!");
      } else {
        alert("فشل حفظ الإعدادات: " + (data.error || ""));
      }
    } catch (e) {
      alert("حدث خطأ أثناء الحفظ: " + e.message);
    }
  });
}

// ==========================================
// Utility Helpers
// ==========================================
function getTagArabicLabel(tag) {
  const map = {
    new: "جديد",
    interested: "مهتم",
    ordered: "طلب شراء",
    vip: "VIP",
    support: "دعم فني",
    closed: "مغلق",
  };
  return map[tag] || tag;
}

function formatMessageTime(ts) {
  if (!ts) return "";
  const d = new Date(Number(ts));
  return d.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Africa/Cairo" });
}

function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.innerText = text;
  return div.innerHTML;
}

// Extract clean phone number from JID or raw phone string
function cleanPhoneDisplay(phone, jid) {
  // If phone is clean and short, use it
  if (phone && !phone.includes("@") && phone.length <= 15 && /^\d+$/.test(phone.replace(/\D/g, ""))) {
    return phone.replace(/\D/g, "");
  }
  // Extract from JID
  if (jid && jid.includes("@") && !jid.endsWith("@g.us") && !jid.endsWith("@newsletter")) {
    const raw = jid.split("@")[0].split(":")[0].replace(/\D/g, "");
    if (raw.length >= 8) return raw;
  }
  // Fallback to phone with cleanup
  if (phone) return phone.replace(/@.*$/, "").split(":")[0].replace(/\D/g, "");
  return "";
}

// Format phone number nicely with readable spacing and country code
function formatPhoneArabicDisplay(phone, jid) {
  const raw = cleanPhoneDisplay(phone, jid);
  if (!raw) return "";

  // Egyptian numbers: 201XXXXXXXXX -> +20 1X XXXXXXXX
  if (raw.startsWith("20") && raw.length === 12) {
    const operator = raw.substring(2, 4); // 10, 11, 12, 15
    const part1 = raw.substring(4, 8);
    const part2 = raw.substring(8);
    return `+20 ${operator} ${part1}${part2}`;
  }

  // Egyptian local numbers: 01XXXXXXXXX -> 01X XXXXXXXX
  if (raw.startsWith("01") && raw.length === 11) {
    const operator = raw.substring(0, 3);
    const rest = raw.substring(3);
    return `${operator} ${rest}`;
  }

  // Standard international format with +
  return `+${raw}`;
}

// Get proper display name (not phone-as-name)
function getDisplayName(contact) {
  if (!contact) return "عميل";
  const name = (contact.name || "").trim();
  const rawPhone = cleanPhoneDisplay(contact.phone, contact.jid);
  const formattedPhone = formatPhoneArabicDisplay(contact.phone, contact.jid);
  const nameClean = name.replace(/\D/g, "");

  // If no name, or name is identical to phone, or name is raw numeric JID
  if (!name || name === contact.jid || name === contact.phone || (nameClean.length >= 8 && (nameClean === rawPhone || (rawPhone && rawPhone.includes(nameClean))))) {
    return formattedPhone || (contact.jid ? contact.jid.split("@")[0] : "عميل");
  }
  return name;
}


