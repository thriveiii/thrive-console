// Gate: fails-when-broken proof that {{ASSET_BASE}} resolves at compile time, exactly like {{LINK}}. It loads
// the REAL merge-field region from tools/board-send.src.js (the MF_* tokens, ASSET_BASE, assetBaseInto and
// mergeFieldsInto) into a sandbox with a KNOWN URL_BASE, so the real derivation and the real substitution run.
//
// Proves:
//   - ASSET_BASE = <URL_BASE> + "/storage/v1/object/public/assets" (the public `assets` bucket), derived from
//     the base the console already holds - no hardcoded project ref, no new key;
//   - mergeFieldsInto resolves {{ASSET_BASE}} alongside {{LINK}} in a message/subject (send + Text-tab preview);
//   - assetBaseInto resolves ONLY {{ASSET_BASE}} on a page's html (leaves {{LINK}}/{{NAME}} untouched);
//   - no {{ASSET_BASE}} token survives either path.
// Plus source guards: the derivation, the substitution inside mergeFieldsInto, sendCompile using it on body +
// subject, and both upload publish paths resolving the page html before store + commit.
//
// Pure Node. Run: node tools/asset_base_mergefield_test.js
// Fails-when-broken: delete the `out = out.split(MF_ASSET).join(ASSET_BASE);` line -> the message case leaves
// {{ASSET_BASE}} unresolved; drop assetBaseInto from upCommit -> the source guard fails.

const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const SEND = fs.readFileSync(path.join(ROOT, "tools/board-send.src.js"), "utf8");
const UPLOAD = fs.readFileSync(path.join(ROOT, "tools/board-upload.src.js"), "utf8");

let fails = 0;
function ck(name, cond, detail) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) { fails++; if (detail !== undefined) console.log("      " + String(detail).slice(0, 240)); }
}

const BASE = "https://demo.supabase.co";
const EXPECT = BASE + "/storage/v1/object/public/assets";

// Load the real merge-field region (MF_* tokens through the end of mergeFieldsInto) with a known URL_BASE.
function load() {
  const region = SEND.slice(SEND.indexOf("var MF_BIZ"), SEND.indexOf("function planAttachments"));
  const body = "var URL_BASE=" + JSON.stringify(BASE) + ";\n" + region +
    "\nreturn { mergeFieldsInto:mergeFieldsInto, assetBaseInto:assetBaseInto, ASSET_BASE:ASSET_BASE };";
  return new Function(body)();
}
const M = load();

// ---- source guards -------------------------------------------------------------------------------
ck("ASSET_BASE is DERIVED from URL_BASE + the public assets-bucket path (no hardcoded host/project ref)",
   /var ASSET_BASE = URL_BASE \+ "\/storage\/v1\/object\/public\/assets";/.test(SEND) &&
   !/https:\/\/[a-z0-9]+\.supabase\.co/i.test(SEND.slice(SEND.indexOf("var ASSET_BASE"), SEND.indexOf("var ASSET_BASE") + 120)));
ck("the bucket is `assets` (public)", /public\/assets"/.test(SEND));
ck("mergeFieldsInto substitutes {{ASSET_BASE}} in the SAME step as {{LINK}}",
   /out = out\.split\(MF_LINK\)\.join\(\(ctx&&ctx\.link\)\|\|""\);/.test(SEND) &&
   /out = out\.split\(MF_ASSET\)\.join\(ASSET_BASE\);/.test(SEND));
ck("sendCompile compiles the body and subject through mergeFieldsInto (send + Text-tab preview)",
   /var inner = mergeFieldsInto\(data\.outreach_text/.test(SEND) && /mergeFieldsInto\(data\.outreach_subject/.test(SEND));
ck("upCommit resolves {{ASSET_BASE}} on the page html before store + commit",
   /var html = assetBaseInto\(\(r\.page && r\.page\.html\) \|\| ""\);/.test(UPLOAD));
ck("upCommitLibrary resolves {{ASSET_BASE}} on the page html before store + commit",
   /var html = assetBaseInto\(\(r\.page && r\.page\.html\) \|\| ""\), title/.test(UPLOAD));

// ---- behavior ------------------------------------------------------------------------------------
ck("ASSET_BASE resolves to the public assets bucket base off URL_BASE", M.ASSET_BASE === EXPECT, M.ASSET_BASE);

const LINK = "https://console.thriveiii.com/opp/underdog";
const msg = "Hi {{NAME}}, see {{LINK}} and our logo {{ASSET_BASE}}/opp/logo.png plus {{ASSET_BASE}}/opp/font.woff2";
const out = M.mergeFieldsInto(msg, "Sam", { link: LINK, business: "Underdog", month: "" });
ck("the message resolves {{ASSET_BASE}} to the real bucket base (image URL)", out.indexOf(EXPECT + "/opp/logo.png") >= 0, out);
ck("the message resolves a second {{ASSET_BASE}} (font URL)", out.indexOf(EXPECT + "/opp/font.woff2") >= 0, out);
ck("the message still resolves {{LINK}} in the same pass", out.indexOf(LINK) >= 0, out);
ck("no {{ASSET_BASE}} token survives the message compile", out.indexOf("{{ASSET_BASE}}") < 0, out);

// page html: only {{ASSET_BASE}} is resolved (a page is not per-recipient)
const page = "<img src='{{ASSET_BASE}}/opp/hero.jpg'><style>@font-face{src:url({{ASSET_BASE}}/opp/f.woff2)}</style> {{LINK}} {{NAME}}";
const pout = M.assetBaseInto(page);
ck("the page html resolves {{ASSET_BASE}} to the real bucket base", pout.indexOf(EXPECT + "/opp/hero.jpg") >= 0 && pout.indexOf(EXPECT + "/opp/f.woff2") >= 0, pout);
ck("no {{ASSET_BASE}} token survives the page compile", pout.indexOf("{{ASSET_BASE}}") < 0, pout);
ck("the page compile leaves other tokens untouched ({{LINK}}/{{NAME}} are not a page's job)",
   pout.indexOf("{{LINK}}") >= 0 && pout.indexOf("{{NAME}}") >= 0, pout);

console.log("");
if (fails) { console.log(fails + " FAILED"); process.exit(1); }
console.log("ALL PASS");
