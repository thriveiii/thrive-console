"""CONTROL ROOM Phase 2 (board.html) - greeting toggle + bulk send + smart name, all on the MESSAGE gate and the
shared send path. Stateful mock of the relay (script.google.com /exec) and Supabase REST; NO email is ever sent.

Proves:
  1. GREETING TOGGLE changes the compiled message LIVE: name mode -> "Hi <Name>,", platform mode -> "Hi <Platform> team,"
     (EN), both in #edPreview (compiled through the send path), switching back and forth.
  2. NO-NAME never blocks: a role address (hello@) has no person name; the greeting falls back to "Hi <Platform> team,"
     and the send still goes through (a console_mail row is written).
  3. BULK: the "also send to related contacts" checkbox adds recipients; each one gets its OWN one-to-one console_mail
     row (never a shared To).
  4. B2: a suppressed added recipient is REFUSED (no row) while the others send.
  5. The SEND button exists and works on the MESSAGE gate (like #319).
  6. The G7.1 signature is guaranteed on a send even when the signature field is empty.

FAILS-WHEN-BROKEN: the greeting toggle not changing the compiled message, OR a send blocked purely because a name
is missing, OR a send surface with no working send button -> fails.
"""
import os, re, json, threading, http.server, socketserver, functools
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:500])

def mkopp(slug, biz, addr, body):
    return {"slug":slug, "business":biz, "has_email":True, "archived":False,
            "data":{"recipients":[{"addr":addr, "name":"", "lang":""}],
                    "outreach_subject":"A note for "+biz, "outreach_text":body, "page_slug":slug}}
OPPS = {
  "alpha":  mkopp("alpha","Alpha Co","sarah@bards-alley.example","Hi {{NAME}}, we would love to feature you."),
  "roleco": mkopp("roleco","Role Co","hello@example-shop.example","Hi {{NAME}}, a quick note for you."),
}
SUPPRESSED = ["blocked@x.example"]
MAIL, RELAY_CALLS = [], []
def rows_for(slug): return [m for m in MAIL if m.get("opp")==slug]
def sent_count(slug): return len(rows_for(slug))
def board_rows():
    out=[]
    for o in OPPS.values():
        sc=sent_count(o["slug"]); stage = "sent" if sc>0 else "live"
        out.append({"slug":o["slug"],"business":o["business"],"stage":stage,"sent_count":sc,"open_count":0,
          "replied":False,"idle_days":0,"last_activity_ts":"2026-01-04T00:00:00Z","has_page":True,"has_email":True,"archived":False})
    return out
def slug_of(url):
    m=re.search(r'eq\.([^&]+)', url); return m.group(1) if m else ""
def slug_of_payload(body):
    try: return (json.loads(body) or {}).get("slug","")
    except Exception: return ""

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True; threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

def J(r,o,s=200): r.fulfill(status=s, headers={"content-type":"application/json"}, body=json.dumps(o))
def route_board(r): J(r, board_rows())
def route_empty(r): J(r, [])
def route_opps(r):
    req=r.request
    if req.method in ("POST","PATCH"):
        try: body=json.loads(req.post_data or "[]")
        except Exception: body=[]
        for row in (body if isinstance(body,list) else [body]):
            sl = row.get("slug") or slug_of(req.url)
            if sl and sl in OPPS and isinstance(row.get("data"), dict): OPPS[sl]["data"] = row["data"]
        return r.fulfill(status=204, body="")
    o=OPPS.get(slug_of(req.url), {"slug":"","data":{}}); J(r, [{"slug":o["slug"],"data":o.get("data",{})}])
def route_mail(r):
    req=r.request
    if req.method=="POST":
        try: arr=json.loads(req.post_data or "[]")
        except Exception: arr=[]
        for row in (arr if isinstance(arr,list) else [arr]):
            if isinstance(row,dict) and row.get("opp"): MAIL.append(row)
        return r.fulfill(status=204, body="")
    return J(r, [])
def route_pages(r):
    if "select=html" in r.request.url: return J(r, [{"html":"<h1>x</h1>"}])
    if "select=title" in r.request.url: return J(r, [{"title":"T"}])
    return J(r, [{"slug":slug_of(r.request.url),"live_verified_at":"2026-01-01T00:00:00Z"}])
def route_supp(r): J(r, [{"email":e} for e in SUPPRESSED])
def route_relay(r):
    try: RELAY_CALLS.append(json.loads(r.request.post_data or "{}"))
    except Exception: RELAY_CALLS.append({})
    return J(r, {"ok":True, "id":"resend", "relay_version":9, "delivered":True})

def wire(ctx):
    ctx.add_init_script("try{localStorage.setItem('console_sb_session', JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'op@thrive.test',uid:'u'}));}catch(e){}")
    ctx.route(re.compile(r"script\.google\.com/.*"), route_relay)
    ctx.route("**/rest/v1/console_board**", route_board)
    ctx.route("**/rest/v1/console_opps**", route_opps)
    ctx.route("**/rest/v1/console_mail**", route_mail)
    ctx.route("**/rest/v1/console_pages**", route_pages)
    ctx.route("**/rest/v1/console_suppressions**", route_supp)
    ctx.route("**/rest/v1/console_inbound**", route_empty)
    ctx.route("**/rest/v1/console_hits**", route_empty)

def srcdoc(pg): return (pg.evaluate("()=>((document.getElementById('edPreview')||{}).getAttribute('srcdoc')||'')") or "")
def open_msg(pg, slug):
    pg.evaluate("(s)=>window.openOppWindow(s,'detail')", slug)
    pg.wait_for_selector("#crMsgPanel #nmSend", timeout=6000)
    pg.wait_for_function("()=>{var s=document.getElementById('edSubj');return s&&s.value;}", timeout=6000)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(); wire(ctx)
    pg = ctx.new_page(); perr=[]; pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(700)
    pg.wait_for_selector(".card[data-slug='alpha']", timeout=8000)

    # ===== 1: GREETING TOGGLE changes the compiled message LIVE =====
    open_msg(pg, "alpha")
    pg.wait_for_function("()=>((document.getElementById('edPreview')||{}).getAttribute('srcdoc')||'').indexOf('Hi Sarah,')>=0", timeout=6000)
    ck("1: name-mode greeting compiles to 'Hi Sarah,' (smart name from the address, live preview)",
       "Hi Sarah," in srcdoc(pg))
    ck("1: the greeting toggle shows both forms (Name / Platform)",
       pg.evaluate("()=>!!document.querySelector('#crMsgPanel [data-greet=\"name\"]') && !!document.querySelector('#crMsgPanel [data-greet=\"platform\"]')"))
    pg.click('#crMsgPanel [data-greet="platform"]')
    pg.wait_for_function("()=>((document.getElementById('edPreview')||{}).getAttribute('srcdoc')||'').indexOf('Hi Bards Alley team,')>=0", timeout=6000)
    sd = srcdoc(pg)
    ck("1: platform-mode greeting compiles to 'Hi Bards Alley team,' (toggle changed the compiled message)",
       "Hi Bards Alley team," in sd and "Hi Sarah," not in sd, sd[:200])
    pg.click('#crMsgPanel [data-greet="name"]')
    pg.wait_for_function("()=>((document.getElementById('edPreview')||{}).getAttribute('srcdoc')||'').indexOf('Hi Sarah,')>=0", timeout=6000)
    ck("1: toggling back to name-mode restores 'Hi Sarah,'", "Hi Sarah," in srcdoc(pg))

    # ===== 2: NO-NAME never blocks; falls back to the platform team greeting and SENDS =====
    pg.evaluate("()=>window.closeOppWindow()"); pg.wait_for_timeout(200)
    open_msg(pg, "roleco")
    pg.wait_for_function("()=>((document.getElementById('edPreview')||{}).getAttribute('srcdoc')||'').indexOf('team,')>=0", timeout=6000)
    ck("2: a role address has no person name -> the greeting falls back to 'Hi Example Shop team,'",
       "Hi Example Shop team," in srcdoc(pg), srcdoc(pg)[:200])
    ck("2: the gentle 'add a name' hint is shown (never a block)",
       pg.evaluate("()=>{var a=document.getElementById('crNameAsk');return !!a && !a.hidden;}"))
    ck("2: Send is ENABLED despite the missing name (a name never gates the send)",
       pg.evaluate("()=>{var b=document.querySelector('#crMsgPanel #nmSend');return !!b && !b.disabled;}"))
    pg.click("#crMsgPanel #nmSend")
    for _ in range(30):
        pg.wait_for_timeout(150)
        if sent_count("roleco")>=1: break
    ck("2: the no-name send went through (one console_mail row for roleco)", sent_count("roleco")==1, MAIL)

    # ===== 3: BULK adds recipients, each an individual one-to-one message =====
    pg.evaluate("()=>window.closeOppWindow()"); pg.wait_for_timeout(200)
    open_msg(pg, "alpha")
    pg.check("#crMsgPanel #crBulkChk"); pg.wait_for_timeout(200)
    pg.fill("#crMsgPanel #crBulkIn", "bob@x.example\ncarol@y.example")
    pg.wait_for_function("()=>{var b=document.querySelector('#crMsgPanel #nmSend');return b && !b.disabled;}", timeout=6000)
    pg.click("#crMsgPanel #nmSend")
    for _ in range(40):
        pg.wait_for_timeout(150)
        if sent_count("alpha")>=3: break
    tos = sorted([str(m.get("to_addr","")) for m in rows_for("alpha")])
    ck("3: bulk send wrote THREE individual console_mail rows (one per recipient, never a shared To)",
       sent_count("alpha")==3, tos)
    ck("3: each recipient got their own row (sarah + bob + carol)",
       tos==["bob@x.example","carol@y.example","sarah@bards-alley.example"], tos)

    # ===== 4: B2 - a suppressed added recipient is refused, the others send =====
    pg.evaluate("()=>window.closeOppWindow()"); pg.wait_for_timeout(300)
    del MAIL[:]
    # reload the board so alpha is back to Live (sent_count now 0)
    pg.evaluate("()=>location.reload()"); pg.wait_for_timeout(800)
    pg.wait_for_selector(".card[data-slug='alpha']", timeout=8000)
    open_msg(pg, "alpha")
    pg.check("#crMsgPanel #crBulkChk"); pg.wait_for_timeout(200)
    pg.fill("#crMsgPanel #crBulkIn", "blocked@x.example")
    pg.wait_for_function("()=>{var b=document.querySelector('#crMsgPanel #nmSend');return b && !b.disabled;}", timeout=6000)
    pg.click("#crMsgPanel #nmSend")
    for _ in range(40):
        pg.wait_for_timeout(150)
        if sent_count("alpha")>=1: break
    pg.wait_for_timeout(600)
    tos2 = [str(m.get("to_addr","")) for m in rows_for("alpha")]
    ck("4: B2 - the primary recipient was sent", "sarah@bards-alley.example" in tos2, tos2)
    ck("4: B2 - the SUPPRESSED added recipient was refused (no row, relay never called for it)",
       "blocked@x.example" not in tos2 and not any((c.get("to")=="blocked@x.example") for c in RELAY_CALLS), tos2)

    # ===== 6: the G7.1 signature is guaranteed even with an empty signature field =====
    ck("6: the compiled send carries the guaranteed signature (Thrive) though the field was empty",
       any("Thrive" in (c.get("text","") or "") for c in RELAY_CALLS), [c.get("text","")[:80] for c in RELAY_CALLS[:1]])

    ck("no uncaught page error fired", len(perr)==0, perr)
    pg.close(); b.close()
httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL CONTROL-ROOM-P2 CHECKS PASS"))
import sys; sys.exit(1 if fails else 0)
