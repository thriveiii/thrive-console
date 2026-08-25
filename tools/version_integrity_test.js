/* P43 version integrity (Node). One build everywhere:
   - version.json exists, is written by the bundler, and agrees with the shell's baked stamp;
   - the front door (index.html) asks version.json for the CURRENT build (no-store) and only falls back
     to its baked value when the fetch fails, so a stale index can no longer chain-pin the shell;
   - the shell (via failsafe.js) verifies its own stamp against version.json at boot: a mismatch forces
     ONE revalidating reload (?v=<current>&vr=1, old v dropped, other params + hash kept), a second
     mismatch never loops (URL flag, not storage) and panels "Mixed build" with both stamps, and an
     unreachable version.json never blocks boot. */
const fs = require("fs"), path = require("path"), assert = require("assert");
const ROOT = path.resolve(__dirname, "..");
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");
const SRC = read("library/failsafe.js");

let fails = 0;
function ck(n, fn) { try { fn(); console.log("PASS " + n); } catch (e) { fails++; console.log("FAIL " + n + "\n     " + (e && e.message || e)); } }

// V1: the authority exists and agrees with every baked stamp.
ck("V1 version.json exists and matches the shell meta and the index redirect", () => {
  const v = JSON.parse(read("version.json"));
  assert(v.build && /^[0-9a-f]{8}$/.test(v.build), "version.json build malformed");
  assert(v.builtAt, "builtAt missing");
  const shell = read("library/console.html");
  const m = /<meta name="thrive-build" content="([0-9a-f]{8})">/.exec(shell);
  assert(m && m[1] === v.build, "shell meta stamp " + (m && m[1]) + " != version.json " + v.build);
  const idx = read("index.html");
  assert(idx.indexOf('?v=' + v.build) >= 0, "index redirect does not carry the current build");
});

// V2 (BARE_GATE, brief P54): the front door is a SESSION-AWARE router, still with NO version.json probe in
// the critical path. The meta refresh fires at 0s (JS-off fallback) to the current shell; the inline JS
// decides at once: a live/warm session forwards to the baked shell (location.replace, no wait), no session
// bounces to gate.html, and an expired token gets ONE silent AUTH refresh (not a version.json probe) before
// forwarding or bouncing. The in-shell P43 convergence (V3, failsafe.js) is still the stale-client net.
ck("V2 index.html is a session-aware router (no version.json probe): warm/live -> shell, none -> gate.html, expired -> one refresh", () => {
  const idx = read("index.html");
  assert(!/fetch\([^)]*version/.test(idx), "the front door must not fetch version.json in the critical path (a comment may name it; nothing probes it)");
  assert(/if\(warm\)\{ toConsole\(\); return; \}/.test(idx), "the warm-arrival forward is missing");
  assert(/if\(!sess\|\|!sess\.access_token\)\{ toGate\(\); return; \}/.test(idx), "the no-session bounce to the gate is missing");
  assert(/if\(!expired\(sess\)\)\{ toConsole\(\); return; \}/.test(idx), "the live-session forward is missing");
  assert(/function toConsole\(\)\{ location\.replace\("\.\/library\/console\.html\?v="\+BUILD/.test(idx), "the forward to the baked shell is missing");
  assert(/function toGate\(\)\{ location\.replace\("gate\.html"\); \}/.test(idx), "the bounce target must be gate.html");
  assert(/grant_type=refresh_token/.test(idx), "the expired-token silent refresh is missing");
  const mr = /<meta http-equiv="refresh" content="(\d+);/.exec(idx);
  assert(mr && Number(mr[1]) === 0, "meta refresh must be immediate (content=\"0; ...\") for the JS-off fallback");
  // query-param carry-over (stale v/vr/warm dropped) and hash carry-over must still be present
  assert(/indexOf\("v="\)!==0&&p\.indexOf\("vr="\)!==0/.test(idx), "stale v/vr param stripping missing");
  assert(/\(location\.hash\|\|""\)/.test(idx), "hash carry-over missing");
});

// V3: the shell verifies itself (source contract in failsafe.js).
ck("V3 failsafe fetches ../version.json no-store and one-shot guards via the vr URL flag", () => {
  assert(/fetch\("\.\.\/version\.json", \{ cache: "no-store" \}\)/.test(SRC), "no-store fetch missing");
  assert(/vr=1/.test(SRC) && /location\.replace/.test(SRC), "one-shot converge-reload missing");
  assert(SRC.indexOf("localStorage") < SRC.indexOf("version.json") || !/vr[^]*localStorage/.test(SRC.slice(SRC.indexOf("version convergence"), SRC.indexOf("boot watchdog"))), "the loop guard must be the URL flag, not storage");
});

// ---- runtime, DOM-shimmed --------------------------------------------------------------------------
function makeEnv(opts) {
  opts = opts || {};
  function elem(t){return {children:[],attrs:{},style:{},_text:"",set textContent(v){this._text=String(v)},get textContent(){return this._text+this.children.map(c=>c.textContent).join("\n")},setAttribute(k,v){this.attrs[k]=v},appendChild(c){this.children.push(c);c.parentNode=this;return c},removeChild(c){var i=this.children.indexOf(c);if(i>=0)this.children.splice(i,1);}};}
  const root = elem("html");
  root.classList = { _s:new Set(), add(c){this._s.add(c)}, remove(c){this._s.delete(c)}, contains(c){return this._s.has(c)} };
  const body = elem("body");
  const replaced = [];
  global.window = { addEventListener(){}, __thriveBooted: true };   // healthy gate: sentry stays quiet
  global.document = { documentElement: root, body: body, createElement: elem, getElementById: () => null,
    querySelector: s => /meta/.test(s) ? { getAttribute: () => opts.docBuild } : null };
  global.localStorage = { getItem: () => null };
  global.setTimeout = cb => 1;   // timers never fire in these cases
  global.location = { pathname: "/library/console.html", search: opts.search || "", hash: opts.hash || "",
    replace: u => replaced.push(u) };
  const pending = [];
  global.fetch = (url, o) => {
    assert(o && o.cache === "no-store", "version fetch must be no-store");
    if (opts.unreachable) return Promise.reject(new Error("offline"));
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ build: opts.serverBuild }) });
  };
  new Function(SRC)();
  const findPanel = () => body.children.concat(root.children).find(c => c.id === "thriveFailsafe");
  return { replaced, findPanel, root, body, settle: () => new Promise(r => setImmediate(r)) };
}

(async function () {
  // V4: stale document -> one revalidating reload with the served build, old v dropped, hash kept.
  await (async () => {
    const env = makeEnv({ docBuild: "aaaa1111", serverBuild: "bbbb2222", search: "?v=aaaa1111&debug=paint", hash: "#board" });
    await env.settle(); await env.settle();
    ck("V4 a stale document force-converges once, dropping the old v, keeping params and hash", () => {
      assert(env.replaced.length === 1, "expected exactly one reload, got " + env.replaced.length);
      const u = env.replaced[0];
      assert(u.indexOf("v=bbbb2222") >= 0, "served build missing from the reload URL: " + u);
      assert(u.indexOf("aaaa1111") < 0, "the STALE v leaked into the reload URL: " + u);
      assert(u.indexOf("debug=paint") >= 0 && u.indexOf("#board") >= 0, "params/hash lost: " + u);
      assert(u.indexOf("vr=1") >= 0, "one-shot flag missing: " + u);
    });
  })();

  // V5: already converged once (vr=1) and STILL mismatched -> no loop; the panel names both stamps.
  await (async () => {
    const env = makeEnv({ docBuild: "aaaa1111", serverBuild: "bbbb2222", search: "?v=bbbb2222&vr=1" });
    await env.settle(); await env.settle();
    ck("V5 a persistent mismatch never loops and panels 'Mixed build' with both stamps", () => {
      assert(env.replaced.length === 0, "reloaded again: an infinite loop in the wild");
      const p = env.findPanel();
      assert(p, "no mixed-build panel");
      assert(p.textContent.indexOf("Mixed build detected") >= 0, "header missing");
      assert(p.textContent.indexOf("aaaa1111") >= 0 && p.textContent.indexOf("bbbb2222") >= 0, "both stamps must be named");
    });
  })();

  // V6: stamps agree -> nothing happens.
  await (async () => {
    const env = makeEnv({ docBuild: "cccc3333", serverBuild: "cccc3333" });
    await env.settle(); await env.settle();
    ck("V6 matching stamps: no reload, no panel", () => {
      assert(env.replaced.length === 0 && !env.findPanel(), "acted on a healthy build");
    });
  })();

  // V7: version.json unreachable -> boot proceeds untouched (best-effort, never a wall).
  await (async () => {
    const env = makeEnv({ docBuild: "cccc3333", unreachable: true });
    await env.settle(); await env.settle();
    ck("V7 unreachable version.json: no reload, no panel, boot proceeds", () => {
      assert(env.replaced.length === 0 && !env.findPanel(), "an offline check blocked the boot");
    });
  })();

  console.log(fails === 0 ? "\n0 failed" : "\n" + fails + " failed");
  process.exit(fails === 0 ? 0 : 1);
})();
