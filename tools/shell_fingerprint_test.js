/* SHELL_IN_THE_HASH contract (Node, fails-when-broken).

   The stranding after the first-paint fix was a DEPLOY bug, not a code bug: the fix changed the served
   console.html (a shell-only change, no module touched), but BUILD hashed only the module sources + css,
   so BUILD did not change, the index router kept pointing at console.html?v=<same BUILD>, and every device
   that cached the previous shell kept serving it. A correct shell fix that never reached the device.

   The fix folds the generator's own source (tools/bundle.js) into BUILD, so any change to how the shell is
   assembled bumps BUILD, changes the versioned URL, and forces a fresh fetch. This test proves that
   property by RECOMPUTING BUILD the way bundle.js does and showing (a) it matches the shipped stamp, (b) it
   materially depends on the generator source, and (c) it still depends on the runtime module + css bytes.
   If someone drops the generator from the hash, (b) goes red. */
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const ROOT = path.resolve(__dirname, "..");
const LIB = path.join(ROOT, "library");
const read = p => fs.readFileSync(p, "utf8");
const BUNDLE = path.join(ROOT, "tools/bundle.js");

let fails = 0;
function ck(n, cond) { if (cond) { console.log("PASS " + n); } else { fails++; console.log("FAIL " + n); } }

// Reproduce the exact inputs and order bundle.js hashes (line 106-108 of bundle.js).
const fontsCss = read(path.join(LIB, "fonts.css"));
const stylesCss = read(path.join(LIB, "styles.css"));
const css = fontsCss + "\n" + stylesCss;
const mods = {
  icons: "icons.js", i18n: "i18n.js", gate: "gate.js", model: "stage-model.js", life: "lifecycle.js",
  intake: "intake.js", supabase: "supabase.js", numbers: "numbers.js", inbound: "inbound.js",
  kinds: "kinds.js", drafts: "drafts.js", flows: "flows.js", store: "store.js", app: "app.js",
  failsafe: "failsafe.js"
};
const S = {};
for (const k in mods) S[k] = read(path.join(LIB, mods[k]));
const GEN = read(BUNDLE);
const ORDER = [css, S.icons, S.i18n, S.gate, S.model, S.life, S.intake, S.supabase, S.numbers, S.inbound, S.kinds, S.drafts, S.flows, S.store, S.app, S.failsafe, GEN];
const build8 = arr => crypto.createHash("sha256").update(arr.join("\x00"), "utf8").digest("hex").slice(0, 8);

const recomputed = build8(ORDER);
const shipped = JSON.parse(read(path.join(ROOT, "version.json"))).build;

ck("F1 the generator (tools/bundle.js) reads its own source and folds it into the BUILD hash input array",
   /GENERATOR_SRC\s*=\s*fs\.readFileSync\(__filename/.test(GEN)
   && /\.update\(\[[^\]]*\bGENERATOR_SRC\b[^\]]*\]\.join\("\\x00"\)/.test(GEN));

ck("F2 recomputing BUILD over [css, ...modules, generator] equals the shipped version.json build (my reproduction matches, and the generator is part of it)",
   recomputed === shipped);

// (b) Materially depends on the generator: flip one byte of the generator source, BUILD must change.
const genMutated = ORDER.slice(); genMutated[genMutated.length - 1] = GEN + "\n// shell tweak";
ck("F3 a change to the generator source (a shell-only change) produces a DIFFERENT BUILD (the cache-bust fires for shell fixes)",
   build8(genMutated) !== recomputed);

// Dropping the generator entirely (the old, broken behavior) yields a DIFFERENT value than shipped, proving
// the generator is genuinely included and not a no-op.
const withoutGen = ORDER.slice(0, ORDER.length - 1);
ck("F4 omitting the generator from the hash yields a different value than the shipped build (it is truly included, not incidental)",
   build8(withoutGen) !== shipped);

// (c) Still depends on the runtime: flip one byte of app.js, BUILD must change (no regression in coverage).
const appMutated = ORDER.slice(); appMutated[14] = S.app + " ";
ck("F5 a change to a runtime module (app.js) still changes BUILD (module coverage preserved)",
   build8(appMutated) !== recomputed);

// The index router and the served shell both stamp this same build, so the versioned URL tracks it.
const idx = read(path.join(ROOT, "index.html"));
const shell = read(path.join(LIB, "console.html"));
ck("F6 the index router points at console.html?v=<shipped build> and the shell stamps the same build (URL tracks the fingerprint)",
   idx.indexOf("console.html?v=" + shipped) >= 0 && shell.indexOf('content="' + shipped + '"') >= 0);

console.log(fails === 0 ? "\n0 failed" : "\n" + fails + " failed");
process.exit(fails === 0 ? 0 : 1);
