"""Sentinel Sweep 5, Layer 1: the paint instrumentation turns the oscillation ghost into evidence.

This is the only behavioural code in the audit. Behind a flag (?debug=paint or localStorage
thrive_debug_paint="1"), every board paint is stamped with a sequence number, the trigger, the source
store, the per-lane counts, and a content hash of the derived model; two consecutive paints with different
hashes print DIVERGED, naming the trigger and the prior hash. This proves the stamp fires, computes the
per-lane model, and flags a divergence, so Thyab's on-device capture of two differing paints names which
trigger and which reader disagreed. It also proves the stamp is a NO-OP when the flag is off (zero cost,
zero console noise on the shipped default).
"""
import threading, http.server, socketserver, functools, os, sys
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT="/home/user/thrive-console"; CH="/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails=[]
def ck(n,c,d=None):
    print(("PASS " if c else "FAIL ")+n)
    if not c:
        fails.append(n)
        if d is not None: print("      "+str(d)[:300])

# source guard: the instrument exists, is flag-gated, and the board render calls it; it writes no store.
app=open(f"{ROOT}/library/app.js").read()
ck("the instrument is flag-gated (?debug=paint or the localStorage switch), never on by default",
   "var ThrivePaintDebug" in app and 'debug=paint' in app and 'thrive_debug_paint' in app)
ck("the board render stamps the one derived model it already built (no extra read, no store write)",
   'ThrivePaintDebug.stamp("board", b)' in app)
ck("the stamp only observes: it never writes localStorage or a store",
   "function stamp(kind, b)" in app and "setItem" not in app.split("function stamp(kind, b)")[1].split("return {")[0])

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
    pg=ctx.new_page()
    logs=[]
    pg.on("console", lambda m: logs.append(m.text))

    # ---- flag OFF: the stamp is a no-op (no overlay, no paint logs) ----
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_function("()=>typeof window.ThrivePaintDebug==='object'", timeout=15000)
    pg.evaluate("()=>{document.documentElement.classList.remove('gate-locked');const g=document.getElementById('thriveGate');if(g)g.remove();}")
    pg.evaluate("""()=>{ localStorage.setItem('thrive_opps_v1', JSON.stringify([
        {slug:'a',business:'A',published:true},{slug:'b',business:'B',published:false}])); }""")
    pg.evaluate("()=>{ location.hash='board'; window.thriveBoardRefresh&&window.thriveBoardRefresh(); }")
    pg.wait_for_timeout(500)
    off=pg.evaluate("()=>({ enabled:window.ThrivePaintDebug.enabled(), overlay:!!document.getElementById('paintDebugOverlay'), last:window.ThrivePaintDebug.last })")
    ck("flag OFF: the instrument reports disabled, paints nothing to the overlay, records no stamp",
       off["enabled"] is False and off["overlay"] is False and off["last"] is None, off)
    ck("flag OFF: no [paint#] line reaches the console (zero noise on the shipped default)",
       not any("[paint#" in x for x in logs), [x for x in logs if "[paint#" in x][:3])

    # ---- flag ON: two differing paints stamp, and the second flags DIVERGED ----
    pg.goto(f"{base}/library/console.html?debug=paint")
    logs.clear()
    pg.wait_for_function("()=>typeof window.ThrivePaintDebug==='object'", timeout=15000)
    pg.evaluate("()=>{document.documentElement.classList.remove('gate-locked');const g=document.getElementById('thriveGate');if(g)g.remove();}")
    # paint 1: two cards (one live, one draft)
    pg.evaluate("""()=>{ localStorage.setItem('thrive_opps_v1', JSON.stringify([
        {slug:'a',business:'A',published:true},{slug:'d',business:'D',published:false}]));
        localStorage.setItem('thrive_mail_v1','[]'); window.invalidateSends&&window.invalidateSends();
        location.hash='board'; window.thriveBoardRefresh(); }""")
    pg.wait_for_timeout(500)
    # paint 2: a DIFFERENT store state (add a third card) -> the derived model changes -> DIVERGED
    pg.evaluate("""()=>{ localStorage.setItem('thrive_opps_v1', JSON.stringify([
        {slug:'a',business:'A',published:true},{slug:'d',business:'D',published:false},{slug:'c',business:'C',published:true}]));
        window.invalidateSends&&window.invalidateSends(); window.thriveBoardRefresh(); }""")
    pg.wait_for_timeout(500)
    on=pg.evaluate("""()=>{ const o=document.getElementById('paintDebugOverlay');
        return { enabled:window.ThrivePaintDebug.enabled(), overlay:!!o, rows:o?o.childNodes.length:0,
                 text:o?o.textContent:'', last:window.ThrivePaintDebug.last }; }""")
    paint_logs=[x for x in logs if "[paint#" in x]
    ck("flag ON: the instrument is enabled and the hidden overlay renders", on["enabled"] and on["overlay"], on)
    ck("flag ON: at least two paints are stamped to the console with per-lane counts and a hash",
       len(paint_logs)>=2 and all("lanes=" in x and "hash=" in x for x in paint_logs[:2]), paint_logs[:3])
    ck("flag ON: a paint names its trigger (read from the call stack)",
       any("trigger=" in x and "trigger=?" not in x for x in paint_logs), paint_logs[:3])
    ck("flag ON: the second, differing paint is flagged DIVERGED (the oscillation signature)",
       any("DIVERGED" in x for x in paint_logs) or ("DIVERGED" in on["text"]), {"logs":paint_logs[-2:], "overlay":on["text"][:200]})
    ck("flag ON: the stamp records the per-lane model (the last stamp carries lane counts and a hash)",
       isinstance(on["last"], dict) and "lanes" in on["last"] and "hash" in on["last"], on["last"])

    ctx.close(); b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
