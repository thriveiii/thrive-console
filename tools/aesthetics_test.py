"""AESTHETICS pass on the ported canon: header identity, ONE icon + tooltip system, iconified chrome with a
touch-reachable name, text-keeping exceptions (send journey + lane headers), and calm shimmer transitions.

Asserts (each fails-when-broken):
  (a) the header renders the rotating brand-gradient asterisk mark + the wordmark THE CONSOLE / غرفة التحكم
      (localized), the wordmark wears the gradient, and prefers-reduced-motion disables the rotation.
  (b) every iconified control carries a permanent accessible name (aria-label + title) AND a touch-reveal:
      a tap (pointerdown, pointerType touch) shows the ONE tooltip component, so meaning is never hover-only.
  (c) the send journey (mode options, Send/Create) and the five lane headers keep their WORD and add an icon
      (icon + text), never icon-only.
  (d) the transitions are transform/opacity-only and reduced-motion guarded (the shimmer sweep and the mark).
  (e) no em dash anywhere; itfGhroob 0 refs; no dusty rose (#C98B8B / #9c5757); the gradient primary survives.
  (f) Arabic carries letter-spacing:normal and no uppercase (wordmark, lane header).
  (g) smoke: board / window tabs / upload / Library / Contacts render and unifiedSend still wires runSend.

FAILS-WHEN-BROKEN: drop the mark/wordmark, an icon with no name or no touch reveal, an icon-only lane header
or send button, a layout-animating or unguarded transition, a reintroduced rose / itfGhroob, or a broken surface.
"""
import os, re, json, threading, http.server, socketserver, functools
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:300])

src = open(f"{ROOT}/library/board.html", encoding="utf-8").read()

# ---- static guards ---------------------------------------------------------------------------------
ck("(a) the header has the rotating brand mark + localizable wordmark", 'class="brand-mark"' in src and 'id="brandWord"' in src and "brandspin" in src)
ck("(a) the wordmark wears the gradient (clip on .brand-word)", re.search(r"\.brand-word\{[^}]*background:var\(--grad\)", src) is not None)
ck("(a) reduced-motion disables the mark rotation", re.search(r"@media \(prefers-reduced-motion:reduce\)\{ \.brand-mark\{animation:none\}", src) is not None)
ck("(d) the shimmer sweep is transform-only (no width/height/top/left animated)",
   "@keyframes thriveShimmer" in src and re.search(r"@keyframes thriveShimmer\{[^}]*translateX", src) is not None
   and not re.search(r"@keyframes thriveShimmer\{[^}]*(width|height|top|left):", src))
ck("(d) the shimmer is reduced-motion guarded", re.search(r"@media \(prefers-reduced-motion:reduce\)\{ \.shimmer::after\{display:none\}", src) is not None)
ck("(e) no em dash anywhere", "—" not in src)
ck("(e) itfGhroob is fully removed (0 references)", "itfGhroob" not in src)
for lit in ["#C98B8B", "#9c5757", "#a85f5f"]:
    ck("(e) no dusty-rose literal: " + lit, lit not in src)
ck("(e) the gradient primary survives (--btn-primary-bg: var(--grad))", re.search(r"--btn-primary-bg:\s*var\(--grad\)", src) is not None)
ck("(g) unifiedSend wires the one send path (calls runSend)", bool(re.search(r"function unifiedSend\(slug\)\{.*?runSend\(", src, re.S)))

# ---- browser -------------------------------------------------------------------------------------
BOARD = [
 {"slug":"a","business":"Alpha Co","stage":"live","sent_count":0,"open_count":0,"replied":False,"idle_days":0,"last_activity_ts":"2026-02-01T00:00:00Z","has_page":True,"has_email":True,"archived":False},
 {"slug":"b","business":"Beta Co","stage":"replied","sent_count":2,"open_count":1,"replied":True,"idle_days":0,"last_activity_ts":"2026-02-02T00:00:00Z","has_page":False,"has_email":True,"archived":False},
]
OPPDATA={}
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True; threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright
def J(r,o): r.fulfill(status=200, headers={"content-type":"application/json"}, body=json.dumps(o))
def ropp(r):
    m=re.search(r'slug=eq\.([^&]+)', r.request.url); sl=m.group(1) if m else ""
    if r.request.method in ("POST","PATCH"): return r.fulfill(status=204, body="")
    return J(r, [{"slug":sl,"data":OPPDATA.get(sl,{}),"archived_at":None}])
def wire(ctx, ar=False):
    js="try{localStorage.setItem('console_sb_session', JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'op@thrive.test',uid:'u'}));"
    if ar: js+="localStorage.setItem('thrive_lang','ar');"
    js+="}catch(e){}"
    ctx.add_init_script(js)
    ctx.route(re.compile(r"script\.google\.com/.*"), lambda r: J(r,{"ok":True}))
    ctx.route("**/rest/v1/console_board**", lambda r: J(r, BOARD))
    ctx.route("**/rest/v1/console_opps**", ropp)
    ctx.route("**/rest/v1/console_pages**", lambda r: J(r,[{"slug":"a","live_verified_at":"2026-01-01T00:00:00Z"}]))
    for tn in ["console_mail","console_hits","console_inbound","console_suppressions","console_profiles","console_profile_names","console_members","console_team_roster","console_admins","console_contacts"]:
        ctx.route(f"**/rest/v1/{tn}**", lambda r: J(r,[]))

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width":1200,"height":900}); wire(ctx)
    pg = ctx.new_page(); perr=[]; pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(700)
    pg.wait_for_selector(".lane", timeout=8000)

    # (a) mark spins, wordmark is THE CONSOLE, and the mark is the OFFICIAL logo asset (a loaded <img>), not a hand-drawn shape
    hd = pg.evaluate("""()=>{ var m=document.querySelector('.brand-mark'), w=document.getElementById('brandWord'), img=m&&m.querySelector('img.brand-logo');
        return { word:w&&w.textContent, anim:m?getComputedStyle(m).animationName:'', hasLogo:!!img, logoSrc:img?img.getAttribute('src'):'', logoLoaded:!!(img&&img.complete&&img.naturalWidth>0) }; }""")
    ck("(a) the wordmark reads THE CONSOLE and the mark rotates", hd["word"]=="THE CONSOLE" and hd["anim"]=="brandspin", hd)
    ck("(a) the mark is the pinned official Thrive logo asset, loaded", hd["hasLogo"] and "thrive-logo.png" in (hd["logoSrc"] or "") and hd["logoLoaded"], hd)

    # (b) every iconbtn has a name + tooltip data; a touch tap reveals the ONE tooltip
    names = pg.evaluate("""()=>{ var bad=[]; [].forEach.call(document.querySelectorAll('.iconbtn'), function(b){
        if(!b.getAttribute('aria-label') || !b.getAttribute('title') || !b.getAttribute('data-tip')) bad.push(b.id||b.className); });
        return { n:document.querySelectorAll('.iconbtn').length, bad:bad }; }""")
    ck("(b) there are iconified chrome controls", names["n"]>=5, names)
    ck("(b) every icon-only control carries aria-label + title + data-tip (name reachable on touch/SR)", names["bad"]==[], names)
    touch = pg.evaluate("""()=>{ var el=document.querySelector('.iconbtn'); if(!el) return null;
        var ev=new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch'}); el.dispatchEvent(ev);
        var tip=document.getElementById('thriveTip'); return tip ? { on:tip.classList.contains('on'), text:tip.textContent } : null; }""")
    ck("(b) a touch tap reveals the tooltip (not hover-only)", bool(touch) and touch["on"] is True and len(touch["text"])>0, touch)

    # (c) lane headers = icon + text; the mode options and Send keep their word + an icon
    lane = pg.evaluate("""()=>{ var h=document.querySelector('.lane[data-lane="live"] h2'); if(!h) return null;
        return { icn:!!h.querySelector('.icn'), txt:(h.textContent||'').replace(/\\d+/g,'').trim().length>0 }; }""")
    ck("(c) the lane header keeps its label AND has a state icon (icon + text, not icon-only)", lane and lane["icn"] and lane["txt"], lane)
    pg.evaluate("()=>window.owNewMessage()"); pg.wait_for_selector("#owPickText", timeout=5000)
    modes = pg.evaluate("""()=>{ var b=document.getElementById('owPickText'); return b ? { icn:!!b.querySelector('.icn'), txt:(b.textContent||'').trim().length>0 } : null; }""")
    ck("(c) the send-mode option keeps its word AND has a leading icon", modes and modes["icn"] and modes["txt"], modes)
    pg.evaluate("()=>window.owSelectMode('a')"); pg.wait_for_selector("#owModeA #edSubj", timeout=5000)
    sendb = pg.evaluate("""()=>{ var b=document.getElementById('nmSend'); return b ? { icn:!!b.querySelector('.icn'), txt:(b.textContent||'').trim().length>0 } : null; }""")
    ck("(c) the primary Send button keeps its word AND has a leading icon", sendb and sendb["icn"] and sendb["txt"], sendb)
    pg.evaluate("()=>window.closeOppWindow()"); pg.wait_for_timeout(120)

    # window tabs (a tabbed mode: Mode B) are icon + text (named places)
    pg.evaluate("()=>window.openOppWindow('a','b')"); pg.wait_for_timeout(500)
    ck("(g) the opp window renders its tab strip", pg.evaluate("()=>document.querySelectorAll('.ow-tab').length")>=2)
    tab = pg.evaluate("""()=>{ var t=document.querySelector('.ow-tab'); return t ? { icn:!!t.querySelector('.icn'), txt:(t.textContent||'').trim().length>0 } : null; }""")
    ck("(c) the window tabs keep their noun AND add an icon", tab and tab["icn"] and tab["txt"], tab)
    pg.evaluate("()=>window.closeOppWindow()"); pg.wait_for_timeout(120)
    pg.evaluate("()=>window.owNewMessage()"); pg.wait_for_selector("#owPickUpload", timeout=5000)
    pg.click("#owPickUpload"); pg.wait_for_timeout(300)
    ck("(g) the upload path renders", pg.evaluate("()=>!!document.getElementById('owUploadFile')||!!document.getElementById('owBodyUpload')"))
    pg.evaluate("()=>window.closeOppWindow()"); pg.wait_for_timeout(120)
    pg.click("#libBtn"); pg.wait_for_timeout(300)
    ck("(g) the Library overlay renders", pg.evaluate("()=>{var s=document.getElementById('libViewScrim');return !!s && !s.hidden && !!document.querySelector('.lv-title');}"))
    pg.evaluate("()=>{var s=document.getElementById('libViewScrim');if(s)s.hidden=true;}")
    pg.evaluate("()=>window.openContactsView()"); pg.wait_for_timeout(300)
    ck("(g) the Contacts overlay renders", pg.evaluate("()=>{var s=document.getElementById('ctScrim');return !!s && !s.hidden;}"))
    ck("(g) no uncaught page error (EN)", len(perr)==0, perr)
    pg.close(); ctx.close()

    # (a)+(d) reduced motion emulation: the mark does not rotate
    rm = b.new_context(viewport={"width":1024,"height":800}, reduced_motion="reduce"); wire(rm)
    rp = rm.new_page(); rp.goto(f"{base}/library/board.html", wait_until="load"); rp.wait_for_timeout(600); rp.wait_for_selector(".lane", timeout=8000)
    anim = rp.evaluate("()=>{var m=document.querySelector('.brand-mark');return m?getComputedStyle(m).animationName:'x';}")
    ck("(a/d) prefers-reduced-motion stops the mark rotation (animation-name none)", anim=="none", anim)
    rp.close(); rm.close()

    # (f) Arabic: wordmark + lane header carry letter-spacing normal, no uppercase
    ar = b.new_context(viewport={"width":420,"height":900}); wire(ar, ar=True)
    ap = ar.new_page(); perr2=[]; ap.on("pageerror", lambda e: perr2.append(str(e)))
    ap.goto(f"{base}/library/board.html", wait_until="load"); ap.wait_for_timeout(700); ap.wait_for_selector(".lane", timeout=8000)
    arv = ap.evaluate("""()=>{ function g(s){var e=document.querySelector(s);if(!e)return null;var c=getComputedStyle(e);return {ls:c.letterSpacing,tt:c.textTransform};}
        return { word:document.getElementById('brandWord').textContent, bw:g('.brand-word'), lane:g('.lane h2') }; }""")
    ck("(f) the Arabic wordmark is غرفة التحكم", arv["word"]=="غرفة التحكم", arv["word"])
    ck("(f) the Arabic wordmark carries letter-spacing:normal and no uppercase", arv["bw"] and arv["bw"]["ls"]=="normal" and arv["bw"]["tt"]=="none", arv)
    ck("(f) the Arabic lane header carries letter-spacing:normal and no uppercase", arv["lane"] and arv["lane"]["ls"]=="normal" and arv["lane"]["tt"]=="none", arv)
    ck("(f) no uncaught page error (AR)", len(perr2)==0, perr2)
    ap.close(); ar.close()
    b.close()
httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL AESTHETICS CHECKS PASS"))
import sys; sys.exit(1 if fails else 0)
