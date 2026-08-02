#!/usr/bin/env node
/* Thrive Console verify gate.
   Run before every push:   node tools/verify.js

   It is the mechanical half of Brain/CHECKLIST.md. Every check here exists because the
   failure it catches has actually happened somewhere, and each one is cheap enough that
   there is no excuse for skipping it. Nothing is a warning: a check either passes or the
   gate refuses. Sources are named per check (Brain/01 and Brain/02 section numbers). */

"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SKIP_DIRS = new Set(["Brain", ".git", "node_modules", "tools"]);

let failures = 0;
let checks = 0;
function ok(name) { checks++; console.log("  ✓ " + name); }
function bad(name, detail) {
  checks++; failures++;
  console.log("  ✕ " + name);
  (Array.isArray(detail) ? detail : [detail]).slice(0, 12).forEach(d => console.log("      " + d));
  if (Array.isArray(detail) && detail.length > 12) console.log("      ... and " + (detail.length - 12) + " more");
}
function head(t) { console.log("\n" + t); }

/* ---------- file walk ---------- */
function walk(dir, out) {
  out = out || [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") && e.name !== ".nojekyll") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(path.relative(ROOT, p).split(path.sep)[0])) walk(p, out); }
    else out.push(p);
  }
  return out;
}
const ALL = walk(ROOT);
const rel = p => path.relative(ROOT, p);
const byExt = ext => ALL.filter(p => p.endsWith(ext));
const read = p => fs.readFileSync(p, "utf8");

/* Base64 font payloads are megabytes of noise for every text scan. */
function textOf(p) {
  const s = read(p);
  return p.endsWith("fonts.css") || /base64,/.test(s)
    ? s.replace(/data:[^;]+;base64,[A-Za-z0-9+/=]+/g, "data:[stripped]")
    : s;
}

/* ================= 1. every script parses (Brain/02 §5.2, §6.6) ================= */
head("Syntax");
{
  const bads = [];
  for (const p of byExt(".js")) {
    try { execFileSync(process.execPath, ["--check", p], { stdio: "pipe" }); }
    catch (e) { bads.push(rel(p) + ": " + String(e.stderr || e.message).split("\n").slice(0, 2).join(" ")); }
  }
  bads.length ? bad("every .js file parses", bads) : ok("every .js file parses (" + byExt(".js").length + " files)");
  for (const p of byExt(".json")) {
    try { JSON.parse(read(p)); } catch (e) { bads.push(rel(p) + ": " + e.message); }
  }
  bads.length ? 0 : ok("every .json file parses (" + byExt(".json").length + " files)");
}

/* ================= 2. no secret anywhere (Brain/02 §6.10) ================= */
head("Secrets");
{
  const PATTERNS = [
    [/\bre_[A-Za-z0-9_-]{20,}/g, "Resend API key"],
    [/\bghp_[A-Za-z0-9]{30,}/g, "GitHub personal access token"],
    [/\bgithub_pat_[A-Za-z0-9_]{30,}/g, "GitHub fine-grained token"],
    [/\bsk-[A-Za-z0-9]{24,}/g, "provider secret key"],
    [/\bAIza[0-9A-Za-z_-]{30,}/g, "Google API key"],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, "private key block"],
    /* a real key is long and mixed-case or digit-bearing; a lower_snake_case value is a
       storage-key name, not a secret, so it must not trip the gate */
    [/\b(?:SYNC_KEY|RESEND_KEY|API_KEY|TOKEN)\s*[:=]\s*["'](?=[^"']*[A-Z0-9])[^"']{16,}["']/g, "hard-coded key"],
  ];
  const hits = [];
  for (const p of walk(ROOT).concat(walk(path.join(ROOT, "Brain")))) {
    let s; try { s = read(p); } catch (e) { continue; }
    for (const [re, what] of PATTERNS) {
      const m = s.match(re);
      if (m) hits.push(rel(p) + ": " + what + " (" + m[0].slice(0, 12) + "...)");
    }
  }
  hits.length ? bad("no secret-shaped string is committed", hits)
              : ok("no secret-shaped string is committed");
}

/* ================= 3. bilingual parity (Brain/02 §8.7) ================= */
head("Bilingual");
let I18N = null;
{
  const src = read(path.join(ROOT, "library/i18n.js"));
  const stub = () => {};
  const sandbox = {
    document: { addEventListener: stub, getElementById: () => null, querySelectorAll: () => [],
                createElement: () => ({ style: {}, classList: { add: stub, remove: stub } }),
                documentElement: { classList: { add: stub, remove: stub, toggle: stub } }, body: null },
    window: { addEventListener: stub, matchMedia: () => ({ matches: false }) },
    localStorage: { getItem: () => null, setItem: stub },
    console, out: null,
  };
  try {
    vm.runInNewContext(src + "\n;out = I18N;", sandbox, { timeout: 5000 });
    I18N = sandbox.out;
  } catch (e) { bad("library/i18n.js loads", e.message); }

  if (I18N) {
    const en = Object.keys(I18N.en), ar = Object.keys(I18N.ar);
    const missAr = en.filter(k => !(k in I18N.ar));
    const missEn = ar.filter(k => !(k in I18N.en));
    (missAr.length || missEn.length)
      ? bad("EN/AR key parity", missAr.map(k => "missing in ar: " + k).concat(missEn.map(k => "missing in en: " + k)))
      : ok("EN/AR key parity (" + en.length + " keys each way)");

    const empty = en.filter(k => typeof I18N.en[k] === "string" && !I18N.en[k].trim())
      .concat(ar.filter(k => typeof I18N.ar[k] === "string" && !I18N.ar[k].trim()));
    empty.length ? bad("no empty string ships", empty) : ok("no empty string ships");

    /* every key an HTML file asks for exists in both dictionaries */
    const used = new Set(), miss = [];
    for (const p of byExt(".html")) {
      if (!rel(p).startsWith("library" + path.sep)) continue;
      const s = read(p);
      let m; const re = /data-i18n(?:-ph)?="([^"]+)"/g;
      while ((m = re.exec(s))) { used.add(m[1]); if (!(m[1] in I18N.en) || !(m[1] in I18N.ar)) miss.push(rel(p) + ": " + m[1]); }
    }
    miss.length ? bad("every data-i18n key exists in both languages", miss)
                : ok("every data-i18n key exists in both languages (" + used.size + " used)");
  }
}

/* ================= 4. copy gates (Brain/01 §7, Brain/03 §2, Brain/04 §3) ================= */
head("Copy");
{
  const scanned = ALL.filter(p => /\.(html|js|css|json|md)$/.test(p) && !rel(p).startsWith("Brain"));

  const em = [];
  for (const p of scanned) {
    const s = textOf(p);
    s.split("\n").forEach((line, i) => { if (line.includes("—")) em.push(rel(p) + ":" + (i + 1)); });
  }
  em.length ? bad("zero em dashes (use a comma, colon, or parentheses)", em) : ok("zero em dashes");

  const east = [];
  for (const p of scanned) {
    const s = textOf(p);
    s.split("\n").forEach((line, i) => { if (/[٠-٩]/.test(line)) east.push(rel(p) + ":" + (i + 1)); });
  }
  east.length ? bad("Western numerals only (no Eastern-Arabic digits)", east) : ok("Western numerals only");

  if (I18N) {
    const curly = Object.keys(I18N.en).filter(k => typeof I18N.en[k] === "string" && /[“”]/.test(I18N.en[k]));
    curly.length ? bad("English copy uses straight quotes, not curly", curly) : ok("English copy uses straight quotes");

    // The rule is about prose quotation, not markup: a class="..." inside a string is not a quote.
    const prose = s => String(s).replace(/<[^>]*>/g, "");
    const straight = Object.keys(I18N.ar).filter(k => typeof I18N.ar[k] === "string" && /"/.test(prose(I18N.ar[k])));
    straight.length ? bad("Arabic copy quotes with guillemets «»", straight)
                    : ok("Arabic copy quotes with guillemets «»");

    /* tanwin sits on the letter (فًا), never on a bare alef (فاً) */
    const tanwin = Object.keys(I18N.ar).filter(k => typeof I18N.ar[k] === "string" && /اً/.test(I18N.ar[k]));
    tanwin.length ? bad("tanwin sits on the letter, not on a bare alef", tanwin)
                  : ok("tanwin sits on the letter");
  }
}

/* ================= 5. output guards (Brain/01 §9, Brain/02 §5.3) ================= */
head("Pages");
{
  const pages = byExt(".html").filter(p => rel(p).startsWith("library" + path.sep));

  const noindex = pages.filter(p => !/name="robots"\s+content="noindex/.test(read(p)));
  noindex.length ? bad("every console page is noindex,nofollow", noindex.map(rel))
                 : ok("every console page is noindex,nofollow (" + pages.length + " pages)");

  const emptyAttr = [];
  for (const p of byExt(".html")) {
    const s = read(p);
    if (/\ssrc=""/.test(s)) emptyAttr.push(rel(p) + ': src=""');
    if (/\shref=""/.test(s)) emptyAttr.push(rel(p) + ': href=""');
  }
  emptyAttr.length ? bad("no empty src/href attribute", emptyAttr) : ok("no empty src/href attribute");

  /* merge slots belong in templates/, never in a shipped console page */
  const leaked = [];
  for (const p of pages) {
    const m = read(p).match(/\{\{[A-Z0-9_]+\}\}/g);
    if (m) leaked.push(rel(p) + ": " + [...new Set(m)].join(" "));
  }
  leaked.length ? bad("no unfilled merge slot in a console page", leaked)
                : ok("no unfilled merge slot in a console page");

  /* a script failure must never leave a locked blank page (Brain/01 §12) */
  const noBoot = pages.filter(p => /gate-locked/.test(read(p)))
    .filter(p => !/bootfail/.test(read(p)) || !/<noscript>/.test(read(p)));
  noBoot.length ? bad("every console page has the boot failsafe and a <noscript>", noBoot.map(rel))
                : ok("every console page has the boot failsafe and a <noscript>");

  /* every published prospect page must be able to record an open (Brain/02 §6.1) */
  const opps = byExt(".html").filter(p => rel(p).startsWith("opp" + path.sep));
  const blind = opps.filter(p => !/beacon\.js/.test(read(p)));
  if (opps.length === 0) ok("no published pages to check yet");
  else if (blind.length) bad("every published page carries the analytics beacon", blind.map(rel));
  else ok("every published page carries the analytics beacon (" + opps.length + " pages)");
}

/* ---------- verdict ---------- */
console.log("\n" + (failures ? "✕ " + failures + " of " + checks + " checks failed."
                             : "✓ all " + checks + " checks passed."));
process.exit(failures ? 1 : 0);
