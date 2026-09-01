// member-activate-via-relay gate: fails-when-broken guard that a member device (no repo token) activates the opp
// page through the relay page_publish op, while the owner path stays byte-for-byte the direct token commit.
// The runtime path is network-coupled (ghPutFile -> GitHub, fetchT -> relay), so the device is the real proof;
// this guard protects the source structure of publishOppPage / publishOpp from a revert.
//
// Pure Node, reads library/app.js. Run: node tools/member_activate_relay_test.js

const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(ROOT, "library/app.js"), "utf8");

let fails = 0;
function ck(name, cond, detail) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) { fails++; if (detail !== undefined) console.log("      " + String(detail).slice(0, 200)); }
}
function fnBody(src, sig) {
  const at = src.indexOf(sig);
  if (at < 0) return "";
  let i = src.indexOf("{", at), depth = 0;
  for (; i < src.length; i++) { const c = src[i]; if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) { i++; break; } } }
  return src.slice(at, i);
}

const pop = fnBody(app, "async function publishOppPage(");
ck("publishOppPage is present", !!pop);

// Owner: has the token (ghReady) -> commits directly with ghPutFile to the SAME path, WITH the beacon added here.
ck("owner path (ghReady) commits directly to opp/<slug>/index.html via ghPutFile with the beacon",
   /if\(ghReady\(\)\)\{[\s\S]*ghPutFile\("opp\/"\+rec\.slug\+"\/index\.html", withBeacon\(rec\.html\|\|""\)/.test(pop), pop.slice(0, 200));

// Member: no token -> POST page_publish to the relay endpoint, RAW html (the relay adds the beacon itself).
ck("member path POSTs page_publish to the relay (getSyncEndpoint + fetchT + relayBody)",
   /getSyncEndpoint\(\)/.test(pop) && /fetchT\(ep,\{/.test(pop) && /relayBody\(\{ op:"page_publish", slug:rec\.slug, html:rec\.html\|\|"" \}\)/.test(pop), pop);
ck("member path sends RAW html to the relay (no withBeacon on the relay body; the relay adds it)",
   pop.indexOf('op:"page_publish"') >= 0 && !/relayBody\([\s\S]*withBeacon/.test(pop), pop);
ck("member path uses text/plain (mirrors the existing relay-call pattern) and needs no credential (no auth in the body)",
   /Content-Type":"text\/plain/.test(pop) && pop.indexOf("auth") < 0, pop);
ck("member path throws on a non-ok relay response (a real failure still surfaces)",
   /if\(!j \|\| j\.ok!==true\) throw new Error\("relay page_publish "/.test(pop), pop);

// publishOpp calls publishOppPage, then defers the manifest for a member (a listing that needs the token),
// never failing; the owner still writes the manifest.
const po = fnBody(app, "async function publishOpp(");
ck("publishOpp goes through publishOppPage (owner direct, member relay)",
   /await publishOppPage\(rec\);/.test(po), po.slice(0, 120));
ck("a member (no token) defers the manifest (logged, returned), never a failure",
   /if\(!ghReady\(\)\)\{[\s\S]*logActivity\("manifest_deferred", rec\.slug[\s\S]*return;/.test(po), po);
ck("the owner still writes the manifest (publishManifest is still called on the token path)",
   /await publishManifest\(rec\);/.test(po), po);
ck("the page is marked live before the manifest step either way (setHalfPublished true)",
   /await publishOppPage\(rec\);[^\n]*\n\s*setHalfPublished\(rec\.slug, true\)/.test(po), po);

console.log("");
if (fails) { console.log(fails + " FAILED"); process.exit(1); }
console.log("ALL PASS");
