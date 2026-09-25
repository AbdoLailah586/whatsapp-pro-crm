<div align="center">

# ⚡ WhatsApp Pro CRM & AI Automation Engine
### *Enterprise Multi-Tenant WhatsApp CRM, Autonomous AI Workflows, Anti-Ban Bulk Campaigns & SaaS Administration Suite*

<br/>

<a href="https://git.io/typing-svg">
  <img src="https://readme-typing-svg.demolab.com?font=Plus+Jakarta+Sans&weight=700&size=26&duration=2800&pause=1000&color=25D366&center=true&vCenter=true&multiline=true&width=780&height=90&lines=WhatsApp+Pro+CRM+%E2%80%94+Enterprise+Multi-Tenant+Platform;Anti-Ban+Campaign+Guard+%2B+Micro-Batching+Cooldowns;MicroMind+AI+Agent+%2B+Studio+Voice+Notes+(Opus%2FTTS-1-HD);SaaS+Super+Admin+%2B+Dedicated+Native+Android+App" alt="WhatsApp Pro Animated Typing" />
</a>

<br/>

[![Node.js](https://img.shields.io/badge/Node.js-v20%2B%20%7C%20v22-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![WhatsApp Baileys](https://img.shields.io/badge/WhatsApp-Baileys%20v7-25D366?style=for-the-badge&logo=whatsapp&logoColor=white)](https://github.com/WhiskeySockets/Baileys)
[![PostgreSQL](https://img.shields.io/badge/Database-Neon%20PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://neon.tech/)
[![Socket.io](https://img.shields.io/badge/Real--Time-Socket.io%20v4-010101?style=for-the-badge&logo=socket.io&logoColor=white)](https://socket.io/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![OpenAI TTS](https://img.shields.io/badge/AI%20Audio-OpenAI%20TTS--1--HD-412991?style=for-the-badge&logo=openai&logoColor=white)](https://platform.openai.com/)
[![Android App](https://img.shields.io/badge/Mobile-Android%20APK%20Included-3DDC84?style=for-the-badge&logo=android&logoColor=white)](#-android-mobile-app-companion)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

<br/>

<p align="center">
  <a href="#-executive-overview"><b>Overview</b></a> •
  <a href="#-whats-new--recent-engineering-updates"><b>What's New</b></a> •
  <a href="#-anti-ban-campaign-guard-system"><b>Anti-Ban Engine</b></a> •
  <a href="#-saas-super-admin--subscription-management"><b>SaaS Admin</b></a> •
  <a href="#-system-architecture"><b>Architecture</b></a> •
  <a href="#-key-features"><b>Features</b></a> •
  <a href="#-android-mobile-app-companion"><b>Mobile APK</b></a> •
  <a href="#-quick-start"><b>Quick Start</b></a> •
  <a href="#-api-reference"><b>API Reference</b></a> •
  <a href="#-license"><b>License</b></a>
</p>

---

</div>

<br/>

## 🌟 Executive Overview

**WhatsApp Pro CRM** is a production-hardened, multi-tenant conversational automation and CRM suite designed to transform WhatsApp into an autonomous, enterprise-grade customer relationship platform. Built upon **Node.js**, **Baileys v7**, **Neon Cloud PostgreSQL**, and **MicroMind AI Workflows**, it enables businesses to handle thousands of customer conversations with sub-second response times, studio-quality voice notes, intelligent booking pipelines, and zero-ban bulk broadcasting.

Whether accessed via the responsive web dashboard or through the bundled **native Android application**, every tenant benefits from strictly isolated data stores, independent WhatsApp sessions, automated lead tracking, and customizable auto-responders.

<br/>

---

## 🚀 What's New & Recent Engineering Updates

This release introduces major architectural hardening, anti-ban protections, multi-tenant SaaS features, and connection resilience fixes:

### 🛡️ 1. Anti-Ban Campaign Guard & Smart Broadcasting
* **Automated Safety Cooldown Intervals:** Configurable micro-batching pauses (e.g., 45-minute cooling rest after sending batches of 25–50 messages) to emulate organic messaging patterns and avoid WhatsApp spam flags.
* **Live Progress & Countdown Dashboard:** Real-time progress bar with percentage tracking, message status counters (Sent, Failed, Waiting), remaining cooldown countdown timer, and **next upcoming contact group / batch indicator**.
* **Instant Manual Safety Controls:** Complete operational control over active campaigns:
  * ⏸️ **Pause / Resume:** Temporarily halt an active broadcast at any time.
  * ⚡ **Skip Cooldown Now:** Manually bypass waiting periods when immediate delivery is urgent.
  * 🛑 **Cancel Broadcast:** Cleanly abort campaigns without orphaned background execution loops.
* **Campaign Stall & Deadlock Elimination:** Optimized iteration loop in [`automationTools.js`](src/automationTools.js) resolving race conditions and ensuring uninterrupted queue processing.
* **Connection Drop Protection:** If WhatsApp disconnects mid-broadcast, campaigns automatically transition to `waiting_connection` and gracefully resume once the socket reconnects without dropped targets.
* **Human Behavior Simulation:** Integrated dynamic **Spintax parsing** (`{Hello|Hi|Greetings}`), randomized jitter delays, and simulated typing presence (`simulateHumanTyping`).

### 👑 2. SaaS Multi-Tenancy & Super Admin Suite
* **Strict Tenant Schema & Session Isolation:** Contacts, chats, message histories, campaigns, automation rules, and WhatsApp authentication keys are strictly compartmentalized per user via [`tenant.js`](src/tenant.js) and `AsyncLocalStorage`.
* **Web Dashboard Subscriber Management Panel:** Dedicated management interface for administrators to monitor registered accounts, active subscribers, and plan health.
* **Flexible Subscription Duration Presets:** 1-click subscription provisioning with built-in presets:
  * **1-Day Trial** (instant demo activation)
  * **7 Days** (standard trial)
  * **30 Days / 1 Month**
  * **90 Days / 3 Months**
  * **365 Days / 1 Year**
  * **Lifetime Access**
* **Access Control & Automated Expiry Enforcement:** Real-time middleware checks rejecting requests with `SUBSCRIPTION_EXPIRED` or `ACCOUNT_SUSPENDED` upon plan lapse across REST APIs and WebSocket streams.

### ⚡ 3. WhatsApp Baileys v7 Resilience & Zero-Hang Handshake
* **DisconnectReason 515 (`restartRequired`) Resolution:** Correctly intercepts code 515 restart requirements during QR pairing, retaining pairing state without dropping credentials.
* **QR Pairing Timeout & Freeze Fix:** Cleaned dead session states and refactored auth lifecycle in [`dbAuthState.js`](src/dbAuthState.js).
* **Dedicated Database Auth Store (`baileys_auth_store`):** Migrated authentication tokens to an optimized table with batch key insertions, ensuring multi-device session persistence across cloud container redeployments (Railway, Koyeb, Docker).
* **Browser Signature Optimization:** Configured connection tuple to `Browsers.windows("Desktop")` to eliminate WhatsApp Web handshake rejections.
* **Graceful `connectionReplaced` (440) Handling:** Implemented exponential backoff and cooling logic to prevent aggressive reconnection loops when multiple instances run simultaneously.
* **Cryptographic Signal Log Sanitization:** Integrated [`redactSignalLogs.js`](src/redactSignalLogs.js) to strip private ratchet keys and sensitive cryptographic material from server and console logs.

### 📱 4. Mobile API & Android Native Ecosystem
* **Dual Authentication Support:** Accepts both browser `httpOnly` JWT session cookies and mobile `Authorization: Bearer <token>` headers.
* **Phone Number Login Normalization:** Users can register and sign in directly with their phone numbers or email addresses.
* **Multipart Media Dispatch API:** Dedicated `/api/chat/send-media` endpoint supporting direct image, document, and voice note uploads.
* **Bundled Android APK:** Ships with [`whatsapp-pro-crm.apk`](whatsapp-pro-crm.apk) featuring native haptics, hardware back gesture interceptors, and local device audio recording.

<br/>

---

## 🛡️ Anti-Ban Campaign Guard System

Bulk messaging on WhatsApp demands strict adherence to behavioral safety. The Anti-Ban Engine operates on a multi-tiered defense strategy:

```
[Audience Queue (CSV / Groups / Tags)]
                  │
                  ▼
       [Anti-Ban Pre-Filter] ───► (Validate E.164 numbers & check WhatsApp registration)
                  │
                  ▼
       [Spintax & Personalization] ───► ({Hi|Hello} {name}, special offer for you!)
                  │
                  ▼
       [Human Typing Simulation] ───► (Emit 'composing' presence for 2-5 seconds)
                  │
                  ▼
       [Send Message + Jitter Delay] ───► (Wait random 15s - 45s between contacts)
                  │
                  ▼
      [Batch Threshold Reached?]
       ├── NO  ──► Continue next contact
       └── YES ──► ☕ [Activate Cooldown Period]
                    ├── Pause broadcast for 45 minutes
                    ├── Display remaining countdown on dashboard
                    ├── Display next contact group name
                    └── Allow manual "Skip Cooldown" if authorized
```

<br/>

---

## 👑 SaaS Super Admin & Subscription Management

The built-in SaaS layer enables operating WhatsApp Pro as a commercial software-as-a-service platform:

<table>
  <tr>
    <th width="30%">Feature</th>
    <th width="70%">Description</th>
  </tr>
  <tr>
    <td><b>Subscribers Panel</b></td>
    <td>Monitor global tenant statistics: Total Users, Active Plans, Expired Subscriptions, and Suspended Accounts.</td>
  </tr>
  <tr>
    <td><b>Quick Expiry Presets</b></td>
    <td>1-click subscription extension buttons: <b>1 Day Trial</b>, <b>7 Days</b>, <b>30 Days</b>, <b>90 Days</b>, <b>1 Year</b>, and <b>Permanent</b>.</td>
  </tr>
  <tr>
    <td><b>Instant Account Suspension</b></td>
    <td>Freeze delinquent or abusive tenant accounts immediately with custom reason codes.</td>
  </tr>
  <tr>
    <td><b>Isolated Multi-Device Sessions</b></td>
    <td>Each subscriber connects their own unique WhatsApp phone number; sessions never conflict or share data.</td>
  </tr>
  <tr>
    <td><b>First-User Bootstrapping</b></td>
    <td>The first registered user automatically inherits legacy database entities and is designated as the permanent Super Administrator.</td>
  </tr>
</table>

<br/>

---

## 📐 System Architecture

```mermaid
graph TD
    subgraph Clients ["💻 User Interfaces"]
        WebDash["Responsive Web CRM Dashboard"]
        MobileApp["📱 Android Mobile App (whatsapp-pro-crm.apk)"]
    end

    subgraph Server_Core ["⚡ Node.js Core Backend (Express 5 & Socket.io 4)"]
        AuthMiddleware["JWT & Bearer Auth + SaaS Subscription Gate"]
        TenantManager["Tenant Context (AsyncLocalStorage)"]
        CampaignEngine["Anti-Ban Campaign Engine (Micro-Batching & Cooldown)"]
        VoiceEngine["Voice Synthesizer (OpenAI TTS + FFmpeg Opus)"]
        BookingEngine["ReserveFlow Appointment Engine"]
    end

    subgraph Data_Layer ["🐘 Neon Cloud PostgreSQL Database"]
        AuthStore[("baileys_auth_store (Sessions & Multi-Device Keys)")]
        CRMData[("contacts, messages, orders, campaigns, rules")]
        UserStore[("users (Multi-Tenant SaaS Accounts)")]
    end

    subgraph External_Services ["🌐 External Integrations"]
        MicroMind["🧠 MicroMind / Flowise LLM Chatflow"]
        OpenAI["🎙️ OpenAI TTS-1-HD"]
        WAOfficial["💬 WhatsApp Official Network (Baileys v7 Socket)"]
        SMTPMailer["📧 SMTP Transactional Mailer (HTML Receipts)"]
        GoogleSheets["📊 Google Sheets Webhook Pipeline"]
    end

    %% Client connections
    WebDash <-->|HTTP Cookies + WSS| AuthMiddleware
    MobileApp <-->|Bearer Token + WSS| AuthMiddleware

    %% Server flow
    AuthMiddleware --> TenantManager
    TenantManager --> CampaignEngine
    TenantManager --> VoiceEngine
    TenantManager --> BookingEngine

    %% Database connections
    TenantManager <--> CRMData
    TenantManager <--> UserStore
    WAOfficial <--> AuthStore

    %% External connections
    CampaignEngine <--> WAOfficial
    VoiceEngine <--> OpenAI
    VoiceEngine --> WAOfficial
    BookingEngine --> SMTPMailer
    BookingEngine --> GoogleSheets
    TenantManager <--> MicroMind
```

<br/>

---

## 🚀 Key Features Breakdown

### 🤖 1. Autonomous AI Agent & MicroMind Workflow Engine
* **Dynamic Context Injection:** Injects customer metadata (Name, Phone, Tag, Historical Orders, Cairo Date/Time) into system prompts.
* **Human Takeover Mode:** Pause the AI bot on an individual contact basis directly from the chat screen to handle sensitive discussions manually.
* **Regex & Keyword Triggers:** Fast rule evaluation responding instantly to pricing, locations, and frequently asked questions.

### 🎙️ 2. Studio-Grade Voice Notes (PTT) Engine
* **OpenAI `tts-1-hd` Synthesis:** Human-like Arabic and multilingual speech synthesis via MicroMind workflow or Google TTS fallback.
* **FFmpeg Opus Transcoding:** Converts audio to WhatsApp VoIP-compliant **OGG Opus (`audio/ogg; codecs=opus; ptt=true`)**.
* **100% Mobile Playback Guarantee:** Renders authentic green microphone badges and native waveforms across all iOS and Android devices.

### 📊 3. Smart CRM Inbox & Reverse LID Resolution
* **Reverse LID Identity Mapper:** Parses internal WhatsApp 15-digit LID identifiers (e.g. `24940xxxxxxxxxx@lid`) back to international phone numbers.
* **Omnichannel Chat Filtering:** Filter chats by All, Direct Messages (DMs), WhatsApp Groups, and status tags (**New, Interested, Ordered, VIP, Support, Closed**).
* **Deep Profile Inspection:** Real-time retrieval of contact profile pictures, status/bio, shared media, and cross-group message history.

### 📅 4. ReserveFlow Booking & Appointment Engine
* **Automated Calendar Scheduling:** Conflict prevention, appointment slotting, and secure cancellation tokens.
* **Branded Responsive HTML Confirmation Emails:** Sends branded booking and cancellation notices via SMTP.

### 🛍️ 5. Autonomous E-Commerce Order Pipeline
* **Intent-Driven Order Capture:** Identifies purchasing intent, captures line items, delivery addresses, and totals directly into PostgreSQL.
* **Google Sheets Webhook Sync:** Real-time event streaming to Google Sheets for logistics and operations teams.

<br/>

---

## 📱 Android Mobile App Companion

A pre-built, production-ready Android APK is bundled directly within this repository:

<div align="center">

[![Download Android APK](https://img.shields.io/badge/⬇️%20Download-whatsapp--pro--crm.apk%20(12.4%20MB)-25D366?style=for-the-badge&logo=android&logoColor=white)](whatsapp-pro-crm.apk)

*Built for Android 7.0 (API 24) through Android 16 (API 36) • Material Design 3 Dark Theme*

</div>

### Mobile App Highlights:
- **Bi-directional JavaScript Bridge:** Native vibration haptics on new messages, system toasts, and clipboard integration.
- **Hardware Voice Note Recorder:** Direct in-app microphone recording with native WAV-to-Opus audio pipelines.
- **Hardware Back Gesture Handling:** Intercepts back gestures to dismiss modals or navigate out of open chats cleanly.
- **Multi-Server Host Switcher:** Switch between Cloud Production (Railway), Local Wi-Fi (`http://192.168.x.x:5000`), or Localhost with integrated **Ping Latency Tester**.

<br/>

---

## 📦 Tech Stack

<div align="center">

| Layer | Component | Description |
| :--- | :--- | :--- |
| **Runtime & Server** | `Node.js (v20+)` • `Express 5` | High-throughput asynchronous event loop & REST API |
| **WhatsApp Engine** | `@whiskeysockets/baileys v7` | Persistent Multi-Device WebSocket Engine |
| **Real-Time Stream** | `Socket.io v4` | Low-latency bi-directional browser and mobile events |
| **Cloud Database** | `Neon PostgreSQL` (`pg`) | Serverless connection-pooled cloud database |
| **Local Fallback DB** | `better-sqlite3` | Zero-configuration embedded development database |
| **Audio Transcoding** | `FFmpeg` (`libopus`) | WhatsApp VoIP Opus OGG audio container encoding |
| **AI LLM & TTS** | `MicroMind` • `OpenAI TTS-1-HD` | Contextual conversational agent & HD audio synthesis |
| **Mobile Client** | `Android SDK 36` • `Kotlin` | Native Android wrapper with Material 3 Dark theme |
| **Containerization** | `Docker` | Multi-stage Docker container ready for cloud deployment |

</div>

<br/>

---

## ⚡ Quick Start

### 1. Prerequisites
* [Node.js](https://nodejs.org/) v20 or higher installed
* [FFmpeg](https://ffmpeg.org/) installed and available on system `PATH`
* [Git](https://git-scm.com/)

### 2. Clone and Install
```bash
git clone https://github.com/AbdoLailah586/whatsapp-pro-crm.git
cd whatsapp-pro-crm

npm install
```

### 3. Configure Environment Variables
Create a `.env` file in the root directory (or copy from `.env.example`):

```env
PORT=5000

# Neon PostgreSQL Database Connection URL
DATABASE_URL=postgresql://user:password@ep-host.neon.tech/neondb?sslmode=require

# Secret for signing JWT session cookies and mobile Bearer tokens
# Generate with: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
JWT_SECRET=your_super_secret_jwt_key_here

# MicroMind AI Chatflow Prediction Endpoint
MICROMIND_API_URL=https://core.aimicromind.com/api/v1/prediction/YOUR_CHATFLOW_ID

# Transactional Email Notification Credentials
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-gmail-app-password
EMAIL_SENDER_NAME="ReserveFlow & WhatsApp Pro"
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=465
```

### 4. Run the Server
```bash
npm start
```
Open `http://localhost:5000` in your browser. Register your initial account to claim Super Admin ownership, scan the generated WhatsApp QR code via **Linked Devices**, and start engaging!

<br/>

---

## 📡 API Reference

### 🔐 Authentication (`/api/auth`)
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/auth/register` | Register new user account (supports email or phone number). |
| `POST` | `/api/auth/login` | Authenticate user, returning JWT token and setting session cookie. |
| `POST` | `/api/auth/logout` | Terminate session and clear cookies. |
| `GET` | `/api/auth/me` | Fetch active user profile, admin status, and subscription state. |

### 👑 Super Admin (`/api/admin`)
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/admin/users` | List all platform tenants with subscription statistics. |
| `POST` | `/api/admin/users` | Create a new tenant account with specific duration presets. |
| `PATCH` | `/api/admin/users/:id` | Update tenant details, change status (`active`/`suspended`), or extend expiry. |
| `DELETE` | `/api/admin/users/:id` | Permanently remove a tenant account and purge associated auth keys. |

### 💬 Messaging & Chat (`/api/chat`)
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/chat/send` | Send text message to a specific contact or group JID. |
| `POST` | `/api/chat/send-media` | Upload and dispatch images, documents, or native voice notes. |
| `GET` | `/api/chat/history` | Retrieve paginated message history for a conversation. |
| `GET` | `/api/chat/contacts` | Fetch contact list with tags, unread counts, and last messages. |

### 📢 Anti-Ban Campaigns (`/api/campaigns`)
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/campaigns/start` | Launch new broadcast with micro-batching and cooldown guards. |
| `POST` | `/api/campaigns/pause` | Pause an ongoing campaign queue. |
| `POST` | `/api/campaigns/resume` | Resume a paused broadcast. |
| `POST` | `/api/campaigns/skip-cooldown` | Bypass active rest cooldown timer immediately. |
| `POST` | `/api/campaigns/cancel` | Terminate a running campaign queue safely. |

<br/>

---

## 🧪 Testing & Verification

The project includes unit and integration tests powered by Node.js native test runner:

```bash
# Run test suite
node --test
```
Verifies campaign execution resilience, non-WhatsApp number skipping, timeout guards, and cooldown timer state transitions.

<br/>

---

## 🐳 Docker Deployment

Run anywhere in an isolated, production-grade container:

```bash
# Build the Docker image
docker build -t whatsapp-pro-crm .

# Launch container with environment variables
docker run -d \
  -p 5000:5000 \
  --name whatsapp-crm \
  --env-file .env \
  whatsapp-pro-crm
```

<br/>

---

## 🔒 Security & Privacy Practices

* **Signal Key Protection:** Private WhatsApp cryptographic keys (`SessionEntry`) are automatically redacted from console and server logs via [`redactSignalLogs.js`](src/redactSignalLogs.js).
* **Multi-Tenant Isolation:** Database transactions enforce tenant-level segregation preventing cross-account data leaks.
* **SQL Injection Immunity:** All PostgreSQL and SQLite queries execute using strictly parameterized statements.
* **Transport Encryption:** TLS/SSL encryption is mandatory for cloud database pools, SMTP relays, and external webhook pipelines.

<br/>

---

## 📄 License

Distributed under the **[MIT License](LICENSE)**.

<br/>

<div align="center">
  <sub>Developed with ❤️ by <a href="https://github.com/AbdoLailah586"><b>Abdo Lailah</b></a></sub>
</div>
