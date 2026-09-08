const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { EventEmitter } = require("node:events");
const { spawn, execFileSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { MediaStore } = require("./media-store");
const camera = { id: "fixture", name: "Fixture camera" };

function setup(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "villa-media-"));
  const db = new DatabaseSync(":memory:");
  const store = new MediaStore({ db, directory, minFreeBytes: 0, ...options });
  return { directory, db, store, close() { db.close(); fs.rmSync(directory, { recursive: true, force: true }); } };
}

test("snapshot validation, private storage, and disk floor", () => {
  const ctx = setup();
  try {
    assert.throws(() => ctx.store.snapshot(camera, "test", Buffer.from("not an image")), { status: 502 });
    const saved = ctx.store.snapshot(camera, "test", Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    assert.equal(ctx.store.list().length, 1);
    assert.equal(fs.statSync(ctx.store.file(saved)).mode & 0o777, 0o600);
    ctx.store.minFreeBytes = Number.MAX_SAFE_INTEGER;
    assert.throws(() => ctx.store.checkStorage(), { status: 507 });
  } finally { ctx.close(); }
});

test("one recording per camera even while awaiting URI; cancellation settles", async () => {
  const ctx = setup();
  try {
    let resolveUri;
    const pending = ctx.store.start(camera, "test", () => new Promise((resolve) => { resolveUri = resolve; }));
    await assert.rejects(ctx.store.start(camera, "test", async () => "fixture"), { status: 409 });
    const stop = ctx.store.stop(camera.id);
    resolveUri("fixture");
    await assert.rejects(pending, /canceled/);
    await stop;
    assert.equal(ctx.store.jobs.size, 0);
    assert.equal(ctx.store.list()[0].status, "failed");
  } finally { ctx.close(); }
});

test("spawn error closes recording job", async () => {
  let child;
  const ctx = setup({ spawnProcess() {
    child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    return child;
  } });
  try {
    await ctx.store.start(camera, "test", async () => "fixture");
    child.emit("error", new Error("ENOENT"));
    assert.equal(ctx.store.jobs.size, 0);
    assert.equal(ctx.store.list()[0].status, "failed");
  } finally { ctx.close(); }
});

test("real FFmpeg copies synthetic H.264 and converts G.711 into playable MP4", async (t) => {
  try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); } catch { t.skip("FFmpeg unavailable"); return; }
  let realtime = false;
  const ctx = setup({ maxSeconds: 10, spawnProcess(command, args, options) {
    const filtered = args.filter((arg, i) => !["-rtsp_transport", "-rw_timeout"].includes(arg) &&
      !["-rtsp_transport", "-rw_timeout"].includes(args[i - 1]));
    if (realtime) filtered.splice(filtered.indexOf("-i"), 0, "-re");
    return spawn(command, filtered, options);
  } });
  try {
    const input = path.join(ctx.directory, "fixture.mkv");
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=10", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=8000",
      "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "pcm_alaw", input], { stdio: "pipe" });
    await ctx.store.start(camera, "test", async () => input);
    await ctx.store.jobs.get(camera.id).completion;
    const row = ctx.store.list()[0];
    assert.equal(row.status, "ready");
    assert.ok(row.bytes > 0);
    const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-of", "json", ctx.store.file(row)], { encoding: "utf8" }));
    assert.deepEqual(probe.streams.map((stream) => stream.codec_name), ["h264", "aac"]);
    assert.equal(probe.streams[0].width, 320);
    realtime = true;
    await ctx.store.start(camera, "test", async () => input);
    await new Promise((resolve) => setTimeout(resolve, 800));
    await ctx.store.stop(camera.id);
    const stopped = ctx.store.list()[0];
    assert.equal(stopped.status, "ready");
    const stoppedProbe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-of", "json", ctx.store.file(stopped)], { encoding: "utf8" }));
    assert.equal(stoppedProbe.streams[0].codec_name, "h264");
  } finally { ctx.close(); }
});
