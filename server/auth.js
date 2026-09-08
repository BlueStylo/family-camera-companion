const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { externalPath } = require("./config");

const DAY = 86400000;
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const token = () => crypto.randomBytes(32).toString("base64url");
const normalizePhone = (value) => String(value || "").replace(/[^0-9]/g, "").replace(/^82/, "0");

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

class AccessStore {
  constructor({ file, members, now = Date.now }) {
    this.now = now;
    this.members = members.map((member) => ({ ...member, phone: normalizePhone(member.phone) }));
    if (!this.members.length || new Set(this.members.map((m) => m.phone)).size !== this.members.length ||
        this.members.some((m) => !/^010\d{8}$/.test(m.phone)) ||
        !this.members.some((m) => m.role === "admin")) throw new Error("Invalid family configuration");
    if (file !== ":memory:") {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      fs.closeSync(fs.openSync(file, "a", 0o600));
      fs.chmodSync(file, 0o600);
    }
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS requests (
        secret TEXT PRIMARY KEY, code TEXT UNIQUE, member TEXT, label TEXT,
        remember INTEGER, status TEXT, created INTEGER, expires INTEGER, approved_by TEXT
      );
      CREATE TABLE IF NOT EXISTS sessions (
        secret TEXT PRIMARY KEY, id TEXT UNIQUE, member TEXT, label TEXT,
        remember INTEGER, created INTEGER, expires INTEGER, absolute INTEGER,
        last_seen INTEGER, revoked INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, start INTEGER, count INTEGER);`);
  }

  limit(key, max) {
    const now = this.now();
    this.db.prepare("DELETE FROM attempts WHERE start < ?").run(now - 15 * 60000);
    const row = this.db.prepare(`INSERT INTO attempts VALUES (?, ?, 1)
      ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count`).get(hash(key), now);
    if (row.count > max) fail(429, "잠시 후 다시 요청해 주세요.");
  }

  request({ phone, label, remember, ip }) {
    this.limit(`ip:${ip}`, 30);
    const normalized = normalizePhone(phone);
    this.limit(`phone:${normalized}`, 5);
    const now = this.now();
    this.db.prepare("DELETE FROM requests WHERE expires < ?").run(now);
    const member = this.members.find((m) => m.phone === normalized);
    const secret = token();
    const code = crypto.randomBytes(4).toString("hex").toUpperCase();
    this.db.prepare("INSERT INTO requests VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, NULL)").run(
      hash(secret), code, member?.id || null,
      String(label || "내 기기").trim().slice(0, 60), remember ? 1 : 0, now, now + 15 * 60000,
    );
    return { secret, code, expires: now + 15 * 60000 };
  }

  pending(secret) {
    const row = this.db.prepare("SELECT * FROM requests WHERE secret=? AND expires>?").get(hash(secret || ""), this.now());
    return row ? { code: row.code, status: row.status, expires: row.expires } : { status: "expired" };
  }

  requests() {
    return this.db.prepare("SELECT * FROM requests WHERE status='pending' AND expires>? AND member IS NOT NULL ORDER BY created DESC")
      .all(this.now()).map((row) => {
        const member = this.members.find((m) => m.id === row.member);
        return member ? { code: row.code, name: member.name, phone: `${member.phone.slice(0, 3)}-****-${member.phone.slice(-4)}`,
          label: row.label, created: row.created } : null;
      }).filter(Boolean);
  }

  decide(code, allow, approvedBy) {
    const row = this.db.prepare("SELECT member FROM requests WHERE code=? AND status='pending' AND expires>?")
      .get(String(code).replace(/-/g, "").toUpperCase(), this.now());
    if (!row || !this.members.some((m) => m.id === row.member)) fail(404, "유효한 승인 요청이 없습니다.");
    this.db.prepare("UPDATE requests SET status=?, approved_by=? WHERE code=?").run(
      allow ? "approved" : "denied", approvedBy, String(code).replace(/-/g, "").toUpperCase(),
    );
  }

  claim(secret) {
    const now = this.now();
    const newSecret = token();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare("SELECT * FROM requests WHERE secret=? AND status='approved' AND expires>?")
        .get(hash(secret || ""), now);
      if (!row || !this.members.some((m) => m.id === row.member)) fail(403, "기기 승인이 필요합니다.");
      const absolute = now + (row.remember ? 180 * DAY : DAY);
      const expires = Math.min(now + (row.remember ? 90 * DAY : DAY), absolute);
      this.db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)").run(
        hash(newSecret), crypto.randomUUID(), row.member, row.label, row.remember, now, expires, absolute, now,
      );
      this.db.prepare("DELETE FROM requests WHERE secret=?").run(hash(secret));
      this.db.exec("COMMIT");
      return { secret: newSecret, ...this.session(newSecret) };
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  session(secret, touch = false) {
    if (!secret) return null;
    const now = this.now();
    const row = this.db.prepare("SELECT * FROM sessions WHERE secret=? AND revoked=0 AND expires>? AND absolute>?")
      .get(hash(secret), now, now);
    const member = row && this.members.find((m) => m.id === row.member);
    if (!member) return null;
    if (touch && now - row.last_seen >= 5 * 60000) {
      row.expires = Math.min(now + (row.remember ? 90 * DAY : DAY), row.absolute);
      this.db.prepare("UPDATE sessions SET expires=?,last_seen=? WHERE secret=?").run(row.expires, now, hash(secret));
    }
    return { id: row.id, member: member.id, name: member.name, role: member.role,
      label: row.label, remember: Boolean(row.remember), expires: row.expires };
  }

  devices(viewer) {
    return this.db.prepare("SELECT id,member,label,created,last_seen,expires FROM sessions WHERE revoked=0 AND expires>? AND absolute>?")
      .all(this.now(), this.now()).filter((row) => viewer.role === "admin" || row.member === viewer.member)
      .map((row) => ({ ...row, name: this.members.find((m) => m.id === row.member)?.name || "등록 해제됨" }));
  }

  revoke(id, viewer) {
    const row = this.db.prepare("SELECT member FROM sessions WHERE id=?").get(id);
    if (!row || (viewer.role !== "admin" && viewer.member !== row.member)) fail(403, "기기를 해제할 권한이 없습니다.");
    this.db.prepare("UPDATE sessions SET revoked=1 WHERE id=?").run(id);
  }

  close() { this.db.close(); }
}

function openAccess() {
  const privateDir = externalPath("PRIVATE_DIR");
  const membersFile = externalPath("FAMILY_MEMBERS_FILE");
  fs.chmodSync(membersFile, 0o600);
  return new AccessStore({ file: path.join(privateDir, "access.sqlite"), members: JSON.parse(fs.readFileSync(membersFile, "utf8")) });
}

function cookieValue(req, name) {
  return String(req.headers.cookie || "").split(";").map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) || "";
}

function cookie(name, value, { secure, maxAge } = {}) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}${maxAge === undefined ? "" : `; Max-Age=${Math.max(0, Math.floor(maxAge))}`}`;
}

module.exports = { AccessStore, openAccess, cookieValue, cookie, fail, normalizePhone };
