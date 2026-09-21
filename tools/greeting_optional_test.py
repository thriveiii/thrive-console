"""GREETING is OPTIONAL, in the settings above the editor, never injected uncontrollably.

Asserts (each fails-when-broken):
  (a) OFF by default -> the compiled body equals the TYPED body byte-for-byte (no greeting line prepended).
  (b) applying the suggestion prepends EXACTLY ONE greeting line at compile (visible in the compiled artifact),
      and unchecking removes it (fully reversible).
  (c) the suggestion is inferred from the recipient email local-part ("ahmed@" -> "Hi Ahmed,"; a role address
      "info@kentucky..." -> "Hi Kentucky team,"); it never blocks a send when absent (no recipient / no name).
  (d) the greeting control renders in the settings ABOVE the editor (before #edSubj), not below it.
  (e) Arabic: the greeting renders in the AR forms ("مرحبا ...،") and carries letter-spacing:normal.
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
BODY = "We would love to work with you on this."
BOARD=[{"slug":"alpha","business":"Alpha Co","stage":"live","sent_count":0,"open_count":0,"replied":False,"idle_days":0,"last_activity_ts":"2026-02-01T00:00:00Z","has_page":True,"has_email":True,"archived":False}]
MAIL=[]; OPP_SLUGS=set(); OPPDATA={}
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True; threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright
def J(r,o,s=200): r.fulfill(status=s, headers={"content-type":"application/json"}, body=json.dumps(o))
def route_opps(r):
    m=re.search(r'slug=eq\.([^&]+)', r.request.url); sl=m.group(1) if m else ""
    if r.request.method in ("POST","PATCH"):
        try:
            body=json.loads(r.request.post_data or "[]")
            for row in (body if isinstance(body,list) else [body]):
                if not isinstance(row,dict): continue
                s=row.get("slug") or sl
                if s: OPP_SLUGS.add(s)
                if s and isinstance(row.get("data"),dict): OPPDATA[s]=row["data"]
        except Exception: pass
        if sl: OPP_SLUGS.add(sl)
        return r.fulfill(status=204, body="")
    return J(r, [{"slug":sl,"data":OPPDATA.get(sl,{}),"archived_at":None,"archived_from":None}])
def board_rows():
    rows=list(BOARD)
    for s in OPP_SLUGS:
        rows.append({"slug":s,"business":s,"stage":"live","sent_count":0,"open_count":0,"replied":False,"idle_days":0,"last_activity_ts":"2026-02-01T00:00:00Z","has_page":False,"has_email":True,"archived":False,"cycle":None})
    return rows
def route_mail(r):
    if r.request.method=="POST":
        try: rows=json.loads(r.request.post_data or "[]")
        except Exception: rows=[]
        for row in (rows if isinstance(rows,list) else [rows]):
            if isinstance(row,dict) and row.get("opp"): MAIL.append(row)
        return r.fulfill(status=204, body="")
    return J(r, [])
def route_pages(r):
    u=r.request.url
    if "select=html" in u: return J(r,[{"html":"<h1>x</h1>"}])
    if "select=title" in u: return J(r,[{"title":"T"}])
    return J(r,[{"slug":"alpha","live_verified_at":"2026-01-01T00:00:00Z"}])
def wire(ctx, ar=False):
    js="try{localStorage.setItem('console_sb_session', JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'op@thrive.test',uid:'u'}));"
    if ar: js+="localStorage.setItem('thrive_lang','ar');"
    js+="}catch(e){}"
    ctx.add_init_script(js)
    ctx.route(re.compile(r"script\.google\.com/.*"), lambda r: J(r, {"ok":True,"id":"x","relay_version":9,"delivered":True}))
    ctx.route("**/rest/v1/console_board**", lambda r: J(r, board_rows()))
    ctx.route("**/rest/v1/console_opps**", route_opps)
    ctx.route("**/rest/v1/console_mail**", route_mail)
    ctx.route("**/rest/v1/console_pages**", route_pages)
    ctx.route("**/rest/v1/console_suppressions**", lambda r: J(r, []))
    for tn in ["console_hits","console_inbound","console_profiles","console_profile_names","console_members","console_team_roster","console_admins","console_contacts"]:
        ctx.route(f"**/rest/v1/{tn}**", lambda r: J(r, []))

def open_text(pg):
    pg.evaluate("()=>window.owNewMessage()"); pg.wait_for_selector("#owPickText", timeout=6000)
    pg.evaluate("()=>window.owSelectMode('a')"); pg.wait_for_selector("#owModeA #edSubj", timeout=6000)
    return pg.evaluate("()=>window.__thriveOwState().slug")
def set_recip(pg, addr):
    pg.fill("#recIn", addr); pg.wait_for_timeout(200)
    pg.evaluate("()=>{var b=document.getElementById('recSave'); if(b) b.click();}"); pg.wait_for_timeout(200)
def live_text(pg, slug):
    return pg.evaluate("(s)=>{var a=window.__thriveLiveArtifact(s); return a?a.text:'';}", slug)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    # ===== EN: a-d =====
    ctx=b.new_context(viewport={"width":1024,"height":840}); wire(ctx)
    pg=ctx.new_page(); perr=[]; pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(600); pg.wait_for_selector(".lane", timeout=8000)
    slug=open_text(pg)
    pg.fill("#edSubj", "A note"); pg.fill("#edBody", BODY); set_recip(pg, "ahmed@kentucky-books.example")
    pg.wait_for_timeout(300)

    # (d) control ABOVE the editor
    order=pg.evaluate("""()=>{ var g=document.querySelector('#owModeA #crGreet'), s=document.querySelector('#owModeA #edSubj');
        if(!g||!s) return 'missing'; return (g.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING) ? 'above' : 'below'; }""")
    ck("(d) the greeting control renders in the settings ABOVE the editor", order=="above", order)
    ck("(d) it is a compact opt-in checkbox, not two large name/platform fields",
       pg.evaluate("()=>!!document.querySelector('#owModeA #crGreetOn') && !document.getElementById('crName') && !document.getElementById('crPlatform')"))

    # (a) OFF by default -> body byte-for-byte
    off=live_text(pg, slug)
    ck("(a) greeting is OFF by default (checkbox unchecked)", pg.evaluate("()=>!document.getElementById('crGreetOn').checked"))
    ck("(a) the compiled body equals the typed body, no greeting line prepended",
       off.startswith(BODY) and ("Hi Ahmed," not in off) and (not off.lower().startswith("hi ")), off[:160])

    # (c) suggestion inferred from the local-part
    sugg=pg.evaluate("(s)=>window.__thriveGreetSuggest(s)", slug)
    ck("(c) the suggestion is inferred from the email local-part: 'Hi Ahmed,'", sugg=="Hi Ahmed,", repr(sugg))

    # (b) apply -> exactly one greeting line; uncheck -> removed. Let each toggle's debounced save settle so the
    # in-memory base is deterministic (the compile reads it), then read the compiled artifact.
    pg.evaluate("()=>{var c=document.getElementById('crGreetOn'); c.checked=true; c.dispatchEvent(new Event('change',{bubbles:true}));}")
    try: pg.wait_for_function("(s)=>{var a=window.__thriveLiveArtifact(s); return a && a.text.indexOf('Hi Ahmed,')===0;}", arg=slug, timeout=4000)
    except Exception: pass
    pg.wait_for_timeout(600)
    on=live_text(pg, slug)
    ck("(b) applying prepends exactly ONE greeting line at compile, above the typed body",
       on.startswith("Hi Ahmed,\n\n"+BODY) and on.count("Hi Ahmed,")==1, on[:160])
    pg.evaluate("()=>{var c=document.getElementById('crGreetOn'); c.checked=false; c.dispatchEvent(new Event('change',{bubbles:true}));}")
    try: pg.wait_for_function("(s)=>{var a=window.__thriveLiveArtifact(s); return a && a.text.indexOf('Hi Ahmed,')<0;}", arg=slug, timeout=4000)
    except Exception: pass
    pg.wait_for_timeout(600)
    off2=live_text(pg, slug)
    ck("(b) unchecking removes the greeting (fully reversible)", off2.startswith(BODY) and "Hi Ahmed," not in off2, off2[:160])

    # (c) role address -> team form; and never blocks send
    set_recip(pg, "info@kentucky-books.example"); pg.wait_for_timeout(300)
    sugg2=pg.evaluate("(s)=>window.__thriveGreetSuggest(s)", slug)
    ck("(c) a role address infers the team form: 'Hi Kentucky Books team,'", "team," in sugg2 and sugg2.startswith("Hi "), repr(sugg2))
    ck("(c) with a valid recipient, Send is ENABLED (a missing name never blocks the send)",
       pg.evaluate("()=>{var b=document.getElementById('nmSend'); return !!b && !b.disabled;}"))
    # apply greeting on the role address and actually SEND (never blocks)
    pg.evaluate("()=>{var c=document.getElementById('crGreetOn'); c.checked=true; c.dispatchEvent(new Event('change',{bubbles:true}));}")
    pg.wait_for_timeout(200)
    pg.evaluate("()=>{var b=document.getElementById('nmSend'); if(b) b.click();}"); pg.wait_for_timeout(1200)
    ck("(c) the greeting never blocks: the send went through (one console_mail row)", len(MAIL)==1, MAIL)
    ck("no uncaught error (EN)", len(perr)==0, perr)
    pg.close(); ctx.close()

    # ===== (e) Arabic =====
    ctx2=b.new_context(viewport={"width":1024,"height":840}); wire(ctx2, ar=True)
    pg2=ctx2.new_page(); perr2=[]; pg2.on("pageerror", lambda e: perr2.append(str(e)))
    pg2.goto(f"{base}/library/board.html", wait_until="load"); pg2.wait_for_timeout(600); pg2.wait_for_selector(".lane", timeout=8000)
    slug2=open_text(pg2)
    pg2.fill("#edSubj", "ملاحظة"); pg2.fill("#edBody", "يسعدنا العمل معكم."); set_recip(pg2, "ahmed@kentucky-books.example")
    pg2.wait_for_timeout(300)
    suggAr=pg2.evaluate("(s)=>window.__thriveGreetSuggest(s)", slug2)
    ck("(e) the AR greeting uses the Gulf MSA form (مرحبا ...،)", suggAr.startswith("مرحبا ") and suggAr.endswith("،"), repr(suggAr))
    ls=pg2.evaluate("""()=>{ var el=document.querySelector('#owModeA #crGreetSugg')||document.querySelector('#owModeA .g-apply');
        return el?getComputedStyle(el).letterSpacing:'?'; }""")
    ck("(e) Arabic greeting elements carry letter-spacing:normal", ls=="normal", ls)
    dirv=pg2.evaluate("()=>document.documentElement.getAttribute('dir')")
    ck("(e) the document is RTL and the greeting label is localized", dirv=="rtl" and pg2.evaluate("()=>{var l=document.querySelector('#owModeA .g-apply-l'); return !!l && /[\\u0600-\\u06FF]/.test(l.textContent);}"))
    # apply and confirm the AR form is prepended in the compiled body
    pg2.evaluate("()=>{var c=document.getElementById('crGreetOn'); c.checked=true; c.dispatchEvent(new Event('change',{bubbles:true}));}")
    pg2.wait_for_timeout(300)
    onAr=pg2.evaluate("(s)=>{var a=window.__thriveLiveArtifact(s); return a?a.text:'';}", slug2)
    ck("(e) applying prepends the AR greeting line at compile", onAr.startswith("مرحبا ") and "،" in onAr, onAr[:120])
    ck("no uncaught error (AR)", len(perr2)==0, perr2)
    pg2.close(); ctx2.close()
    b.close()
httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL GREETING-OPTIONAL CHECKS PASS"))
import sys; sys.exit(1 if fails else 0)
