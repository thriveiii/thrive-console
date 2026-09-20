"use strict";
/* CLOUDFLARE_PAGES contract (Node, fails-when-broken).

   The console is migrating off Netlify onto Cloudflare Pages as a DROP-IN: the same
   `node tools/bundle.js` build, the same publish/ output, the same _headers no-stale guarantee, with
   pagePublish_ and the relay unchanged and netlify.toml KEPT for instant DNS-only rollback.

   This proves the wiring Cloudflare Pages depends on, end to end:
     * the in-repo Cloudflare config declares the publish/ output and pins a Node the build can run on;
     * netlify.toml is STILL present (this PR must not remove the rollback path);
     * `node tools/bundle.js` emits the deployable publish/ tree with the no-stale _headers;
     * the integrity probe will PASS on any host: sha256(publish/library/board.html) equals
       version.json.boardSha256, and the served root points at the current BUILD.

   FAILS-WHEN-BROKEN: drop the publish output declaration / the Node pin / netlify.toml, weaken the
   no-stale _headers, or let version.json's boardSha256 drift from the shipped board.html -> fails.

   It runs the real bundle first, so the assertions are about the actual deployable output. */
const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const fails = [];
function ck(name, cond, detail) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) { fails.push(name); if (detail !== undefined) console.log("      " + String(detail).slice(0, 300)); }
}
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p) => fs.existsSync(path.join(ROOT, p));

// ---- in-repo Cloudflare config -------------------------------------------------------------------
const wr = exists("wrangler.toml") ? read("wrangler.toml") : "";
ck("wrangler.toml declares the Pages build output directory: publish",
   /pages_build_output_dir\s*=\s*"publish"/.test(wr), wr);
ck("wrangler.toml names the Pages project", /^\s*name\s*=\s*"[^"]+"/m.test(wr), wr);

const nodeVer = exists(".node-version") ? read(".node-version").trim() : "";
const major = parseInt((nodeVer.split(".")[0] || "0"), 10);
ck("a Node version is pinned for the Cloudflare build (.node-version)", !!nodeVer, nodeVer);
ck("the pinned Node satisfies the build floor (>= 16.7, for fs.cpSync in tools/bundle.js)", major >= 17, nodeVer);

// ---- netlify.toml is KEPT (rollback path stays in this PR) ---------------------------------------
const toml = exists("netlify.toml") ? read("netlify.toml") : "";
ck("netlify.toml is STILL present (kept for instant DNS-only rollback; not deleted in this PR)", !!toml, "missing netlify.toml");
ck("netlify.toml and Cloudflare build the SAME command (node tools/bundle.js)",
   /command\s*=\s*"node tools\/bundle\.js"/.test(toml), toml);
ck("netlify.toml and Cloudflare publish the SAME output (publish/)", /publish\s*=\s*"publish"/.test(toml), toml);
ck("publish/ is gitignored (a build artifact both hosts regenerate)",
   /^publish\/?$/m.test(exists(".gitignore") ? read(".gitignore") : ""));

// ---- run the real build, then assert on the deployable tree Cloudflare will serve ----------------
cp.execSync("node tools/bundle.js", { cwd: ROOT, stdio: "pipe" });
const ver = JSON.parse(read("version.json"));
const build = ver.build;

const MUST = ["index.html", "gate.html", "404.html", "beacon.js", "version.json",
              "library/board.html", "assets/thrive-logo.png", "opp", "_headers"];
MUST.forEach((f) => ck("publish/ contains the deployable file: " + f, exists("publish/" + f)));

// at least one real opp page is present (the pagePublish_ output Cloudflare serves at /opp/<slug>)
const oppDir = path.join(ROOT, "publish/opp");
const oneOpp = exists("publish/opp") && fs.readdirSync(oppDir).find((d) => exists("publish/opp/" + d + "/index.html"));
ck("publish/opp/<slug>/index.html is served (the relay's page output, directory-index form)", !!oneOpp, oneOpp);

const NEVER = ["tools", "docs", "relay", "dist", ".git", "wrangler.toml", ".node-version"];
NEVER.forEach((d) => ck("publish/ does NOT leak the dev/config file: " + d, !exists("publish/" + d)));

// ---- the no-stale-HTML header Cloudflare Pages honors --------------------------------------------
const headers = exists("publish/_headers") ? read("publish/_headers") : "";
ck("publish/_headers exists at the output root (Cloudflare Pages reads it there)", !!headers, headers);
ck("_headers revalidates board.html (public, no-cache, must-revalidate)",
   /\/library\/board\.html/.test(headers) && /Cache-Control:\s*public,\s*no-cache,\s*must-revalidate/.test(headers), headers);
ck("_headers revalidates every path (/*  public, max-age=0, must-revalidate)",
   /\/\*/.test(headers) && /Cache-Control:\s*public,\s*max-age=0,\s*must-revalidate/.test(headers), headers);
ck("_headers never marks HTML immutable", !/immutable/i.test(headers), headers);

// ---- the deploy matches the build; the integrity probe will PASS on any host ---------------------
ck("publish/index.html redirects to the board at the current BUILD (LANE F)",
   read("publish/index.html").indexOf("board.html?v=" + build) >= 0, build);
ck("publish/version.json carries the current BUILD (deploy and build agree)",
   JSON.parse(read("publish/version.json")).build === build, build);

// the integrity probe compares sha256(board.html bytes) to version.json.boardSha256 by RELATIVE fetch,
// so it is host-independent: prove the shipped bytes still match the published hash.
const boardBytes = fs.readFileSync(path.join(ROOT, "publish/library/board.html"));
const boardSha = crypto.createHash("sha256").update(boardBytes).digest("hex");
ck("the integrity probe will pass on Cloudflare: sha256(publish board.html) == version.json.boardSha256",
   boardSha === ver.boardSha256, boardSha + " vs " + ver.boardSha256);
ck("version.json boardBytes matches the shipped board.html length", ver.boardBytes === boardBytes.length, ver.boardBytes + " vs " + boardBytes.length);

console.log("\n(build " + build + ")");
console.log(fails.length ? ("FAILED: " + fails.join(", ")) : "ALL CLOUDFLARE-PAGES CHECKS PASS");
process.exit(fails.length ? 1 : 0);
