// Beacon self-tagging: an owner/team visit must be scored self=true reliably, including when the opp page is
// opened DIRECTLY (a fresh tab whose sessionStorage is empty). isSelf() is extracted from beacon.js and run
// against synthetic storage. Fails-when-broken; synthetic only (no real prospect data).
// Run: node tools/beacon_self_test.js

const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const beacon = fs.readFileSync(path.join(ROOT, "beacon.js"), "utf8");

let fails = 0;
function ck(name, cond, detail) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) { fails++; if (detail !== undefined) console.log("      " + String(detail).slice(0, 200)); }
}

// Brace-match a named function out of the source.
function extractFn(src, name) {
  const at = src.indexOf("function " + name + "(");
  if (at < 0) return null;
  let i = src.indexOf("{", at), depth = 0;
  for (; i < src.length; i++) { const c = src[i]; if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) { i++; break; } } }
  return src.slice(at, i);
}

// A minimal Storage stand-in (only getItem is used by isSelf).
function store(map) { return { getItem: function (k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; } }; }

// Build isSelf with injected localStorage/sessionStorage in scope.
function makeIsSelf(local, session) {
  const body = extractFn(beacon, "isSelf");
  if (!body) throw new Error("isSelf not found in beacon.js");
  return new Function("localStorage", "sessionStorage", body + "\nreturn isSelf();");
}
function run(local, session) { return makeIsSelf()(store(local), store(session)); }

const SESSION_JSON = JSON.stringify({ access_token: "T", refresh_token: "R", email: "operator@synthetic.test", uid: "u-1" });
const GATE_HASH = "deadbeef";  // synthetic gate marker value

// ---- (a) console session in localStorage, NO sessionStorage gate key -> true (the direct-open owner case) --
ck("(a) localStorage console_sb_session present, sessionStorage empty -> self=true (direct-open owner caught)",
   run({ console_sb_session: SESSION_JSON }, {}) === true);

// ---- (b) neither present -> false (a real prospect is still counted as an open) -------------------
ck("(b) neither signal present -> self=false (a real prospect open still counts)",
   run({}, {}) === false);

// ---- (c) only the sessionStorage gate key -> still true (in-console preview, no regression) --------
ck("(c) only sessionStorage thrive_gate_v2 present -> self=true (in-console preview, no regression)",
   run({}, { thrive_gate_v2: GATE_HASH }) === true);

// ---- both present -> true (belt and suspenders) --------------------------------------------------
ck("both signals present -> self=true",
   run({ console_sb_session: SESSION_JSON }, { thrive_gate_v2: GATE_HASH }) === true);

// ---- negative control: the check is real (a wrong key does NOT tag self) --------------------------
ck("an unrelated localStorage key does NOT tag self (control)",
   run({ some_other_key: "1" }, {}) === false);

// ---- source guards: the durable localStorage session is checked, gate key kept as fallback --------
ck("isSelf reads the durable localStorage console_sb_session",
   /localStorage\.getItem\("console_sb_session"\)/.test(beacon));
ck("isSelf still honors the sessionStorage gate key (no regression path removed)",
   /sessionStorage\.getItem\("thrive_gate_v2"\)/.test(beacon));

console.log("");
if (fails) { console.log(fails + " FAILED"); process.exit(1); }
console.log("ALL PASS");
