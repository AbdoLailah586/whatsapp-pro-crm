// ============================================================
// Authentication helpers: password hashing + signed session tokens.
//
// Sessions are a JWT stored in an httpOnly cookie - no server-side
// session store needed. bcryptjs and jsonwebtoken are both pure-JS
// (no native compilation), so they install cleanly everywhere
// better-sqlite3 already needs a native build.
// ============================================================

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const COOKIE_NAME = "wapro_session";
const TOKEN_TTL = "180d"; // "stay logged in" - long-lived, matches the WhatsApp-style "keep me signed in on this device" expectation

const DATA_DIR = path.join(__dirname, "..", "data");
const SECRET_FILE = path.join(DATA_DIR, ".session_secret");

function getSecret() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 16) {
    return process.env.JWT_SECRET;
  }
  // Dev/fallback: persist a generated secret locally so restarts don't
  // invalidate everyone's session. In production (Railway), set the
  // JWT_SECRET environment variable explicitly instead of relying on this.
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(SECRET_FILE)) {
      const existing = fs.readFileSync(SECRET_FILE, "utf-8").trim();
      if (existing) return existing;
    }
    const generated = crypto.randomBytes(48).toString("hex");
    fs.writeFileSync(SECRET_FILE, generated, "utf-8");
    console.warn(
      "⚠️ [Auth] JWT_SECRET env var is not set - generated a local one at data/.session_secret. " +
      "Set JWT_SECRET in your environment (Railway variables) so sessions survive redeploys."
    );
    return generated;
  } catch (e) {
    console.error("⚠️ [Auth] Could not persist a session secret, using an in-memory one (sessions will not survive a restart):", e.message);
    return crypto.randomBytes(48).toString("hex");
  }
}

const SECRET = getSecret();

async function hashPassword(plain) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(plain, salt);
}

async function verifyPassword(plain, hash) {
  if (!plain || !hash) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch (e) {
    return false;
  }
}

function signToken(user) {
  return jwt.sign(
    { uid: user.id, email: user.email },
    SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch (e) {
    return null;
  }
}

function setSessionCookie(res, user) {
  const token = signToken(user);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 180 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

module.exports = {
  COOKIE_NAME,
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  setSessionCookie,
  clearSessionCookie,
  isValidEmail,
};
