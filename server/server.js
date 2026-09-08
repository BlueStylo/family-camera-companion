const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { openAccess, cookieValue, cookie, fail } = require("./auth");
const { MediaStore } = require("./media-store");
const { externalPath, loadCameras } = require("./config");
const CAMERAS = loadCameras();

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const PUBLIC_DIR = path.join(__dirname, "public");
const SITE_PUBLIC_DIR = path.resolve(__dirname, "../public");
const publicOrigin = process.env.PUBLIC_ORIGIN ? new URL(process.env.PUBLIC_ORIGIN).origin : null;
if (publicOrigin && !publicOrigin.startsWith("https://")) throw new Error("PUBLIC_ORIGIN must use HTTPS");
if (!publicOrigin && !["127.0.0.1", "::1", "localhost"].includes(HOST)) throw new Error("Network access requires PUBLIC_ORIGIN with HTTPS");
const access = openAccess();
const media = new MediaStore({
  db: access.db,
  directory: process.env.RECORDINGS_DIR ? externalPath("RECORDINGS_DIR") : path.join(externalPath("PRIVATE_DIR"), "01_Media"),
  external: Boolean(process.env.RECORDINGS_DIR),
});
const streamJobs = new Set();
const ptzLocks = new Set();
let shuttingDown = false;

const PROFILE_BY_QUALITY = {
  main: "PROFILE_000",
  sub: "PROFILE_001",
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".png": "image/png",
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(text);
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function findCamera(id) {
  return CAMERAS.find((camera) => camera.id === id);
}

function xmlValue(xml, tagName) {
  const direct = new RegExp(`<tt:${tagName}>([\\s\\S]*?)</tt:${tagName}>`).exec(xml);
  if (direct) return direct[1];

  const alternate = new RegExp(`<[^:>]+:${tagName}>([\\s\\S]*?)</[^:>]+:${tagName}>`).exec(xml);
  return alternate ? alternate[1] : null;
}

function decodeXmlEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function redact(value) {
  return String(value)
    .replace(/(?:rtsp|https?):\/\/[^\s<>"']+/gi, "[camera address]")
    .replace(/password=([^_&\s]+)/gi, "password=***")
    .replace(/user=([^_&\s]+)/gi, "user=***");
}

async function postOnvif(camera, service, body) {
  const response = await fetch(`http://${camera.ip}:8899/onvif/${service}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/soap+xml; charset=utf-8",
    },
    body,
    signal: AbortSignal.timeout(5000),
  });

  const text = await response.text();
  if (!response.ok || /<(?:\w+:)?Fault[\s>]/.test(text)) {
    throw new Error(`ONVIF ${service} failed for ${camera.id}: ${response.status}`);
  }

  return text;
}

async function getStreamUri(camera, quality) {
  const profileToken = PROFILE_BY_QUALITY[quality] || PROFILE_BY_QUALITY.sub;
  const body = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:trt="http://www.onvif.org/ver10/media/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema">
  <s:Body>
    <trt:GetStreamUri>
      <trt:StreamSetup>
        <tt:Stream>RTP-Unicast</tt:Stream>
        <tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport>
      </trt:StreamSetup>
      <trt:ProfileToken>${profileToken}</trt:ProfileToken>
    </trt:GetStreamUri>
  </s:Body>
</s:Envelope>`;

  const xml = await postOnvif(camera, "media_service", body);
  const uri = xmlValue(xml, "Uri");
  if (!uri) {
    throw new Error(`No RTSP URI returned for ${camera.id}`);
  }

  const parsed = new URL(decodeXmlEntities(uri));
  if (parsed.protocol !== "rtsp:") throw new Error("Unexpected stream protocol");
  parsed.hostname = camera.ip;
  return parsed.toString();
}

async function getSnapshotUri(camera, quality) {
  const profileToken = PROFILE_BY_QUALITY[quality] || PROFILE_BY_QUALITY.main;
  const body = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:trt="http://www.onvif.org/ver10/media/wsdl">
  <s:Body>
    <trt:GetSnapshotUri>
      <trt:ProfileToken>${profileToken}</trt:ProfileToken>
    </trt:GetSnapshotUri>
  </s:Body>
</s:Envelope>`;

  const xml = await postOnvif(camera, "media_service", body);
  const uri = xmlValue(xml, "Uri");
  if (!uri) {
    throw new Error(`No snapshot URI returned for ${camera.id}`);
  }

  const parsed = new URL(decodeXmlEntities(uri));
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Unexpected snapshot protocol");
  parsed.hostname = camera.ip;
  return parsed.toString();
}

async function getCameraStatus(camera) {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl">
  <s:Body><tds:GetSystemDateAndTime/></s:Body>
</s:Envelope>`;

  const xml = await postOnvif(camera, "device_service", body);
  const year = xmlValue(xml, "Year");
  const month = xmlValue(xml, "Month");
  const day = xmlValue(xml, "Day");
  const hour = xmlValue(xml, "Hour");
  const minute = xmlValue(xml, "Minute");
  const second = xmlValue(xml, "Second");
  const tz = xmlValue(xml, "TZ");

  if (!year || !month || !day) throw new Error("Invalid camera status response");
  return {
    online: true,
    deviceTime:
      year && month && day && hour && minute && second
        ? `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")} ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}:${second.padStart(2, "0")}`
        : null,
    timezone: tz,
  };
}

function serveStatic(req, res, requestUrl) {
  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendText(res, error.code === "ENOENT" ? 404 : 500, error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
}

function serveSite(req, res, requestUrl) {
  if (!["GET", "HEAD"].includes(req.method)) fail(405, "허용되지 않은 요청입니다.");
  if (!access.session(cookieValue(req, "villa_session"), true)) {
    if (requestUrl.pathname === "/site/" || requestUrl.pathname === "/site/index.html") {
      res.writeHead(302, { Location: "/", "Cache-Control": "no-store" }); res.end(); return;
    }
    fail(401, "로그인이 필요합니다.");
  }
  const relative = decodeURIComponent(requestUrl.pathname.slice("/site/".length)) || "index.html";
  const file = path.resolve(SITE_PUBLIC_DIR, relative);
  if (!file.startsWith(SITE_PUBLIC_DIR + path.sep)) fail(403, "허용되지 않은 경로입니다.");
  // Only this isolated model view needs SVG styles and generated texture URLs.
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  fs.readFile(file, (error, data) => {
    if (error) { sendText(res, error.code === "ENOENT" ? 404 : 500, "Not found"); return; }
    res.writeHead(200, { "Content-Type": MIME_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : data);
  });
}

async function handleMjpegStream(req, res, camera, quality) {
  if (streamJobs.size >= 16) fail(429, "동시 영상 접속이 많습니다. 잠시 후 다시 열어 주세요.");
  const rtspUri = await getStreamUri(camera, quality);
  if (res.destroyed || shuttingDown) return;
  const width = quality === "main" ? "1920" : "640";
  const fps = quality === "main" ? "12" : "8";
  const args = [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "warning",
    "-rtsp_transport",
    "tcp",
    "-fflags",
    "nobuffer",
    "-flags",
    "low_delay",
    "-i",
    rtspUri,
    "-an",
    "-vf",
    `fps=${fps},scale=${width}:-1`,
    "-q:v",
    "6",
    "-f",
    "mpjpeg",
    "-boundary_tag",
    "frame",
    "pipe:1",
  ];

  res.writeHead(200, {
    "Content-Type": "multipart/x-mixed-replace; boundary=frame",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    Connection: "close",
  });

  const ffmpeg = spawn("ffmpeg", args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let closed = false;
  let exited = false;
  let killTimer;
  let authTimer;
  const stop = () => {
    if (closed) return;
    closed = true;
    ffmpeg.kill("SIGTERM");
    clearInterval(authTimer);
    killTimer = setTimeout(() => {
      if (!exited) ffmpeg.kill("SIGKILL");
    }, 1500);
    killTimer.unref();
  };

  streamJobs.add(stop);
  res.on("close", stop);
  authTimer = setInterval(() => {
    if (!access.session(cookieValue(req, "villa_session"))) { stop(); res.destroy(); }
  }, 5000);
  authTimer.unref();

  ffmpeg.stdout.pipe(res);
  ffmpeg.stderr.on("data", (chunk) => {
    const message = redact(chunk.toString()).trim();
    if (message) console.warn(`[${camera.id}] ${message}`);
  });
  ffmpeg.on("error", (error) => {
    console.warn(`[${camera.id}] ffmpeg error: ${redact(error.message)}`);
    stop();
    res.destroy();
  });
  ffmpeg.on("close", () => {
    exited = true;
    clearTimeout(killTimer);
    clearInterval(authTimer);
    streamJobs.delete(stop);
    if (!res.destroyed) res.end();
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendPtzStop(camera) {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl">
  <s:Body>
    <tptz:Stop>
      <tptz:ProfileToken>PROFILE_000</tptz:ProfileToken>
      <tptz:PanTilt>true</tptz:PanTilt>
      <tptz:Zoom>true</tptz:Zoom>
    </tptz:Stop>
  </s:Body>
</s:Envelope>`;

  await postOnvif(camera, "ptz_service", body);
}

function ptzVector(direction, speed) {
  const amount = Math.max(0.1, Math.min(Number(speed) || 0.35, 1));
  const vectors = {
    up: { x: 0, y: amount, z: 0 },
    down: { x: 0, y: -amount, z: 0 },
    left: { x: -amount, y: 0, z: 0 },
    right: { x: amount, y: 0, z: 0 },
    zoomIn: { x: 0, y: 0, z: amount },
    zoomOut: { x: 0, y: 0, z: -amount },
  };

  return vectors[direction] || null;
}

async function sendPtzMove(camera, direction, speed, durationMs) {
  const vector = ptzVector(direction, speed);
  if (!vector) {
    throw new Error(`Unsupported PTZ direction: ${direction}`);
  }

  const hasPanTilt = vector.x !== 0 || vector.y !== 0;
  const hasZoom = vector.z !== 0;
  const velocity = [
    hasPanTilt ? `<tt:PanTilt x="${vector.x}" y="${vector.y}"/>` : "",
    hasZoom ? `<tt:Zoom x="${vector.z}"/>` : "",
  ].join("");

  const body = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema">
  <s:Body>
    <tptz:ContinuousMove>
      <tptz:ProfileToken>PROFILE_000</tptz:ProfileToken>
      <tptz:Velocity>${velocity}</tptz:Velocity>
      <tptz:Timeout>PT2S</tptz:Timeout>
    </tptz:ContinuousMove>
  </s:Body>
</s:Envelope>`;

  try {
    await postOnvif(camera, "ptz_service", body);
    const duration = Math.max(120, Math.min(Number(durationMs) || 420, 1200));
    await wait(duration);
  } finally {
    await sendPtzStop(camera);
  }
}

async function handlePtz(req, res, camera) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  const body = await readJsonBody(req);

  if (body.command === "stop") {
    await sendPtzStop(camera);
    sendJson(res, 200, { ok: true, command: "stop" });
    return;
  }

  if (body.command !== "move") fail(400, "올바른 제어 명령이 아닙니다.");
  if (ptzLocks.has(camera.id)) fail(409, "다른 조작이 진행 중입니다.");
  ptzLocks.add(camera.id);
  try { await sendPtzMove(camera, body.direction, body.speed, body.durationMs); }
  finally { ptzLocks.delete(camera.id); }
  sendJson(res, 200, {
    ok: true,
    command: "move",
    direction: body.direction,
  });
}

async function snapshotBuffer(camera, quality) {
  const snapshotUri = await getSnapshotUri(camera, quality);
  const response = await fetch(snapshotUri, {
    signal: AbortSignal.timeout(5000),
    redirect: "error",
  });

  if (!response.ok) {
    throw new Error(`Snapshot failed for ${camera.id}: ${response.status}`);
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 12 * 1024 ** 2) fail(502, "사진 크기가 너무 큽니다.");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function handleSnapshot(res, camera, quality) {
  const buffer = await snapshotBuffer(camera, quality);
  res.writeHead(200, {
    "Content-Type": "image/jpeg",
    "Cache-Control": "no-store",
  });
  res.end(buffer);
}

async function routeApi(req, res, requestUrl) {
  const parts = requestUrl.pathname.split("/").filter(Boolean);
  const sessionToken = cookieValue(req, "villa_session");
  const session = access.session(sessionToken, true);
  if (session) res.setHeader("Set-Cookie", cookie("villa_session", sessionToken, {
    secure: Boolean(publicOrigin), maxAge: session.remember ? (session.expires - Date.now()) / 1000 : undefined,
  }));

  if (requestUrl.pathname === "/api/session" && req.method === "GET") {
    sendJson(res, 200, { authenticated: Boolean(session), user: session });
    return;
  }
  if (requestUrl.pathname === "/api/auth/request" && req.method === "POST") {
    const body = await readJsonBody(req);
    const pending = access.request({ ...body, ip: req.socket.remoteAddress });
    res.setHeader("Set-Cookie", cookie("villa_pending", pending.secret, { secure: Boolean(publicOrigin), maxAge: 900 }));
    sendJson(res, 202, { code: pending.code, expires: pending.expires, status: "pending" });
    return;
  }
  if (requestUrl.pathname === "/api/auth/pending" && req.method === "GET") {
    sendJson(res, 200, access.pending(cookieValue(req, "villa_pending")));
    return;
  }
  if (requestUrl.pathname === "/api/auth/claim" && req.method === "POST") {
    const grant = access.claim(cookieValue(req, "villa_pending"));
    res.setHeader("Set-Cookie", [
      cookie("villa_pending", "", { secure: Boolean(publicOrigin), maxAge: 0 }),
      cookie("villa_session", grant.secret, { secure: Boolean(publicOrigin), maxAge: grant.remember ? (grant.expires - Date.now()) / 1000 : undefined }),
    ]);
    sendJson(res, 200, { ok: true });
    return;
  }
  if (!session) fail(401, "로그인이 필요합니다.");
  req.viewer = session;
  if (requestUrl.pathname === "/api/logout" && req.method === "POST") {
    access.revoke(session.id, session);
    res.setHeader("Set-Cookie", cookie("villa_session", "", { secure: Boolean(publicOrigin), maxAge: 0 }));
    sendJson(res, 200, { ok: true });
    return;
  }
  if (requestUrl.pathname === "/api/devices" && req.method === "GET") {
    sendJson(res, 200, { devices: access.devices(session), requests: session.role === "admin" ? access.requests() : [] });
    return;
  }
  if (requestUrl.pathname === "/api/devices/decision" && req.method === "POST") {
    if (session.role !== "admin") fail(403, "관리자 승인이 필요합니다.");
    const body = await readJsonBody(req);
    if (typeof body.allow !== "boolean") fail(400, "승인 여부를 선택해 주세요.");
    access.decide(body.code, body.allow, session.member);
    sendJson(res, 200, { ok: true });
    return;
  }
  if (requestUrl.pathname === "/api/devices/revoke" && req.method === "POST") {
    access.revoke((await readJsonBody(req)).id, session);
    sendJson(res, 200, { ok: true });
    return;
  }
  if (requestUrl.pathname === "/api/media" && req.method === "GET") {
    sendJson(res, 200, { files: media.list(), maxRecordingMinutes: 60 });
    return;
  }
  if (parts[1] === "media" && parts[3] === "file" && req.method === "GET") {
    const row = media.get(parts[2]);
    const filePath = media.file(row);
    if (!fs.existsSync(filePath)) fail(404, "저장장치를 연결해 주세요.");
    const size = fs.statSync(filePath).size;
    const headers = { "Content-Type": row.kind === "snapshot" ? "image/jpeg" : "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "no-store" };
    if (requestUrl.searchParams.get("download") === "1") headers["Content-Disposition"] = `attachment; filename="${row.camera}-${row.created}.${row.kind === "snapshot" ? "jpg" : "mp4"}"`;
    let start = 0, end = size - 1;
    if (req.headers.range) {
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!range || (!range[1] && !range[2])) fail(416, "올바르지 않은 재생 구간입니다.");
      if (!range[1]) start = Math.max(0, size - Number(range[2]));
      else { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); }
      if (start >= size || end < start) { res.setHeader("Content-Range", `bytes */${size}`); fail(416, "재생 구간을 벗어났습니다."); }
      headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    }
    headers["Content-Length"] = Math.max(0, end - start + 1);
    res.writeHead(req.headers.range ? 206 : 200, headers);
    if (size === 0) { res.end(); return; }
    const file = fs.createReadStream(filePath, { start, end });
    file.on("error", () => res.destroy());
    res.on("close", () => file.destroy());
    file.pipe(res);
    return;
  }

  if (requestUrl.pathname === "/api/cameras" && req.method === "GET") {
    sendJson(res, 200, {
      cameras: CAMERAS.map((camera) => ({
        id: camera.id,
        name: camera.name,
        capabilities: {
          liveView: true,
          rtsp: true,
          onvif: true,
          snapshot: true,
          ptz: true,
          audio: false,
          preferredQuality: "main",
          verified: false,
          preferredStream: "Main · 장치 사양 미확인",
          mainStream: "Main · 장치 사양 미확인",
          subStream: "Sub · 장치 사양 미확인",
        },
      })),
    });
    return;
  }

  if (parts[0] === "api" && parts[1] === "cameras" && parts[2]) {
    const camera = findCamera(parts[2]);
    if (!camera) {
      sendJson(res, 404, { error: "camera_not_found" });
      return;
    }

    const action = parts[3];
    const quality = requestUrl.searchParams.get("quality") === "main" ? "main" : "sub";
    if (action === "snapshot" && req.method === "POST") {
      const saved = media.snapshot(camera, session.member, await snapshotBuffer(camera, "main"));
      sendJson(res, 201, { file: saved });
      return;
    }
    if (action === "recording" && req.method === "POST") {
      const body = await readJsonBody(req);
      if (body.command === "start") sendJson(res, 202, await media.start(camera, session.member, getStreamUri));
      else if (body.command === "stop") { await media.stop(camera.id); sendJson(res, 200, { ok: true }); }
      else fail(400, "녹화 명령을 확인해 주세요.");
      return;
    }
    if (action !== "ptz" && req.method !== "GET") fail(405, "허용되지 않는 요청입니다.");

    if (action === "status") {
      try {
        sendJson(res, 200, await getCameraStatus(camera));
      } catch (error) {
        sendJson(res, 200, { online: false, error: error.message });
      }
      return;
    }

    if (action === "stream") {
      await handleMjpegStream(req, res, camera, quality);
      return;
    }

    if (action === "snapshot") {
      await handleSnapshot(res, camera, quality);
      return;
    }

    if (action === "ptz") {
      await handlePtz(req, res, camera);
      return;
    }
  }

  sendJson(res, 404, { error: "not_found" });
}

const server = http.createServer(async (req, res) => {
  try {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; img-src 'self' blob:; media-src 'self' blob:");
    const localOrigins = [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`, `http://[::1]:${PORT}`];
    const expectedOrigin = publicOrigin || `http://${req.headers.host}`;
    if (publicOrigin ? req.headers.host !== new URL(publicOrigin).host : !localOrigins.includes(expectedOrigin)) fail(403, "허용되지 않은 접속 주소입니다.");
    const requestUrl = new URL(req.url, expectedOrigin);
    if (req.method !== "GET" && req.method !== "HEAD") {
      if (req.headers.origin !== expectedOrigin || !String(req.headers["content-type"] || "").startsWith("application/json")) fail(403, "요청을 확인할 수 없습니다.");
    }
    if (shuttingDown) fail(503, "서버를 종료하고 있습니다.");
    if (requestUrl.pathname === "/favicon.ico") {
      res.writeHead(204, { "Cache-Control": "public, max-age=86400" });
      res.end();
      return;
    }

    if (requestUrl.pathname.startsWith("/api/")) {
      await routeApi(req, res, requestUrl);
      return;
    }

    if (requestUrl.pathname === "/site") {
      res.writeHead(302, { Location: "/site/", "Cache-Control": "no-store" }); res.end(); return;
    }
    if (requestUrl.pathname.startsWith("/site/")) {
      serveSite(req, res, requestUrl); return;
    }

    serveStatic(req, res, requestUrl);
  } catch (error) {
    if (!error.status) console.error(redact(error.stack || error.message));
    if (!res.headersSent) {
      sendJson(res, error.status || 500, { error: "request_failed", message: error.status ? error.message : "요청을 완료하지 못했습니다. 연결 상태를 확인해 주세요." });
    } else {
      res.destroy();
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Family Camera Companion listening on loopback port ${PORT}`);
});

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const stop of streamJobs) stop();
  server.close();
  await media.shutdown();
  server.closeAllConnections();
  setTimeout(() => process.exit(0), 1800).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
