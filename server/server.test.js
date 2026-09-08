const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn, execFileSync } = require("node:child_process");
const { AccessStore } = require("./auth");
const { MediaStore } = require("./media-store");

test("HTTP approval, authorization, media range requests, restart and logout", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "villa-http-"));
  const members = [
    { id: "owner", name: "Test Owner", phone: "01000000001", role: "admin" },
    { id: "family", name: "Test Family", phone: "01000000002", role: "family" },
  ];
  const membersFile = path.join(directory, "members.json");
  fs.writeFileSync(membersFile, JSON.stringify(members), { mode: 0o600 });
  const camerasFile = path.join(directory, "cameras.json");
  fs.writeFileSync(camerasFile, JSON.stringify(Array.from({length:5}, (_,i)=>({ id: "camera-" + (i+1), name: "Test camera", ip: "127.0.0.1" }))));
  const port = await new Promise((resolve) => {
    const socket = net.createServer(); socket.listen(0, "127.0.0.1", () => {
      const port = socket.address().port; socket.close(() => resolve(port));
    });
  });
  const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, PORT: String(port), HOST: "127.0.0.1", PUBLIC_ORIGIN: "", RECORDINGS_DIR: "", PRIVATE_DIR: directory, FAMILY_MEMBERS_FILE: membersFile, CAMERAS_FILE: camerasFile };
  let child;
  async function start() {
    child = spawn(process.execPath, ["server.js"], { cwd: __dirname, env, stdio: ["ignore", "pipe", "pipe"] });
    await new Promise((resolve, reject) => {
      child.stdout.on("data", (data) => { if (data.toString().includes("listening")) resolve(); });
      child.once("exit", (code) => reject(new Error(`Server exited ${code}`)));
      child.once("error", reject);
    });
  }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await exited;
  }
  async function call(url, body, cookies = "", origin = base) {
    return fetch(base + url, { method: body === undefined ? "GET" : "POST",
      headers: { Cookie: cookies, Origin: origin, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body) });
  }
  const cookieHeader = (response, name) => response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`)).split(";")[0];
  async function request(phone) {
    const response = await call("/api/auth/request", { phone, label: "Test browser", remember: true });
    assert.equal(response.status, 202);
    return { pending: cookieHeader(response, "villa_pending"), code: (await response.json()).code };
  }
  async function claim(pending) {
    const response = await call("/api/auth/claim", {}, pending);
    assert.equal(response.status, 200);
    assert.match(response.headers.getSetCookie().join(";"), /HttpOnly/);
    return cookieHeader(response, "villa_session");
  }
  try {
    await start();
    for (const url of ["/api/cameras", "/api/media", "/api/devices", "/api/cameras/camera-1/stream", "/api/cameras/camera-1/snapshot"]) {
      assert.equal((await call(url)).status, 401, url);
    }
    assert.equal((await call("/site/assets/site.json")).status, 401);
    assert.equal((await fetch(base + "/site/", { redirect: "manual" })).status, 302);
    assert.equal((await call("/api/auth/request", { phone: members[0].phone }, "", "https://untrusted.example")).status, 403);
    const ownerRequest = await request(members[0].phone);
    assert.equal((await call("/api/auth/claim", {}, ownerRequest.pending)).status, 403);
    execFileSync(process.execPath, ["access.js", "approve", ownerRequest.code], { cwd: __dirname, env, stdio: "pipe" });
    const owner = await claim(ownerRequest.pending);
    const sitePage = await call("/site/", undefined, owner);
    assert.equal(sitePage.status, 200);
    assert.match(await sitePage.text(), /Family Camera Companion/);
    assert.match(sitePage.headers.get("content-security-policy"), /script-src 'self'/);
    assert.equal((await call("/site/%2e%2e%2fpackage.json", undefined, owner)).status, 403);
    const reference = await call("/site/assets/site.json", undefined, owner);
    assert.equal(reference.status, 200);
    assert.match(reference.headers.get("content-type"), /application\/json/);
    const inventory = await (await call("/api/cameras", undefined, owner)).json();
    assert.equal(inventory.cameras.length, 5);
    assert.ok(inventory.cameras.every(c=>!c.ip&&!c.serialHint));
    assert.equal((await call("/family-members.local.json")).status, 404);
    const familyRequest = await request(members[1].phone);
    const adminDevices = await (await call("/api/devices", undefined, owner)).json();
    assert.equal(adminDevices.requests.length, 1);
    assert.ok(!JSON.stringify(adminDevices).includes(members[1].phone));
    assert.equal((await call("/api/devices/decision", { code: familyRequest.code, allow: true }, owner)).status, 200);
    const family = await claim(familyRequest.pending);
    assert.equal((await call("/api/devices/decision", { code: "test", allow: true }, family)).status, 403);

    const fixtureStore = new AccessStore({ file: path.join(directory, "access.sqlite"), members });
    const media = new MediaStore({ db: fixtureStore.db, directory: path.join(directory, "01_Media"), minFreeBytes: 0 });
    const image = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0xff, 0xd9]);
    const saved = media.snapshot({ id: "fixture", name: "Fixture" }, "owner", image);
    fixtureStore.close();
    assert.equal((await call(`/api/media/${saved.id}/file`)).status, 401);
    const download = await call(`/api/media/${saved.id}/file?download=1`, undefined, family);
    assert.match(download.headers.get("content-disposition"), /attachment/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), image);
    const range = await fetch(`${base}/api/media/${saved.id}/file`, { headers: { Cookie: family, Range: "bytes=0-2" } });
    assert.equal(range.status, 206);
    assert.deepEqual(Buffer.from(await range.arrayBuffer()), image.subarray(0, 3));

    await stop(); await start();
    assert.equal((await (await call("/api/session", undefined, owner)).json()).authenticated, true);
    assert.equal((await (await call("/api/media", undefined, family)).json()).files.length, 1);
    const familySession = (await (await call("/api/session", undefined, family)).json()).user;
    assert.equal((await call("/api/devices/revoke", { id: familySession.id }, owner)).status, 200);
    assert.equal((await call("/api/cameras", undefined, family)).status, 401);
    await call("/api/logout", {}, owner);
    assert.equal((await call("/api/cameras", undefined, owner)).status, 401);
  } finally { await stop(); fs.rmSync(directory, { recursive: true, force: true }); }
});
