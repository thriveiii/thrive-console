"use strict";
/* NETLIFY_DEPLOY contract (Node, fails-when-broken).

   Netlify must build the same site the GitHub Pages flow builds and serve HTML that can never be stale.
   This proves the build wiring end to end: `node tools/bundle.js` emits a clean publish/ tree, netlify.toml
   points at it, and publish/_headers forces revalidation on every file (HTML included) without marking HTML
   immutable. It also proves the deployable set is complete (the console, its assets, the public prospect
   pages) and that the dev tree (tools, docs, relay source) does not leak into the deploy.

   It runs the real bundle first, so the assertions are about the actual deployable output, not a snapshot. */
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const fails = [];
function ck(name, cond, detail) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) { fails.push(name); if (detail !== undefined) console.log("      " + String(detail).slice(0, 300)); }
}
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p) => fs.existsSync(path.join(ROOT, p));

// ---- netlify.toml ---------------------------------------------------------------------------------
const toml = exists("netlify.toml") ? read("netlify.toml") : "";
ck("netlify.toml declares the bundle build command", /command\s*=\s*"node tools\/bundle\.js"/.test(toml), toml);
ck("netlify.toml publishes the clean publish/ directory", /publish\s*=\s*"publish"/.test(toml), toml);
ck("publish/ is gitignored (a build artifact, like dist/)", /^publish\/$/m.test(exists(".gitignore") ? read(".gitignore") : ""));

// ---- run the real build, then assert on the deployable tree --------------------------------------
cp.execSync("node tools/bundle.js", { cwd: ROOT, stdio: "pipe" });
const build = JSON.parse(read("version.json")).build;

const MUST = ["index.html", "gate.html", "404.html", "authtest.html", "beacon.js", "version.json",
              "library/console.html", "library/app.js", "library/styles.css", "library/gate.js",
              "assets/thrive-logo.png", "opp"];
MUST.forEach((f) => ck("publish/ contains the deployable file: " + f, exists("publish/" + f)));

const NEVER = ["tools", "docs", "relay", "Brain", "shots", "scratchpad_shots", "dist", ".git"];
NEVER.forEach((d) => ck("publish/ does NOT leak the dev directory: " + d, !exists("publish/" + d)));

// ---- the no-stale-HTML header --------------------------------------------------------------------
const headers = exists("publish/_headers") ? read("publish/_headers") : "";
ck("publish/_headers exists", !!headers, headers);
ck("_headers applies to every path (/*) with public, max-age=0, must-revalidate",
   /\/\*/.test(headers) && /Cache-Control:\s*public,\s*max-age=0,\s*must-revalidate/.test(headers), headers);
ck("_headers never marks HTML immutable (revalidation is required, cheap via ?v=BUILD 304s)",
   !/immutable/i.test(headers), headers);

// ---- the deploy matches the build ----------------------------------------------------------------
ck("publish/index.html redirects to the console at the current BUILD",
   read("publish/index.html").indexOf("console.html?v=" + build) >= 0, build);
ck("publish/version.json carries the current BUILD (deploy and build agree)",
   JSON.parse(read("publish/version.json")).build === build, build);
ck("every internal reference in publish/index.html is relative (works from any origin, no Pages base)",
   !/(src|href)="https?:\/\//.test(read("publish/index.html").replace(/https?:\/\/[^"]*supabase[^"]*/g, "")));

console.log("\n(build " + build + ")");
console.log(fails.length ? ("FAILED: " + fails.join(", ")) : "ALL NETLIFY-DEPLOY CHECKS PASS");
process.exit(fails.length ? 1 : 0);
