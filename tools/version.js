/* WO-014 phase 0: the version contract, proven rather than asserted.
 *
 *   node tools/version.js
 *
 * Part A loads the REAL relay source into a stubbed Apps Script environment and
 * sends it requests, so "every response carries the version" and "a mismatched
 * request is rejected by name" are proven by sending one, not by reading the code.
 *
 * The console side (the banner and the gate on the rendered page) is proven in
 * tools/version.py, which drives Chromium the way every other visual check here
 * does. This file is the relay half and the static half.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.dirname(__dirname);
let fails = 0;
function ck(name, cond, detail) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) { fails++; if (detail !== undefined) console.log("      " + String(detail).slice(0, 200)); }
}

/* ===================== Part A: the relay, in a stubbed GAS sandbox ===================== */

function loadRelay() {
  // Only the surface the version-check and auth-error paths touch needs a stub.
  // Anything deeper (Drive, Gmail, Lock) is defined by the file but never called
  // on these paths, so leaving those globals absent is fine.
  const out = { _s: "", setMimeType() { return this; }, getContent() { return this._s; } };
  const ContentService = {
    MimeType: { JSON: "json", TEXT: "text" },
    createTextOutput(s) { return { _s: s, setMimeType() { return this; }, getContent() { return this._s; } }; }
  };
  let SYNC_KEY = "the-real-key";
  const PropertiesService = {
    getScriptProperties() {
      return {
        getProperty(k) { return k === "SYNC_KEY" ? SYNC_KEY : null; },
        getProperties() { return { SYNC_KEY: SYNC_KEY }; },
        setProperty() {}, deleteProperty() {}
      };
    }
  };
  const sandbox = { ContentService, PropertiesService, JSON, Number, String, Object, Date, Math, isNaN };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(ROOT, "relay", "thrive-relay.gs"), "utf8");
  vm.runInContext(src, sandbox, { filename: "thrive-relay.gs" });
  return sandbox;
}

function post(relay, body) {
  const res = relay.doPost({ postData: { contents: JSON.stringify(body) } });
  return JSON.parse(res.getContent());
}

const relay = loadRelay();
const RV = relay.RELAY_VERSION;
ck("relay declares a numeric RELAY_VERSION", typeof RV === "number" && RV > 0, RV);

// The bare GET reports through json_, so it carries relay_version as a field (the console reads one
// explicit field on every endpoint rather than scraping a prose string). It must equal RELAY_VERSION.
const root = relay.doGet({ parameter: {} }).getContent();
ck("the GET root carries relay_version = " + RV, JSON.parse(root).relay_version === RV, root);

// A hit GET is JSON and carries the version.
const hit = JSON.parse(relay.doGet({ parameter: { op: "hit", slug: "x" } }).getContent());
ck("a hit response carries relay_version", hit.relay_version === RV, hit);

// An ERROR response (bad auth) still carries the version. This is the line that
// matters: the console must be able to read the version off a failure, because a
// mismatch usually shows up first as a failure.
const badAuth = post(relay, { op: "state_get", auth: "wrong", v: RV });
ck("an error response carries relay_version", badAuth.relay_version === RV, badAuth);
ck("the bad-auth error is still an error", badAuth.ok === false, badAuth);

// An unknown op error carries it too.
const unknown = post(relay, { op: "does-not-exist", auth: "the-real-key", v: RV });
ck("an unknown-op error carries relay_version", unknown.relay_version === RV, unknown);

// The whole point: a request from a NEWER console is refused BY NAME, not misread.
const mismatch = post(relay, { op: "state_get", auth: "the-real-key", v: RV + 1 });
ck("a newer request is rejected by name (request v" + (RV + 1) + ", relay v" + RV + ")",
   mismatch.ok === false && mismatch.error === "request v" + (RV + 1) + ", relay v" + RV, mismatch);
ck("the by-name rejection also carries relay_version", mismatch.relay_version === RV, mismatch);

// A request that declares NO version is a legacy caller and must still pass the
// version gate (it fails later on auth, which is a different, correct answer).
const legacy = post(relay, { op: "state_get", auth: "the-real-key" });
ck("a request with no declared version is not rejected by the version gate",
   !(legacy.error && /^request v/.test(legacy.error)), legacy);

/* ===================== static: the ritual is where the failure shows ===================== */

const relayMd = fs.readFileSync(path.join(ROOT, "docs", "RELAY.md"), "utf8");
ck("docs/RELAY.md carries the five-tap ritual box at the top",
   /deployment ritual/i.test(relayMd.slice(0, 1200)) && /New version/.test(relayMd.slice(0, 1200)), "");
const appJs = fs.readFileSync(path.join(ROOT, "library", "app.js"), "utf8");
ck("the connection panel links to the ritual in docs/RELAY.md",
   /docs\/RELAY\.md/.test(appJs) && /relay_ver_ritual/.test(appJs), "");
/* Since P8 the console and relay versions move independently: the relay may add ops (v6 the send queue,
   v7 the inbound heartbeat + Message-ID guarantee) without changing the single-send request shape, so the
   console keeps REQUIRED_RELAY at the last shape it needs and a newer relay still serves it. The invariant
   is therefore REQUIRED_RELAY <= RELAY_VERSION (never require a relay newer than the source exists), the
   same one tools/relay_handshake_test.py enforces. */
{
  const rq = Number((appJs.match(/REQUIRED_RELAY\s*=\s*(\d+)/) || [])[1]);
  ck("the console never requires a relay newer than the source (REQUIRED_RELAY <= RELAY_VERSION)",
     rq > 0 && rq <= RV, "app REQUIRED_RELAY " + rq + " vs relay " + RV);
}

console.log("\n" + fails + " failed");
process.exit(fails ? 1 : 0);
