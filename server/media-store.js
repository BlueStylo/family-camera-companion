const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { fail } = require("./auth");

class MediaStore {
  constructor({ db, directory, external = false, spawnProcess = spawn, minFreeBytes = 2 * 1024 ** 3, maxSeconds = 3600 }) {
    this.db = db;
    this.directory = directory;
    this.spawn = spawnProcess;
    this.minFreeBytes = minFreeBytes;
    this.maxSeconds = maxSeconds;
    this.jobs = new Map();
    if (!external) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.device = fs.statSync(directory).dev;
    this.db.exec(`CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY, camera TEXT, name TEXT, kind TEXT, status TEXT,
      created INTEGER, ended INTEGER, bytes INTEGER DEFAULT 0, owner TEXT, reason TEXT
    ); UPDATE media SET status='interrupted', reason='server_restart', ended=${Date.now()}
      WHERE status IN ('starting','recording','stopping');`);
  }

  checkStorage() {
    try {
      if (fs.statSync(this.directory).dev !== this.device) fail(503, "저장장치 연결을 확인해 주세요.");
      const stat = fs.statfsSync(this.directory);
      if (stat.bavail * stat.bsize < this.minFreeBytes) fail(507, "저장 공간이 부족합니다.");
    } catch (error) {
      if (error.status) throw error;
      fail(503, "저장장치 연결을 확인해 주세요.");
    }
  }

  file(row) { return path.join(this.directory, `${row.id}.${row.kind === "snapshot" ? "jpg" : "mp4"}`); }

  list() {
    return this.db.prepare("SELECT * FROM media ORDER BY created DESC LIMIT 200").all()
      .map((row) => ({ ...row, available: ["ready", "interrupted"].includes(row.status) && fs.existsSync(this.file(row)) }));
  }

  get(id) {
    const row = this.db.prepare("SELECT * FROM media WHERE id=?").get(id);
    if (!row || !["ready", "interrupted"].includes(row.status)) fail(404, "저장된 파일을 찾을 수 없습니다.");
    return row;
  }

  snapshot(camera, owner, buffer) {
    this.checkStorage();
    if (buffer.length < 3 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer.length > 12 * 1024 ** 2) {
      fail(502, "카메라에서 올바른 사진을 받지 못했습니다.");
    }
    const row = { id: crypto.randomUUID(), kind: "snapshot" };
    fs.writeFileSync(this.file(row), buffer, { flag: "wx", mode: 0o600 });
    try {
      this.db.prepare("INSERT INTO media VALUES (?, ?, ?, 'snapshot', 'ready', ?, ?, ?, ?, NULL)")
        .run(row.id, camera.id, camera.name, Date.now(), Date.now(), buffer.length, owner);
    } catch (error) { fs.unlinkSync(this.file(row)); throw error; }
    return this.get(row.id);
  }

  async start(camera, owner, getUri) {
    if (this.jobs.has(camera.id)) fail(409, "이미 녹화 중입니다.");
    this.checkStorage();
    const row = { id: crypto.randomUUID(), kind: "recording" };
    const job = { row, camera, child: null, stopping: false, reason: null, done: false };
    job.completion = new Promise((resolve) => { job.resolve = resolve; });
    this.jobs.set(camera.id, job);
    this.db.prepare("INSERT INTO media VALUES (?, ?, ?, 'recording', 'starting', ?, NULL, 0, ?, NULL)")
      .run(row.id, camera.id, camera.name, Date.now(), owner);
    try {
      const uri = await getUri(camera, "main");
      if (job.stopping) throw new Error("Recording canceled");
      this.checkStorage();
      // Copy camera video; only G.711 audio needs conversion for MP4 playback.
      const args = ["-nostdin", "-hide_banner", "-loglevel", "error", "-rtsp_transport", "tcp", "-rw_timeout", "10000000",
        "-i", uri, "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "copy", "-c:a", "aac", "-b:a", "64k",
        "-t", String(this.maxSeconds), "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
        "-progress", "pipe:1", "-n", this.file(row)];
      job.child = this.spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
      job.child.stdout.on("data", () => {
        if (!job.stopping && !job.done) this.db.prepare("UPDATE media SET status='recording' WHERE id=?").run(row.id);
      });
      job.child.stderr.on("data", () => { job.hadError = true; });
      job.child.once("error", () => this.finish(job, false, "start_failed"));
      job.child.once("close", (code) => this.finish(job, code === 0 || (job.stopping && !job.hadError), job.reason));
      job.timer = setInterval(() => {
        try { this.checkStorage(); } catch { this.stop(camera.id, "storage_unavailable"); }
      }, 3000);
      job.timer.unref();
      job.maxTimer = setTimeout(() => this.stop(camera.id, "time_limit"), this.maxSeconds * 1000);
      job.maxTimer.unref();
      return { id: row.id, status: "starting" };
    } catch (error) {
      this.finish(job, false, "connection_failed");
      throw error;
    }
  }

  finish(job, success, reason) {
    if (job.done) return;
    job.done = true;
    clearInterval(job.timer);
    clearTimeout(job.maxTimer);
    clearTimeout(job.killTimer);
    let bytes = 0;
    try { bytes = fs.statSync(this.file(job.row)).size; fs.chmodSync(this.file(job.row), 0o600); } catch {}
    const status = bytes > 0 ? (success ? "ready" : "interrupted") : "failed";
    this.db.prepare("UPDATE media SET status=?,ended=?,bytes=?,reason=? WHERE id=?")
      .run(status, Date.now(), bytes, reason || (success ? null : "recording_failed"), job.row.id);
    this.jobs.delete(job.camera.id);
    job.resolve?.();
  }

  stop(cameraId, reason = "user_stop") {
    const job = this.jobs.get(cameraId);
    if (!job) return;
    if (!job.stopping) {
      job.stopping = true;
      job.reason = reason;
      this.db.prepare("UPDATE media SET status='stopping' WHERE id=?").run(job.row.id);
      if (job.child) {
        job.child.kill("SIGINT");
        job.killTimer = setTimeout(() => { if (!job.done) job.child.kill("SIGKILL"); }, 2500);
        job.killTimer.unref();
      }
    }
    return job.completion;
  }

  async shutdown() {
    await Promise.all([...this.jobs.keys()].map((id) => this.stop(id, "server_shutdown")));
  }
}

module.exports = { MediaStore };
