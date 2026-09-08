const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { AccessStore, cookie, normalizePhone } = require("./auth");

const members = [
  { id: "owner", name: "Test Owner", phone: "01000000001", role: "admin" },
  { id: "family", name: "Test Family", phone: "01000000002", role: "family" },
];
const setup = () => new AccessStore({ file: ":memory:", members });
function approve(store, phone = members[0].phone, remember = true) {
  const pending = store.request({ phone, label: "Test device", remember, ip: "test" });
  store.decide(pending.code, true, "local-console");
  return store.claim(pending.secret);
}

test("phone possession is not assumed; approval and secret are both required", () => {
  const store = setup();
  try {
    const pending = store.request({ phone: members[0].phone, label: "device", remember: true, ip: "test" });
    assert.throws(() => store.claim(pending.secret), { status: 403 });
    store.decide(pending.code, true, "local-console");
    assert.throws(() => store.claim(pending.code), { status: 403 });
    const grant = store.claim(pending.secret);
    assert.equal(grant.role, "admin");
    assert.throws(() => store.claim(pending.secret), { status: 403 });
    assert.notEqual(store.db.prepare("SELECT secret FROM sessions").get().secret, grant.secret);
    assert.equal(store.session(grant.secret + "tampered"), null);
  } finally { store.close(); }
});

test("unlisted numbers are not disclosed or approvable", () => {
  const store = setup();
  try {
    const unknown = store.request({ phone: "01000000003", label: "device", ip: "test" });
    assert.equal(store.pending(unknown.secret).status, "pending");
    assert.equal(store.requests().length, 0);
    assert.throws(() => store.decide(unknown.code, true, "local-console"), { status: 404 });
  } finally { store.close(); }
});

test("idle and absolute expiry are enforced independently", () => {
  let now = Date.now();
  const day = 86400000;
  const store = new AccessStore({ file: ":memory:", members, now: () => now });
  try {
    const grant = approve(store);
    now += 80 * day;
    assert.ok(store.session(grant.secret, true));
    now += 80 * day;
    assert.ok(store.session(grant.secret, true));
    now += 21 * day;
    assert.equal(store.session(grant.secret), null);
    const second = approve(store);
    now += 91 * day;
    assert.equal(store.session(second.secret), null);
  } finally { store.close(); }
});

test("requests expire and per-number rate limit applies", () => {
  let now = Date.now();
  const store = new AccessStore({ file: ":memory:", members, now: () => now });
  try {
    const req = store.request({ phone: members[0].phone, ip: "test" });
    for (let n = 0; n < 4; n++) store.request({ phone: members[0].phone, ip: `test${n}` });
    assert.throws(() => store.request({ phone: members[0].phone, ip: "another" }), { status: 429 });
    now += 16 * 60000;
    assert.equal(store.pending(req.secret).status, "expired");
    assert.throws(() => store.decide(req.code, true, "local-console"), { status: 404 });
  } finally { store.close(); }
});

test("session survives restart and revocation; family cannot revoke owner", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "villa-auth-"));
  const file = path.join(directory, "access.sqlite");
  let store = new AccessStore({ file, members });
  try {
    const owner = approve(store);
    const family = approve(store, members[1].phone);
    assert.throws(() => store.revoke(owner.id, family), { status: 403 });
    assert.equal(store.devices(family).length, 1);
    store.close();
    store = new AccessStore({ file, members });
    assert.ok(store.session(owner.secret));
    store.revoke(family.id, owner);
    assert.equal(store.session(family.secret), null);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  } finally { store.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test("cookie and Korean country-code normalization", () => {
  assert.equal(normalizePhone("+82 10-0000-0001"), "01000000001");
  const value = cookie("villa_session", "test", { secure: true, maxAge: 20 });
  for (const attribute of ["HttpOnly", "SameSite=Strict", "Secure", "Max-Age=20"]) assert.ok(value.includes(attribute));
  assert.ok(!cookie("villa_session", "test").includes("Max-Age"));
});
