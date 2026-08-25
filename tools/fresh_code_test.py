"""Fresh code guaranteed, paint truth on screen.

Every prior console fix shipped blind: we never confirmed on the device that the browser was running the
new code, or what each paint read. This brief ends that. One real fix (cache integrity) and two
observability surfaces you can read on an iPad:

  Part 1  the shell can never be served stale: every asset carries ?v=<content hash>, the root redirect
          carries the build id (console.html?v=BUILD), the shell sends no-store cache directives, and any
          stale service worker is unregistered on boot.
  Part 2  an always-visible build stamp (bottom corner, low contrast) reads the build id and the deploy
          time, baked at build time, so a glance says which code is live and when it was built.
  Part 3  the paint oracle renders ON SCREEN behind ?debug=paint (not console-only), scrollable, listing
          the last paints with trigger, source store, per-lane counts and hash, DIVERGED flagged in a
          distinct color, and a no-op hidden panel when the flag is off.

No board derivation or lane logic changes here; Parts 2 and 3 are additive display, Part 1 is cache
integrity. The device gate is Thyab pasting the two DIVERGED rows off the iPad.
"""
import threading, http.server, socketserver, functools, os, sys, re
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT="/home/user/thrive-console"; CH="/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails=[]
def ck(n,c,d=None):
    print(("PASS " if c else "FAIL ")+n)
    if not c:
        fails.append(n)
        if d is not None: print("      "+str(d)[:300])

console=open(f"{ROOT}/library/console.html", encoding="utf-8").read()
index=open(f"{ROOT}/index.html", encoding="utf-8").read()
app=open(f"{ROOT}/library/app.js", encoding="utf-8").read()
bundle=open(f"{ROOT}/tools/bundle.js", encoding="utf-8").read()

BUILD=re.search(r'name="thrive-build" content="([0-9a-f]+)"', console).group(1)
BUILT_AT=re.search(r'name="thrive-built-at" content="([^"]+)"', console).group(1)

# ============================ Part 1: fresh code guaranteed ============================
ck("Part 1: every script and style the shell loads is content-hash versioned (?v=hash), never a bare name",
   'app.js?v=' in console and 'styles.css?v=' in console and 'stage-model.js?v=' in console
   and re.search(r'src="app\.js"(?!\?)', console) is None)
ck("Part 1: the root redirect carries the build id, so a new deploy points at a URL never cached (console.html?v=BUILD)",
   ('console.html?v='+BUILD) in index and index.count('console.html?v='+BUILD)>=2)
ck("Part 1: the shell and the root index both send no-store / must-revalidate cache directives",
   'Cache-Control" content="no-cache, no-store, must-revalidate"' in console
   and 'Cache-Control" content="no-cache, no-store, must-revalidate"' in index)
ck("Part 1: a stale service worker is unregistered on boot (cannot pin old bytes)",
   'navigator.serviceWorker.getRegistrations' in console and '.unregister()' in console)

# ============================ Part 2: the build stamp is baked ============================
ck("Part 2: the deploy time is baked at build time in bundle.js (BUILT_AT), UTC, never read at runtime",
   'const BUILT_AT = new Date().toISOString()' in bundle and re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", BUILT_AT) is not None)
ck("Part 2: the shell carries a visible build-stamp element with the id and the deploy time",
   'class="build-stamp"' in console and BUILD in console.split('class="build-stamp"')[1].split("</div>")[0]
   and BUILT_AT in console.split('class="build-stamp"')[1].split("</div>")[0])

# ============================ Part 3: overlay on screen, scrollable ============================
ck("Part 3: the paint overlay is scrollable and touchable on screen (not pointer-events:none)",
   'id="paintDebugOverlay"' in app and 'pointer-events:auto' in app
   and 'overflow:auto' in app and 'pointer-events:none;white-space' not in app)

# ============================ live ============================
Handler=functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address=True
httpd=socketserver.TCPServer(("127.0.0.1",0),Handler); PORT=httpd.server_address[1]
httpd.daemon_threads=True; threading.Thread(target=httpd.serve_forever,daemon=True).start()
base=f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CH)
    ctx=b.new_context(viewport={"width":1280,"height":900})
    ctx.route("https://api.github.com/**", lambda r:r.abort())
    ctx.route(f"{base}/library/manifest.json", lambda r:r.fulfill(status=200, body='{"opportunities":[]}'))

    # ---- the root index is the BARE_GATE router (brief P54) ----
    # A fresh visit with NO operator session bounces to the bare gate (never a black screen).
    pg=ctx.new_page()
    pg.goto(f"{base}/index.html"); pg.wait_for_timeout(600)
    ck("live: a fresh visit with no session lands on the bare gate (gate.html)",
       pg.url.endswith("/gate.html"), pg.url)
    # With a live operator session mirrored (the carrier across the gate.html -> index.html navigation),
    # the router forwards to the versioned shell, no network on the warm path.
    pg.evaluate("()=>localStorage.setItem('console_sb_session', JSON.stringify({access_token:'t',refresh_token:'r',expires_at:9999999999,email:'op@t.test'}))")
    pg.goto(f"{base}/index.html"); pg.wait_for_timeout(600)
    ck("live: with a live session the site forwards to the versioned shell (console.html?v=BUILD)",
       ("console.html?v="+BUILD) in pg.url, pg.url)

    # ---- the build stamp renders, visible, with the served build id and deploy time ----
    pg.wait_for_function("()=>typeof window.ThrivePaintDebug==='object'", timeout=15000)
    pg.evaluate("()=>{document.documentElement.classList.remove('gate-locked');const g=document.getElementById('thriveGate');if(g)g.remove();}")
    stamp=pg.evaluate("""()=>{ const e=document.querySelector('.build-stamp');
      if(!e) return null; const cs=getComputedStyle(e);
      return { text:e.textContent.trim(), visible:e.offsetParent!==null||cs.position==='fixed',
               fixed:cs.position==='fixed', pe:cs.pointerEvents }; }""")
    ck("Part 2 live: the build stamp is on screen, fixed, and non-interactive (does not obstruct the board)",
       bool(stamp) and stamp["fixed"] and stamp["pe"]=="none", stamp)
    ck("Part 2 live: the stamp shows the served build id and the deploy time",
       bool(stamp) and BUILD in stamp["text"] and BUILT_AT in stamp["text"], stamp)
    served_meta=pg.evaluate("()=>{var m=document.querySelector('meta[name=\"thrive-build\"]');return m&&m.getAttribute('content');}")
    ck("Part 2 live: the served build id equals the stamp id (device shows the code it is running)",
       served_meta==BUILD, served_meta)

    # ---- the overlay: off = nothing; on = scrollable panel with DIVERGED ----
    off=pg.evaluate("()=>({ overlay:!!document.getElementById('paintDebugOverlay'), enabled:window.ThrivePaintDebug.enabled() })")
    ck("Part 3 live: with the flag OFF the overlay does not exist and the instrument is disabled",
       off["overlay"] is False and off["enabled"] is False, off)
    pg.close()

    pg=ctx.new_page()
    logs=[]; pg.on("console", lambda m: logs.append(m.text))
    pg.goto(f"{base}/library/console.html?debug=paint")
    pg.wait_for_function("()=>typeof window.thriveBoardRefresh==='function'", timeout=15000)
    pg.evaluate("()=>{document.documentElement.classList.remove('gate-locked');const g=document.getElementById('thriveGate');if(g)g.remove();}")
    # two differing paints -> a DIVERGED row on screen
    pg.evaluate("""()=>{ localStorage.setItem('thrive_opps_v1', JSON.stringify([{slug:'a',business:'A',published:true}]));
       localStorage.setItem('thrive_mail_v1','[]'); window.invalidateSends&&window.invalidateSends();
       location.hash='board'; window.thriveBoardRefresh(); }""")
    pg.wait_for_timeout(400)
    pg.evaluate("""()=>{ localStorage.setItem('thrive_opps_v1', JSON.stringify([{slug:'a',business:'A',published:true},{slug:'b',business:'B',published:true}]));
       window.invalidateSends&&window.invalidateSends(); window.thriveBoardRefresh(); }""")
    pg.wait_for_timeout(400)
    ov=pg.evaluate("""()=>{ const o=document.getElementById('paintDebugOverlay'); if(!o) return null;
      const cs=getComputedStyle(o);
      return { rows:o.childNodes.length, scrollable:(cs.overflowY==='auto'||cs.overflowY==='scroll') && cs.pointerEvents==='auto',
               text:o.textContent, hasSrc:o.textContent.indexOf('src=')>=0, hasHash:o.textContent.indexOf('hash=')>=0,
               diverged:o.textContent.indexOf('DIVERGED')>=0 }; }""")
    ck("Part 3 live: with ?debug=paint the overlay renders on screen and is scrollable and touchable",
       bool(ov) and ov["rows"]>=2 and ov["scrollable"], ov)
    ck("Part 3 live: each row shows the source store and the content hash",
       bool(ov) and ov["hasSrc"] and ov["hasHash"], ov)
    ck("Part 3 live: two consecutive paints with different data are flagged DIVERGED on screen",
       bool(ov) and ov["diverged"], {"text":(ov or {}).get("text","")[:200]})

    ctx.close(); b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
