"""UPLOAD RESULT TRUTH (F1) + SLUG-COLLISION UPDATE + COLLAPSED REVIEW ACCORDION (board.html).

Three refinements on the campaign upload/review/commit flow, each FAILS-WHEN-BROKEN:

  (a) COMMIT TRUTH: a page whose commit SUCCEEDED (relay ok) is never tallied "Failed"; a page whose relay
      call hit a TRANSPORT error (an Apps Script 5xx / a failed 302 body-hop that can arrive AFTER the GitHub
      PUT landed) is reported "published, going live shortly", never "Failed". A GENUINE commit failure (the
      relay ran and refused: structured {ok:false}) still reports failure.
  (b) A DELIVERED SEND is never contradicted: the transport-ambiguous page (the real "Denim delivered but
      shown Failed" incident) is not named in a Failed line, and a send on that opp still runs unifiedSend ->
      runSend and writes its console_mail row.
  (c) SLUG COLLISION UPDATES: uploading a page whose slug already exists does NOT raise "already taken" and
      does NOT auto-rename to slug-2; it UPDATES the existing page (same slug committed, its console_pages row
      re-written = a new version, the subject kept), the row shows "updates existing page: <title>", and a
      one-tap "publish as a new page" exists that suffixes to a free slug instead.
  (d) COLLAPSED ACCORDION: every review row is collapsed by default (compact header only, body height 0);
      clicking the header expands it IN PLACE to reveal Title + recipient email + subject/message + the
      srcdoc preview. Rows toggle independently.
  (e) INVARIANTS: B2 strips a suppressed recipient at commit; {{ASSET_BASE}} is resolved in the committed
      page html; the send path still wires unifiedSend -> runSend (per-recipient one-to-one).
"""
import os, re, json, threading, http.server, socketserver, functools
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

# ---- static guards --------------------------------------------------------------------------------
src = open(f"{ROOT}/library/board.html", encoding="utf-8").read()
ck("(e) the send path still wires unifiedSend -> runSend", bool(re.search(r"function unifiedSend\(slug\)\{.*?runSend\(", src, re.S)))
ck("(a) upCommit forgives transport ambiguity, fails only on relayreject",
   "__kind === \"relayreject\"" in src and "pending++" in src)
ck("(c) a taken slug no longer hard-fails with lib_err_exists (removed from the collect path)",
   "lib_err_exists" not in re.sub(r"lib_err_exists:\"[^\"]*\"", "", src))   # the i18n string may remain; the CODE reference is gone
ck("(d) the accordion collapse is a token-based grid animation (calm, reduced-motion guarded)",
   re.search(r"\.ow-acc-body\{[^}]*grid-template-rows:0fr[^}]*transition:grid-template-rows var\(--dur-1\) var\(--e-standard\)", src) is not None
   and "@media (prefers-reduced-motion:reduce){ .ow-acc-body{transition:none}" in src)
ck("(e) no em dash anywhere", "—" not in src)

# ---- browser harness ------------------------------------------------------------------------------
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True; threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright
def J(r,o,s=200): r.fulfill(status=s, headers={"content-type":"application/json"}, body=json.dumps(o))

class Cap:
    def __init__(self):
        self.relay_pub=[]      # (slug, html) for each page_publish hit
        self.opp_posts=[]      # opp POST/PATCH bodies (dicts)
        self.page_posts=[]     # console_pages POST slugs (pageUpsert)
        self.sends=[]          # send payloads
        self.mail=[]           # console_mail rows written

def make_wire(cap, existing_pages, relay_mode, suppressed):
    oppdata={}   # stateful: a POST/PATCH persists data so a later GET (oppReadData) sees the saved recipients
    def slug_of(url):
        m=re.search(r'slug=eq\.([^&]+)', url); return m.group(1) if m else ""
    def route_board(r):
        rows=[]
        for sl,d in oppdata.items():
            rows.append({"slug":sl,"business":(d.get("page_title") if isinstance(d,dict) else "") or sl,"stage":"live",
              "sent_count":0,"open_count":0,"replied":False,"idle_days":0,"last_activity_ts":"2026-02-01T00:00:00Z",
              "has_page":True,"has_email":True,"archived":False,"cycle":None})
        J(r, rows)
    def route_opps(r):
        req=r.request
        if req.method in ("POST","PATCH"):
            try: body=json.loads(req.post_data or "[]")
            except Exception: body=[]
            for row in (body if isinstance(body,list) else [body]):
                if isinstance(row,dict):
                    cap.opp_posts.append(row)
                    sl=row.get("slug") or slug_of(req.url)
                    if sl and "data" in row: oppdata[sl]=row.get("data")
            return r.fulfill(status=204, body="")
        sl=slug_of(req.url)
        return J(r, [{"slug":sl,"data":oppdata.get(sl,{}),"archived_at":None,"archived_from":None}])
    def route_pages(r):
        u=r.request.url
        if r.request.method in ("POST","PATCH"):
            try: rows=json.loads(r.request.post_data or "[]")
            except Exception: rows=[]
            for row in (rows if isinstance(rows,list) else [rows]):
                if isinstance(row,dict) and row.get("slug"): cap.page_posts.append(row.get("slug"))
            return r.fulfill(status=204, body="")
        if "select=html" in u: return J(r, [{"html":"<h1>x</h1>"}])
        if "select=title" in u: return J(r, [{"title":"T"}])
        # libFetchPages: select=slug,title,task,live_verified_at,up,updated_at  -> the EXISTING template set
        if "select=slug,title" in u or "select=slug%2Ctitle" in u: return J(r, existing_pages)
        return J(r, [{"slug":slug_of(u) or "x","live_verified_at":"2026-01-01T00:00:00Z"}])
    def route_mail(r):
        if r.request.method=="POST":
            try: rows=json.loads(r.request.post_data or "[]")
            except Exception: rows=[]
            for row in (rows if isinstance(rows,list) else [rows]):
                if isinstance(row,dict) and row.get("opp"): cap.mail.append(row)
            return r.fulfill(status=204, body="")
        return J(r, [])
    def route_relay(r):
        body=r.request.post_data or ""
        try: d=json.loads(body)
        except Exception: d={}
        if d.get("op")=="page_publish":
            slug=d.get("slug"); cap.relay_pub.append((slug, d.get("html","")))
            mode=relay_mode.get(slug,"ok")
            if mode=="reject":  return J(r, {"ok":False,"error":"github 422","relay_version":9})       # relay ran, refused -> genuine
            if mode=="http500": return J(r, {"ok":False,"error":"server"}, s=500)                       # relayhttp transport -> ambiguous
            return J(r, {"ok":True,"slug":slug,"relay_version":9})
        if d.get("to"): cap.sends.append(d)
        return J(r, {"ok":True,"id":"resend","relay_version":9,"delivered":True})
    def route_supp(r): J(r, [{"email":a} for a in suppressed])
    def wire(ctx):
        ctx.add_init_script("try{localStorage.setItem('console_sb_session', JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'op@thrive.test',uid:'u'}));}catch(e){}")
        ctx.route(re.compile(r"script\.google\.com/.*"), route_relay)
        ctx.route("**/rest/v1/console_board**", route_board)
        ctx.route("**/rest/v1/console_opps**", route_opps)
        ctx.route("**/rest/v1/console_pages**", route_pages)
        ctx.route("**/rest/v1/console_mail**", route_mail)
        ctx.route("**/rest/v1/console_suppressions**", route_supp)
        # the live-verify gate GETs the public /opp/<slug> URL; answer it live so an upload opp's send is not
        # blocked by the (non-existent in the test) static file.
        ctx.route(re.compile(r"console\.thriveiii\.com/opp/.*"), lambda r: r.fulfill(status=200, headers={"content-type":"text/html"}, body="<html>live</html>"))
        for tn in ["console_hits","console_inbound","console_profiles","console_profile_names","console_members","console_team_roster","console_admins","console_contacts"]:
            ctx.route(f"**/rest/v1/{tn}**", lambda r: J(r, []))
    return wire

def open_upload(b, wire):
    ctx=b.new_context(); wire(ctx); pg=ctx.new_page(); perr=[]; pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(500); pg.wait_for_selector(".lane", timeout=8000)
    pg.evaluate("()=>window.owNewMessage()"); pg.wait_for_selector("#owPickText", timeout=6000)
    pg.evaluate("()=>window.owSelectMode('upload')")
    pg.wait_for_selector("#owPageReview", state="attached", timeout=6000)
    pg.wait_for_timeout(500)   # let owPageLoadExisting settle __libExisting
    return ctx, pg, perr

ROW = lambda slug,email,html=None: {"slug":slug,"title":slug.replace("-"," ").title(),"task":"","email":email,
    "subject":"Hi "+slug,"body":"Body for "+slug,"page":{"html":html or ("<h1>"+slug+"</h1>")},"warnings":[]}

def commit_status(pg):
    return pg.evaluate("()=>{var e=document.getElementById('owCommitStatus');return e?{txt:e.textContent,cls:e.className}:{txt:'',cls:''};}")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # ===== (a) COMMIT TRUTH: ok + transport-ambiguous are never Failed; a genuine reject IS =====
    cap=Cap(); wire=make_wire(cap, [], {"denim-good":"ok","denim-net":"http500","denim-bad":"reject"}, [])
    ctx, pg, perr = open_upload(b, wire)
    slug=pg.evaluate("()=>window.__thriveOwState().slug")
    rows=[ROW("denim-good","a@x.example"), ROW("denim-net","b@x.example")]   # one clean, one transport-ambiguous
    pg.evaluate("(rows)=>window.__thriveSetUploadPlan(rows)", rows)
    pg.wait_for_selector(".ow-acc", timeout=4000)
    pg.evaluate("(s)=>window.__thriveOppCommitCampaign(s)", slug); pg.wait_for_timeout(900)
    st=commit_status(pg)
    ck("(a) a clean + a transport-ambiguous commit is NEVER a Failed line", "Fail" not in st["txt"] and "bad" not in st["cls"], st)
    ck("(a) the transport-ambiguous page reads 'going live shortly', not Failed", "going live" in st["txt"].lower(), st)
    ck("(b) neither page (both will deliver) is named as failed", "denim-net" not in st["txt"] and "Denim Net" not in st["txt"], st)
    pg.close(); ctx.close()

    # a GENUINE relay refusal (relayreject) on one of two pages still reports that page failed
    cap=Cap(); wire=make_wire(cap, [], {"clean-one":"ok","broken-two":"reject"}, [])
    ctx, pg, perr = open_upload(b, wire)
    slug=pg.evaluate("()=>window.__thriveOwState().slug")
    pg.evaluate("(rows)=>window.__thriveSetUploadPlan(rows)", [ROW("clean-one","a@x.example"), ROW("broken-two","b@x.example")])
    pg.wait_for_selector(".ow-acc", timeout=4000)
    pg.evaluate("(s)=>window.__thriveOppCommitCampaign(s)", slug); pg.wait_for_timeout(900)
    st=commit_status(pg)
    ck("(a) a GENUINE commit failure (relay refused) still reports failure, naming the row",
       ("of 2" in st["txt"] or "Failed" in st["txt"]) and ("Broken Two" in st["txt"] or "broken-two" in st["txt"]) and st["cls"].endswith("warn"), st)
    ck("(a) the SUCCEEDED page is not in the failed names", "Clean One" not in st["txt"].split("Failed",1)[-1], st)
    pg.close(); ctx.close()

    # ===== (b) a delivered SEND is never contradicted by a Failed campaign line =====
    # b1: a 2-page campaign where BOTH pages hit a transport error (their commits land; both will deliver) is
    # reported "going live shortly", never Failed, and neither page is named.
    cap=Cap(); wire=make_wire(cap, [], {"maple-goods":"http500","cedar-crafts":"http500"}, [])
    ctx, pg, perr = open_upload(b, wire)
    slug=pg.evaluate("()=>window.__thriveOwState().slug")
    pg.evaluate("(rows)=>window.__thriveSetUploadPlan(rows)", [ROW("maple-goods","a@x.example"), ROW("cedar-crafts","b@x.example")])
    pg.wait_for_selector(".ow-acc", timeout=4000)
    pg.evaluate("(s)=>window.__thriveOppCommitCampaign(s)", slug); pg.wait_for_timeout(900)
    st=commit_status(pg)
    ck("(b) a transport-ambiguous campaign is 'going live shortly', never Failed, no page named",
       "going live" in st["txt"].lower() and "bad" not in st["cls"] and "Maple" not in st["txt"] and "Cedar" not in st["txt"], st)
    pg.close(); ctx.close()
    # b2: the send path itself still delivers one-to-one (unifiedSend -> runSend) - a separate, intact path, so a
    # committed page's later send is never contradicted by the commit line.
    cap=Cap(); wire=make_wire(cap, [], {}, ["blocked@x.example"])
    ctx=b.new_context(); wire(ctx); pg=ctx.new_page(); perr=[]; pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(500); pg.wait_for_selector(".lane", timeout=8000)
    pg.evaluate("()=>window.owNewMessage()"); pg.wait_for_selector("#owPickText", timeout=6000)
    pg.click("#owPickText"); pg.wait_for_selector("#owModeA #edSubj", timeout=6000)
    pg.fill("#edSubj", "A partnership"); pg.fill("#edBody", "Hello, we would love to work with you.")
    pg.fill("#recIn", "keep@x.example, blocked@x.example"); pg.wait_for_timeout(200)
    pg.evaluate("()=>{var b=document.getElementById('recSave'); if(b) b.click();}"); pg.wait_for_timeout(300)
    pg.evaluate("()=>{var b=document.getElementById('nmSend'); if(b) b.click();}"); pg.wait_for_timeout(1400)
    ck("(b) the send path delivers one-to-one (one relay send past B2, one console_mail row) - never contradicted",
       len(cap.sends)==1 and len(cap.mail)==1 and cap.sends[0].get("to")=="keep@x.example", {"sends":[s.get('to') for s in cap.sends],"mail":len(cap.mail)})
    pg.close(); ctx.close()

    # ===== (c) SLUG COLLISION UPDATES the existing template (same slug, no "already taken") =====
    cap=Cap(); wire=make_wire(cap, [{"slug":"denim-that-ages-well","title":"Denim that ages well","task":"","live_verified_at":"2026-01-01T00:00:00Z"}], {}, [])
    ctx, pg, perr = open_upload(b, wire)
    slug=pg.evaluate("()=>window.__thriveOwState().slug")
    # a 2-page campaign (multi-page commit, no compose needed): row 0's slug ALREADY EXISTS, row 1 is new
    pg.evaluate("(rows)=>window.__thriveSetUploadPlan(rows)", [ROW("denim-that-ages-well","buyer@x.example"), ROW("fresh-linen","other@x.example")])
    pg.wait_for_selector(".ow-acc", timeout=4000); pg.wait_for_timeout(300)
    row0=pg.evaluate("""()=>{
        var err=document.getElementById('libErr-0'), badge=document.getElementById('owAccUpd-0'), asnew=document.getElementById('libAsNew-0'), si=document.getElementById('libSlug-0');
        return { err:err?err.textContent:'', errCls:err?err.className:'', badge:badge?badge.textContent:'', badgeHidden:badge?badge.hidden:true,
                 asnewHidden:asnew?asnew.hidden:true, asnewExists:!!asnew, slug:si?si.value:'' }; }""")
    ck("(c) an existing slug does NOT raise 'already taken' (no error class on the row)",
       ("already taken" not in row0["err"]) and ("bad" not in row0["errCls"]), row0)
    ck("(c) the row shows 'updates existing page: <title>' (visible summary badge)",
       (not row0["badgeHidden"]) and ("Denim that ages well" in row0["badge"]), row0)
    ck("(c) a one-tap 'publish as a new page' control is offered", row0["asnewExists"] and (not row0["asnewHidden"]), row0)
    ck("(c) the slug is KEPT (not auto-renamed to -2) so the existing page updates", row0["slug"]=="denim-that-ages-well", row0)
    # commit -> UPDATE: the SAME slug is published (a new version of the existing page), subject kept
    pg.evaluate("(s)=>window.__thriveOppCommitCampaign(s)", slug); pg.wait_for_timeout(900)
    pub_slugs=[s for (s,h) in cap.relay_pub]
    ck("(c) the commit UPDATES the existing page (same slug published, no -2)",
       "denim-that-ages-well" in pub_slugs and "denim-that-ages-well-2" not in pub_slugs, pub_slugs)
    ck("(c) the update re-writes the console_pages row (a new version of the template)",
       "denim-that-ages-well" in cap.page_posts, cap.page_posts)
    subj_ok = any((isinstance(o.get("data"),dict) and o["data"].get("outreach_subject")=="Hi denim-that-ages-well") for o in cap.opp_posts)
    ck("(c) the subject is kept through the update", subj_ok, cap.opp_posts)
    pg.close(); ctx.close()

    # the one-tap rename publishes as a NEW page instead (suffixed, no collision)
    cap=Cap(); wire=make_wire(cap, [{"slug":"linen-shirt","title":"Linen shirt","task":"","live_verified_at":"2026-01-01T00:00:00Z"}], {}, [])
    ctx, pg, perr = open_upload(b, wire)
    slug=pg.evaluate("()=>window.__thriveOwState().slug")
    pg.evaluate("(rows)=>window.__thriveSetUploadPlan(rows)", [ROW("linen-shirt","buyer@x.example")])
    pg.wait_for_selector(".ow-acc", timeout=4000); pg.wait_for_timeout(300)
    pg.evaluate("()=>{var b=document.getElementById('libAsNew-0'); if(b) b.click();}")
    pg.wait_for_timeout(200)
    after=pg.evaluate("""()=>{ var si=document.getElementById('libSlug-0'), badge=document.getElementById('owAccUpd-0');
        return { slug:si?si.value:'', badgeHidden:badge?badge.hidden:true }; }""")
    ck("(c) 'publish as a new page' suffixes to a free slug and drops the update badge",
       after["slug"]=="linen-shirt-2" and after["badgeHidden"], after)
    pg.close(); ctx.close()

    # ===== (d) COLLAPSED ACCORDION: collapsed by default, expands in place on click =====
    cap=Cap(); wire=make_wire(cap, [], {}, [])
    ctx, pg, perr = open_upload(b, wire)
    pg.evaluate("(rows)=>window.__thriveSetUploadPlan(rows)", [ROW("acorn-books","x@x.example"), ROW("basil-cafe","y@y.example")])
    pg.wait_for_selector(".ow-acc", timeout=4000); pg.wait_for_timeout(300)
    coll=pg.evaluate("""()=>{
        var accs=document.querySelectorAll('.ow-acc');
        var anyOpen=[].some.call(accs,function(a){return a.classList.contains('ow-acc-open');});
        var b0=document.getElementById('owAccBody-0');
        var tg0=document.querySelector('[data-acc-toggle=\\"0\\"]');
        return { n:accs.length, anyOpen:anyOpen, bodyH:b0?b0.getBoundingClientRect().height:-1,
                 aria:tg0?tg0.getAttribute('aria-expanded'):'', hasTitle:!!document.getElementById('libTitle-0'),
                 hasPreview:!!(b0&&b0.querySelector('iframe.lv-frame')), hasEmail:!!(b0&&/x@x\\.example/.test(b0.textContent||'')) }; }""")
    ck("(d) every review row is COLLAPSED by default (no open row, body height ~0)",
       coll["n"]==2 and (not coll["anyOpen"]) and coll["bodyH"]<2 and coll["aria"]=="false", coll)
    ck("(d) the collapsed body still HOLDS its details in the DOM (title, email, srcdoc preview)",
       coll["hasTitle"] and coll["hasPreview"] and coll["hasEmail"], coll)
    # expand the FIRST row by clicking its header
    pg.evaluate("()=>{var t=document.querySelectorAll('.ow-acc-toggle')[0]; if(t) t.click();}")
    pg.wait_for_timeout(400)
    exp=pg.evaluate("""()=>{
        var a0=document.querySelector('[data-acc=\\"0\\"]'), a1=document.querySelector('[data-acc=\\"1\\"]');
        var b0=document.getElementById('owAccBody-0'), b1=document.getElementById('owAccBody-1');
        var tg0=document.querySelector('[data-acc-toggle=\\"0\\"]');
        return { open0:a0.classList.contains('ow-acc-open'), open1:a1.classList.contains('ow-acc-open'),
                 h0:b0.getBoundingClientRect().height, h1:b1.getBoundingClientRect().height, aria0:tg0.getAttribute('aria-expanded') }; }""")
    ck("(d) clicking the header expands THAT row in place (body now has height, aria-expanded true)",
       exp["open0"] and exp["h0"]>40 and exp["aria0"]=="true", exp)
    ck("(d) rows toggle INDEPENDENTLY (the other row stays collapsed)",
       (not exp["open1"]) and exp["h1"]<2, exp)
    ck("(d) no uncaught error in the review", len(perr)==0, perr)
    pg.close(); ctx.close()

    # ===== (e) INVARIANTS: B2 strip at commit + {{ASSET_BASE}} resolved in the committed html =====
    cap=Cap(); wire=make_wire(cap, [], {}, ["blocked@x.example"])
    ctx, pg, perr = open_upload(b, wire)
    slug=pg.evaluate("()=>window.__thriveOwState().slug")
    ab_html = "<h1>maple</h1><img src=\"{{ASSET_BASE}}/opp/logo.png\">"
    rows=[ROW("maple-a","blocked@x.example", ab_html), ROW("maple-b","ok@x.example", ab_html)]
    pg.evaluate("(rows)=>window.__thriveSetUploadPlan(rows)", rows)
    pg.wait_for_selector(".ow-acc", timeout=4000)
    pg.evaluate("(s)=>window.__thriveOppCommitCampaign(s)", slug); pg.wait_for_timeout(900)
    supp_row = next((o for o in cap.opp_posts if isinstance(o.get("data"),dict) and o["data"].get("page_title")=="Maple A"), None)
    ck("(e) B2: a suppressed recipient is stripped from the committed opp",
       supp_row is not None and supp_row["data"].get("recipients")==[], supp_row)
    html_ok = all(("{{ASSET_BASE}}" not in h and "/storage/v1/object/public/assets" in h) for (s,h) in cap.relay_pub if h)
    ck("(e) {{ASSET_BASE}} is RESOLVED in every committed page html (never shipped raw)",
       len(cap.relay_pub)>=2 and html_ok, [(s, ("RAW" if "{{ASSET_BASE}}" in h else "resolved")) for (s,h) in cap.relay_pub])
    pg.close(); ctx.close()

    b.close()

print()
if fails:
    print("FAILED: " + str(len(fails)) + " check(s)")
    for f in fails: print("  - " + f)
    raise SystemExit(1)
print("ALL UPLOAD-TRUTH / SLUG-UPDATE / ACCORDION CHECKS PASS")
