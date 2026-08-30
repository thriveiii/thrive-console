// Parity + safety gate for the relay's Supabase ledger mirror (retiring the old-engine mirror).
//
// The relay (relay/thrive-relay.gs) must write console_inbound / console_hits rows shaped BYTE FOR BYTE as
// the old engine (library/app.js) did, because both may write during the transition and the console_board
// view + the board read those exact columns. This test extracts the row builders from BOTH files, runs them
// on shared fixtures, and asserts the produced rows are identical (the volatile `up` = Date.now() aside). It
// FAILS if the relay drifts: rename a field, change the id/hitKey formula, or drop a column and a case breaks.
//
// It also pins the write's safety contract: merge-duplicates upsert, service key read from Script Properties
// and NEVER logged, safe no-op when unset, and a self-healing cursor that only advances on a 2xx.
//
// Pure Node, no network, no browser. Run: node tools/relay_inbound_mirror_test.js

const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const relay = fs.readFileSync(path.join(ROOT, "relay/thrive-relay.gs"), "utf8");
const app = fs.readFileSync(path.join(ROOT, "library/app.js"), "utf8");

let fails = 0;
function ck(name, cond, detail) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) { fails++; if (detail !== undefined) console.log("      " + String(detail).slice(0, 400)); }
}

// Pull one `function NAME(...) { ... }` body out of a source string, brace-matched from its first {.
function extractFn(src, name) {
  const sig = "function " + name + "(";
  const at = src.indexOf(sig);
  if (at < 0) return null;
  let i = src.indexOf("{", at), depth = 0, start = i;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(at, i);
}

// Build an isolated evaluator holding the named functions from a source (no other globals leak in).
function loadFns(src, names) {
  const bodies = names.map((n) => {
    const f = extractFn(src, n);
    if (!f) throw new Error("missing function " + n);
    return f;
  });
  const sandbox = {};
  // eslint-disable-next-line no-new-func
  new Function(bodies.join("\n") + "\n; Object.assign(this, {" + names.join(",") + "});").call(sandbox);
  return sandbox;
}

// ---- 1. the builders exist on both sides -------------------------------------------------------
const ENGINE = loadFns(app, ["inboundKey", "supaInboundRow", "hitKey", "supaHitRow"]);
const RELAY = loadFns(relay, ["inboundKey_", "supaInboundRow_", "hitKey_", "supaHitRow_"]);
ck("engine + relay both expose the four row builders",
   typeof ENGINE.supaInboundRow === "function" && typeof RELAY.supaInboundRow_ === "function" &&
   typeof ENGINE.supaHitRow === "function" && typeof RELAY.supaHitRow_ === "function");

// ---- 2. byte-for-byte row parity on fixtures ---------------------------------------------------
// A reply attributed by tag, a bounce auto with no opp, a header-threaded reply, and a legacy record whose
// id must fall through gid -> messageId -> mid -> id. Covers every branch of inboundKey/supaInboundRow.
const INBOUND_FIXTURES = [
  { gid: "CAF+abc@mail.gmail.com", opp: "acme", kind: "reply", ts: "2026-08-20T10:00:00.000Z",
    from: "lina@acme.example", name: "Lina", subject: "Re: hello", snippet: "yes please", rule: "tag" },
  { gid: "bounce-1", opp: "", kind: "auto", bounce: "hard", ts: "2026-08-21T11:00:00.000Z",
    from: "mailer-daemon@googlemail.com", subject: "Delivery failed", rule: "none" },
  { messageId: "<threaded@thriveiii.com>", opp: "beta", kind: "reply", ts: "2026-08-22T09:30:00.000Z",
    from: "x@beta.co", rule: "thread" },
  { mid: "legacy-mid", opp: "gamma", kind: "reply", ts: "2026-08-23T08:00:00.000Z" },
  { id: "only-id", opp: "delta", kind: "reply", ts: "2026-08-24T07:00:00.000Z" },
  { opp: "no-id", kind: "reply", ts: "2026-08-25T06:00:00.000Z" }   // no id at all -> in_<ts> fallback
];
const HIT_FIXTURES = [
  { type: "open", slug: "acme", ts: "2026-08-20T10:05:00.000Z", vid: "v1", r: "snd_abc" },
  { type: "open", slug: "beta", ts: "2026-08-21T12:00:00.000Z", vid: "", r: "", self: true },
  { slug: "gamma", ts: "2026-08-22T13:00:00.000Z", vid: "v9" }   // no type -> default "open"
];

function eqIgnoringUp(a, b) {
  const A = Object.assign({}, a), B = Object.assign({}, b);
  // `up` is Date.now() on both sides at build time; the engine and relay agree it is volatile.
  delete A.up; delete B.up;
  return JSON.stringify(A) === JSON.stringify(B);
}

let inboundParity = true, inboundDetail = "";
for (const r of INBOUND_FIXTURES) {
  const e = ENGINE.supaInboundRow(r), v = RELAY.supaInboundRow_(r);
  if (!eqIgnoringUp(e, v)) { inboundParity = false; inboundDetail = "engine=" + JSON.stringify(e) + " relay=" + JSON.stringify(v); break; }
  if (ENGINE.inboundKey(r) !== RELAY.inboundKey_(r)) { inboundParity = false; inboundDetail = "id drift: " + ENGINE.inboundKey(r) + " vs " + RELAY.inboundKey_(r); break; }
}
ck("console_inbound row is byte-for-byte identical to app.js supaInboundRow (all id-fallback + kind/bounce branches)",
   inboundParity, inboundDetail);

let hitParity = true, hitDetail = "";
for (const h of HIT_FIXTURES) {
  const e = ENGINE.supaHitRow(h), v = RELAY.supaHitRow_(h);
  if (JSON.stringify(e) !== JSON.stringify(v)) { hitParity = false; hitDetail = "engine=" + JSON.stringify(e) + " relay=" + JSON.stringify(v); break; }
  if (ENGINE.hitKey(h) !== RELAY.hitKey_(h)) { hitParity = false; hitDetail = "hitKey drift: " + ENGINE.hitKey(h) + " vs " + RELAY.hitKey_(h); break; }
}
ck("console_hits row is byte-for-byte identical to app.js supaHitRow (same hitKey type|slug|ts|vid, no up column)",
   hitParity, hitDetail);

// Negative control: the test can actually see drift (a wrong-shaped relay row must NOT pass parity).
ck("parity check is real (a deliberately drifted row fails)",
   !eqIgnoringUp(ENGINE.supaInboundRow(INBOUND_FIXTURES[0]),
                 Object.assign({}, RELAY.supaInboundRow_(INBOUND_FIXTURES[0]), { opp: "WRONG" })));

// ---- 3. the id / PK is gid|hitKey, so the write is idempotent and parallel-safe ----------------
ck("console_inbound id is the Gmail message id (gid), the PK the transition dedupes on",
   RELAY.supaInboundRow_(INBOUND_FIXTURES[0]).id === "CAF+abc@mail.gmail.com");
ck("console_hits id is hitKey type|slug|ts|vid, the PK the transition dedupes on",
   RELAY.supaHitRow_(HIT_FIXTURES[0]).id === "open|acme|2026-08-20T10:05:00.000Z|v1");

// ---- 4. supaInsert_ safety contract (source-level, since it needs Apps Script services) ---------
const supaInsertSrc = extractFn(relay, "supaInsert_") || "";
ck("supaInsert_ upserts idempotently (Prefer: resolution=merge-duplicates)",
   /resolution=merge-duplicates/.test(supaInsertSrc));
ck("supaInsert_ reads BOTH properties (SUPABASE_URL + SUPABASE_SERVICE_KEY)",
   /getProperty\('SUPABASE_URL'\)/.test(supaInsertSrc) && /getProperty\('SUPABASE_SERVICE_KEY'\)/.test(supaInsertSrc));
ck("supaInsert_ is a safe no-op when unconfigured (returns false, never throws, before any fetch)",
   /if\s*\(!url\s*\|\|\s*!key[^)]*\)\s*return false/.test(supaInsertSrc));
ck("supaInsert_ authenticates with the service key as apikey + Bearer",
   /apikey:\s*key/.test(supaInsertSrc) && /Authorization:\s*'Bearer '\s*\+\s*key/.test(supaInsertSrc));
ck("supaInsert_ returns success ONLY on a 2xx (so a failed write can be retried)",
   /code\s*>=\s*200\s*&&\s*code\s*<\s*300/.test(supaInsertSrc));

// The key must never be logged anywhere in the relay.
ck("the service key is NEVER logged (no Logger/console emits `key`)",
   !/(Logger\.log|console\.(log|error|warn))\([^)]*\bkey\b/.test(relay));

// ---- 5. the mirror is wired into the scan, runs every scan, self-heals -------------------------
ck("scanInbox calls supaMirrorLedger_ (the mirror runs on every scan, idle or not)",
   /var mirror = supaMirrorLedger_\(\);/.test(relay) && /out\.supaMirror = mirror;/.test(relay));
const mirrorSrc = extractFn(relay, "supaMirrorLedger_") || "";
ck("supaMirrorLedger_ no-ops when the properties are unset (never blocks the scan)",
   /getProperty\('SUPABASE_URL'\)\s*\|\|\s*!props_\(\)\.getProperty\('SUPABASE_SERVICE_KEY'\)/.test(mirrorSrc) &&
   /return null/.test(mirrorSrc));
ck("supaMirrorLedger_ advances each cursor ONLY when its upsert succeeded (self-healing retry)",
   /if\s*\(okIn\s*&&\s*snap\.inRows\.length\)\s*store\.inboundSyncTs = snap\.inMax;/.test(mirrorSrc) &&
   /if\s*\(okHit\s*&&\s*snap\.hRows\.length\)\s*store\.hitsSyncTs = snap\.hMax;/.test(mirrorSrc));
ck("supaMirrorLedger_ never throws into the scan (wrapped, returns {error} instead)",
   /catch\s*\(e\)\s*\{\s*return \{ error:/.test(mirrorSrc));
ck("the mirror writes to console_inbound AND console_hits",
   /supaInsert_\('console_inbound'/.test(mirrorSrc) && /supaInsert_\('console_hits'/.test(mirrorSrc));

// ---- 6. no existing op was touched (send / page_publish / hit still present, unchanged names) ---
ck("existing relay ops are untouched (send, page_publish, hit, inbound_get, hits_get all still dispatched)",
   /op === 'page_publish'/.test(relay) && /op === 'inbound_get'/.test(relay) &&
   /op === 'hits_get'/.test(relay) && /op === 'hit'/.test(relay) && /function sendMail_/.test(relay));
ck("RELAY_VERSION unchanged at 9 (no request-shape change, per the version contract at line ~44)",
   /var RELAY_VERSION = 9;/.test(relay));

console.log("");
if (fails) { console.log(fails + " FAILED"); process.exit(1); }
console.log("ALL PASS");
