# 🤖 WhatsApp Pro CRM - AI Agent SDK & Documentation

> **Target Audience:** This document is designed for LLMs, AI Agents (like MicroMind, GitHub Copilot, Gemini, ChatGPT), and autonomous coding assistants interacting with the `whatsapp-pro-automation` repository.

## 📖 1. Project Overview & Identity
**WhatsApp Pro CRM** is a Node.js-based, self-hosted omnichannel automation platform that turns WhatsApp into a CRM. 
It uses `@whiskeysockets/baileys` to connect to WhatsApp Web via WebSockets, acting as a real device. It leverages **MicroMind LLM** for intelligent conversational replies, **Neon PostgreSQL** for database state (with a local `better-sqlite3` fallback), and **OpenAI TTS-1-HD** (via MicroMind or directly) for generating studio-grade Voice Notes (PTT).

## 🏗️ 2. Core Architecture & Data Flow
1. **WhatsApp Engine (`src/whatsapp.js`)**: Connects to Meta's servers. Listens for `messages.upsert`.
2. **AI & Automation (`src/autoReply.js` & `src/automationTools.js`)**: When a message arrives, it maps the sender's LID/JID, fetches their CRM profile from Postgres, and injects this context into the MicroMind API.
3. **Database (`src/database.js`)**: Manages `contacts`, `messages`, `orders_leads`, and `bookings_appointments`.
4. **Voice Processing**: Text-to-Speech audio is downloaded, then passed through `ffmpeg` to encode it as `audio/ogg; codecs=opus` so WhatsApp renders it natively as a Voice Note (with the green microphone icon).
5. **Dashboard (`src/server.js` & `src/public/*`)**: An Express/Socket.io server that powers a real-time web UI for human agents to monitor chats, take over (pause AI), and manage orders.

## 📁 3. File Directory & Responsibilities

| File / Folder | Role & Agent Instructions |
| :--- | :--- |
| `src/whatsapp.js` | **Core WhatsApp Socket:** Handles Baileys connection, QR generation, and message parsing. **Do not modify** the `makeWASocket` config unless you know Baileys internals. |
| `src/server.js` | **Express Backend:** Serves the frontend and provides Socket.io endpoints for real-time CRM updates. |
| `src/database.js` | **Storage Layer:** Uses `pg` (Postgres) by default. **Rule:** ALWAYS use parameterized queries (e.g., `text: 'SELECT * FROM users WHERE id = $1', values: [id]`) to prevent SQL injection. |
| `src/autoReply.js` | **AI Logic:** Calls the MicroMind API. Handles the "Human Takeover" check. If `humanMode` is active for a user, this file bypasses the AI call. |
| `src/automationTools.js` | **Business Logic:** Order placement, webhooks to Google Sheets, etc. |
| `src/bookingEngine.js` | **Calendar:** Logic for checking available slots and saving appointments. |
| `src/lidMapper.js` | **Identity Resolution:** Converts internal `@lid` identifiers to actual `@s.whatsapp.net` phone numbers. |
| `src/emailNotifier.js` | **SMTP Mailer:** Sends transactional HTML emails using Nodemailer. |
| `src/public/*` | **Frontend:** Vanilla JS (`app.js`), CSS (`style.css`), and HTML (`index.html`). Uses Socket.io-client. |
| `auth_info/` | **Session State:** Where Baileys saves encryption keys. **NEVER track this in Git.** |

## 🚨 4. Modification Rules & AI Constraints (Do's and Don'ts)

### ✅ DO (Allowed & Recommended)
* **Parameterize SQL**: Always use `$1, $2` in Postgres queries.
* **Keep Socket.io Synced**: If you add a new database event (e.g., a new order), make sure to emit a Socket.io event in `server.js` so the frontend updates in real-time without refreshing.
* **Format Audio Correctly**: If modifying Voice Note logic, you MUST use `ffmpeg` to convert audio to `.ogg` with Opus codec (`-c:a libopus -b:a 16k -vbr on -compression_level 10 -frame_duration 20 -application voip`). Otherwise, mobile clients will fail to play it.
* **Graceful Degradation**: Always wrap external API calls (MicroMind, OpenAI, Neon) in `try/catch` blocks.

### ❌ DON'T (Strictly Prohibited)
* **Don't block the Event Loop**: Node.js is single-threaded. Do not use synchronous file reads/writes (`readFileSync`) inside the message handler loop.
* **Don't expose `.env` keys**: Never hardcode API keys or Database URLs in the code. Always use `process.env`.
* **Don't modify Baileys Authentication carelessly**: Messing with how `useMultiFileAuthState` works will corrupt the WhatsApp session, requiring the user to re-scan the QR code.
* **Don't treat this as Serverless**: This application relies on persistent WebSockets and local file storage (`auth_info/`). It **cannot** be deployed to serverless environments (like Vercel or AWS Lambda) without a complete architectural rewrite.

## 🛠️ 5. How Features Work

*   **Reverse LID Mapping**: WhatsApp hides actual phone numbers behind a 15-digit LID for privacy in some contexts. The CRM intercepts profile updates and maps the LID back to the phone number using `lidMapper.js`, ensuring the database always stores the real number.
*   **Human Takeover**: If an admin replies via the Dashboard, the CRM tags the contact with `is_paused = true` in the DB or memory. The AI (`autoReply.js`) checks this flag and skips replying until the admin reactivates it.
*   **MicroMind Integration**: It sends a structured prompt containing the `system_message`, `context` (user's past orders, name, tags), and the `user_message`. MicroMind streams the text back, which is then optionally sent to TTS.
