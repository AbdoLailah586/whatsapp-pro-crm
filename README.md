<div align="center">

# ⚡ WhatsApp Pro CRM & AI Automation Engine

### *Enterprise Autonomous WhatsApp CRM with MicroMind LLM, OpenAI Speech Synthesis, Cloud Neon PostgreSQL, and Multi-Device Voice Engine*

[![Node.js](https://img.shields.io/badge/Node.js-v20+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![WhatsApp Baileys](https://img.shields.io/badge/WhatsApp-Baileys%20v7-25D366?style=for-the-badge&logo=whatsapp&logoColor=white)](https://github.com/WhiskeySockets/Baileys)
[![PostgreSQL](https://img.shields.io/badge/Database-Neon%20PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://neon.tech/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![OpenAI TTS](https://img.shields.io/badge/AI%20Audio-OpenAI%20TTS--1--HD-412991?style=for-the-badge&logo=openai&logoColor=white)](https://platform.openai.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

</div>

---

## 🌟 Executive Overview

**WhatsApp Pro CRM** is a cutting-edge, self-hosted omnichannel automation platform designed to turn WhatsApp into an enterprise-level customer relationship management (CRM) system. Powered by **MicroMind LLM Workflows**, **OpenAI Speech Synthesis**, and **Neon Cloud PostgreSQL**, it delivers real-time smart auto-replies, automated appointment booking, order pipeline tracking, and studio-grade voice note generation compatible with mobile and web clients.

---

## 🚀 Key Features

### 🤖 1. Autonomous AI Agent & MicroMind Workflow Engine
* **Context-Aware Conversational AI:** Automatically injects real-time customer data (Name, Phone Number, CRM Tag, Orders, Cairo Local Date/Time) into the LLM system prompt.
* **Human Takeover Mode:** Administrators can pause the AI bot for any individual contact directly from the dashboard to handle delicate customer interactions manually.
* **Fallback Hybrid Matching:** Combines LLM intelligence with fast regex and keyword-based rules for instant zero-latency responses.

### 🎙️ 2. Studio-Grade Voice Notes (PTT) Engine
* **OpenAI `tts-1-hd` Synthesis:** Generates human-like Arabic and multilingual speech using MicroMind and OpenAI TTS models.
* **Hardware-Accelerated FFmpeg Transcoding:** Automatically converts audio streams into **OGG Opus (`audio/ogg; codecs=opus`)** using WhatsApp VoIP profile constraints.
* **100% Mobile Playback Guarantee:** Eliminates decoding errors on iOS and Android devices, rendering native voice note waveforms and the green mic badge.

### 📊 3. Smart CRM Inbox & Reverse LID Resolution
* **Reverse LID Identity Mapper:** Parses and resolves internal WhatsApp 15-digit LID identifiers (e.g. `24940xxxxxxxxxx@lid`) back to real international phone numbers (e.g. `+20 1x xxxxxxxx`).
* **Omnichannel Chat Filters:** Fast filtering by **All**, **DMs (Private Chats)**, **WhatsApp Groups**, and customizable status tags (**New, Interested, Ordered, VIP, Support, Closed**).
* **Deep WhatsApp Profile Inspection:** Real-time retrieval of contact profile pictures, status/bio, shared media gallery, and cross-group message activity.

### 📅 4. ReserveFlow Booking & Appointment System
* **Automated Calendar Management:** Slot-based scheduling with conflict prevention and automated cancellation token generation.
* **Visual Responsive HTML Confirmation Emails:** Sends branded, mobile-responsive HTML confirmation and cancellation notices via SMTP.

### 🛍️ 5. E-Commerce Order Pipeline
* **Autonomous Order Capture:** Detects customer purchase intent, records order items, shipping details, and totals into PostgreSQL.
* **Google Sheets Webhook Sync:** Real-time data streaming to Google Sheets for inventory and logistics teams.

---

## 🛠️ System Architecture

```mermaid
graph TD
    Client[📱 WhatsApp User] <-->|Baileys WebSocket| Engine[⚡ Node.js WhatsApp Engine]
    Engine <-->|Socket.io Real-time| Dashboard[💻 Responsive Web CRM Dashboard]
    Engine <-->|SQL Queries & Pooling| Postgres[(🐘 Neon Cloud PostgreSQL)]
    Engine <-->|Prediction API| MicroMind[🧠 MicroMind LLM Workflows]
    MicroMind <-->|Speech Stream| TTS[🎙️ OpenAI TTS-1-HD]
    TTS -->|Raw Audio| FFmpeg[⚙️ FFmpeg Opus Encoder]
    FFmpeg -->|Native PTT OGG| Engine
    Engine <-->|SMTP HTML Notifications| Gmail[📧 Gmail Transactional Mailer]
    Engine <-->|Webhook Pipeline| Sheets[📊 Google Sheets]
```

---

## 📦 Tech Stack

| Component | Technology | Purpose |
| :--- | :--- | :--- |
| **Runtime** | Node.js (v20+ / v24) | High-throughput asynchronous event loop |
| **WhatsApp Protocol** | `@whiskeysockets/baileys` | Persistent Multi-Device WebSocket Engine |
| **Web Server** | Express.js 5 & Socket.io 4 | REST API & Bi-directional real-time events |
| **Cloud Database** | Neon PostgreSQL (`pg`) | Serverless connection-pooled cloud storage |
| **Local Fallback** | `better-sqlite3` | Zero-config embedded database |
| **Audio Processing** | `ffmpeg` (libopus) | VoIP Opus OGG audio container encoding |
| **AI LLM / TTS** | MicroMind + OpenAI | Conversational reasoning & High-definition speech |
| **Email Delivery** | Nodemailer (SMTP) | Visual HTML transactional email notifications |
| **Containerization**| Docker (Multi-stage) | Universal cloud and on-prem deployment |

---

## ⚡ Quick Start

### 1. Prerequisites
* [Node.js](https://nodejs.org/) v20 or higher installed
* [FFmpeg](https://ffmpeg.org/) installed and available on system `PATH`
* [Git](https://git-scm.com/)

### 2. Clone and Install

```bash
# Clone the repository
git clone https://github.com/AbdoLailah586/whatsapp-pro-crm.git
cd whatsapp-pro-crm

# Install dependencies
npm install
```

### 3. Configure Environment Variables
Create a `.env` file in the root directory (or copy `.env.example`):

```env
PORT=3000

# Neon PostgreSQL Database Connection
DATABASE_URL=postgresql://user:password@ep-host.neon.tech/neondb?sslmode=require

# MicroMind AI Chatflow Endpoint
MICROMIND_API_URL=https://core.aimicromind.com/api/v1/prediction/YOUR_CHATFLOW_ID

# Transactional Email Credentials
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
EMAIL_SENDER_NAME=ReserveFlow & WhatsApp Pro
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=465
```

### 4. Run Locally

```bash
# Start the application
npm start
```

Open your browser and navigate to:
Scan the QR code with your WhatsApp mobile app (**Linked Devices**) to start managing your chats!

---

## 🧠 MicroMind / Flowise Chatflow Template

This repository includes the complete, production-grade **MicroMind / Flowise Chatflow Workflow template** ready to import:

📁 **[`workflows/send_whatsapp_message_Chatflow.json`](workflows/send_whatsapp_message_Chatflow.json)**

### ⚙️ What's Inside the Workflow:
* **Custom AI Tools:** Built-in actions for order placement (`/api/tools/order`), appointment bookings (`/api/tools/book-appointment`), and WhatsApp messaging.
* **HD Speech Synthesis:** Native OpenAI `tts-1-hd` voice integration (`Alloy` voice profile) for instant Voice Note generation.
* **Conversational Memory:** Context-aware memory buffer retaining customer phone numbers, names, and session states.

### 📥 How to Import & Customize:
1. Open your **[MicroMind](https://aimicromind.com/)** or **Flowise** instance.
2. Click on **Add New Chatflow** (or the **+** button) and select **Load / Import Chatflow**.
3. Select the file: **[`workflows/send_whatsapp_message_Chatflow.json`](workflows/send_whatsapp_message_Chatflow.json)**.
4. Attach your OpenAI API credentials in the credential field.
5. Click **Save** and copy your **Prediction API URL**.
6. Paste the URL into your `.env` file as:
   ```env
   MICROMIND_API_URL=https://core.aimicromind.com/api/v1/prediction/YOUR_CHATFLOW_ID
   ```

---

## 🐳 Docker Deployment

Deploy anywhere with a single Docker command:

```bash
# Build the production image
docker build -t whatsapp-pro-crm .

# Run container with environment variables
docker run -d \
  -p 3000:3000 \
  --name whatsapp-crm \
  --env-file .env \
  whatsapp-pro-crm
```

---

## 🔄 Instant GitHub Sync

This repository includes a 1-click automated deployment script for Windows:

```bash
# Double-click push_to_github.bat or run:
npm run push
```

---

## 🔒 Security & Privacy Notice
* WhatsApp authentication tokens (`auth_info/`) are excluded from version control via `.gitignore`.
* All database transactions utilize parameterized SQL queries to eliminate SQL injection vectors.
* Secure TLS/SSL encryption is enforced for PostgreSQL and SMTP communication.

---

## 📄 License
This project is open-source software licensed under the **[MIT License](LICENSE)**.

<div align="center">
<sub>Built with passion for next-generation automated customer experiences.</sub>
</div>
