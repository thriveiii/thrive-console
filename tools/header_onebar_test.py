"""HEADER ONE-BAR + ORGANIZED COUNTER CLUSTER (three refinements on the ported canon + aesthetics pass).

Presentation only; the send invariants are unchanged. Each check FAILS-WHEN-BROKEN.

Asserts:
  (a) ONE header bar, not two: exactly one .topbar container holds BOTH the brand and the nav cluster
      (#headNav), with ONE hairline (a single bottom border) and no leftover second-row .top slab. At
      desktop (1440) and iPad (1024) it is a single aligned row (brand + account share a line). At phone
      (390) it stays one .topbar with one hairline and produces NO horizontal overflow (no broken slab).
  (b) the brand mark is the PINNED OFFICIAL Thrive logo asset (a loaded <img> whose src is thrive-logo.png),
      not a hand-drawn shape, and it rotates (brandspin); the wordmark text is unchanged (THE CONSOLE).
  (c) the counter cluster is ONE aligned chip system grouped by meaning: a .stats with two role=group
      groups (pipeline states, status flags) sharing ONE chip shape (.stat, identical border-radius). At
      390 it wraps cleanly into a compact grid: every chip sits inside the viewport (no overflow, no clip)
      and the two groups stack onto their own rows.
  (d) every stat chip carries a permanent aria-label AND touch-reveal data (data-tip); a touch tap
      (pointerdown, pointerType touch) reveals the ONE tooltip component.
  (e) no em dash anywhere (incl. CSS comments / content:); itfGhroob 0 refs; no dusty rose.
  (f) Arabic is mirrored (dir=rtl) with the Alyamama family, letter-spacing:normal on the wordmark and the
      stat numbers, and Western numerals kept bidi-isolated (unicode-bidi:isolate on .pn).
  (g) the send path still wires unifiedSend -> runSend (presentation change touched nothing on the wire).

FAILS-WHEN-BROKEN: split the header into two rows / add a second hairline, revert the mark to a drawn
shape or drop the pinned asset, scatter the counters into mismatched pill shapes, let the cluster overflow
at 390, drop a stat's name or its touch reveal, reintroduce a rose / em dash / itfGhroob, break the Arabic
mirroring, or unwire the send path.
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

src = open(f"{ROOT}/library/board.html", encoding="utf-8").read()

# ---- static guards ---------------------------------------------------------------------------------
# ONE bar: the shell has a single <header class="topbar"> that carries the account/nav slot (#headNav),
# and the old two-row .top header is gone.
ck("(a) the shell has a single .topbar header", src.count('<header class="topbar">') == 1 and '<header class="top">' not in src)
ck("(a) the account/nav renders into the one bar (#headNav inside .topbar)", 'id="headNav"' in src and re.search(r'<header class="topbar">.*?id="headNav".*?</header>', src, re.S) is not None)
ck("(a) the one bar carries a single hairline (border-bottom on .topbar)", re.search(r"\.topbar\{[^}]*border-bottom:1px solid var\(--hair\)", src) is not None)
ck("(a) the old two-row .top selector is retired", re.search(r"(^|[^-])\.top\{", src) is None)
# the mark is the official asset
ck("(b) the mark is an <img class=\"brand-logo\"> pointing at the pinned thrive-logo.png", re.search(r'<img class="brand-logo" src="[^"]*thrive-logo\.png"', src) is not None)
ck("(b) the mark still rotates (brandspin) and reduced-motion stops it", "brandspin" in src and re.search(r"@media \(prefers-reduced-motion:reduce\)\{ \.brand-mark\{animation:none\}", src) is not None)
# stat cluster shape
ck("(c) the cluster is a single .stat chip system (one shape)", ".statbar" in src and re.search(r"\.stat\{[^}]*border-radius:var\(--r-pill\)", src) is not None)
ck("(c) the pipeline numbers stay bidi-isolated (Western numerals, Law 6.3)", re.search(r"\.stat \.pn\{[^}]*unicode-bidi:isolate", src) is not None)
# canon hygiene
ck("(e) no em dash anywhere", "—" not in src)
ck("(e) itfGhroob is fully removed (0 references)", "itfGhroob" not in src)
for lit in ["#C98B8B", "#9c5757", "#a85f5f"]:
    ck("(e) no dusty-rose literal: " + lit, lit not in src)
ck("(g) unifiedSend wires the one send path (calls runSend)", bool(re.search(r"function unifiedSend\(slug\)\{.*?runSend\(", src, re.S)))

# ---- browser -------------------------------------------------------------------------------------
# A board that lights up every flag: a live opp, a replied opp, a stalled opp (sent + idle>7), an archived opp.
BOARD = [
 {"slug":"a","business":"Alpha Co","stage":"live","sent_count":0,"open_count":0,"replied":False,"idle_days":0,"last_activity_ts":"2026-02-01T00:00:00Z","has_page":True,"has_email":True,"archived":False},
 {"slug":"b","business":"Beta Co","stage":"replied","sent_count":2,"open_count":1,"replied":True,"idle_days":0,"last_activity_ts":"2026-02-02T00:00:00Z","has_page":False,"has_email":True,"archived":False},
 {"slug":"c","business":"Gamma Co","stage":"sent","sent_count":1,"open_count":0,"replied":False,"idle_days":12,"last_activity_ts":"2026-01-05T00:00:00Z","has_page":False,"has_email":True,"archived":False},
 {"slug":"d","business":"Delta Co","stage":"opened","sent_count":1,"open_count":1,"replied":False,"idle_days":0,"last_activity_ts":"2026-01-06T00:00:00Z","has_page":False,"has_email":True,"archived":True},
]
# one unattributed inbound reply -> replies-waiting flag is non-empty
INBOUND = [{"kind":"human","opp":"","bounce":False,"ts":"2026-02-03T00:00:00Z","data":{"from":"lead@ext.test","subject":"hi","snippet":"hello"}}]
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
    ctx.route("**/rest/v1/console_inbound**", lambda r: J(r, INBOUND))
    for tn in ["console_mail","console_hits","console_suppressions","console_profiles","console_profile_names","console_members","console_team_roster","console_admins","console_contacts"]:
        ctx.route(f"**/rest/v1/{tn}**", lambda r: J(r,[]))

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # ============ DESKTOP 1440 ============
    ctx = b.new_context(viewport={"width":1440,"height":900}); wire(ctx)
    pg = ctx.new_page(); perr=[]; pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(700)
    pg.wait_for_selector(".lane", timeout=8000); pg.wait_for_timeout(300)

    # (a) exactly one bar, one hairline, brand + account cluster share a single row
    bar = pg.evaluate("""()=>{
        var bars=document.querySelectorAll('.topbar'), tb=bars[0];
        var brand=document.querySelector('.brand'), end=document.querySelector('.topbar-end');
        var op=document.getElementById('opChip');
        var cs=tb?getComputedStyle(tb):null;
        var br=brand?brand.getBoundingClientRect():null, opr=op?op.getBoundingClientRect():null;
        return { nbars:bars.length, nOldTop:document.querySelectorAll('.top').length,
                 endInBar:!!(tb&&end&&tb.contains(end)), opInBar:!!(tb&&op&&tb.contains(op)),
                 border:cs?cs.borderBottomWidth:'', hasTopBorder:cs?cs.borderTopWidth:'',
                 sameRow:!!(br&&opr)&&Math.abs(br.top-opr.top)<26 }; }""")
    ck("(a) exactly ONE .topbar and no legacy .top slab", bar["nbars"]==1 and bar["nOldTop"]==0, bar)
    ck("(a) the brand AND the account/nav cluster live in that one bar", bar["endInBar"] and bar["opInBar"], bar)
    ck("(a) the one bar carries a single hairline (bottom only)", bar["border"]!="0px" and bar["hasTopBorder"]=="0px", bar)
    ck("(a/desktop) the header is a single aligned row (brand + account on one line)", bar["sameRow"], bar)

    # (c) one aligned chip system, grouped by meaning, one shape
    cl = pg.evaluate("""()=>{
        var stats=document.querySelector('.stats');
        var groups=document.querySelectorAll('.stats .stat-group[role="group"]');
        var pipe=document.querySelectorAll('.stat-pipe .stat'), flags=document.querySelectorAll('.stat-flags .stat');
        var all=[].slice.call(document.querySelectorAll('.stat'));
        var radii={}; all.forEach(function(s){ radii[getComputedStyle(s).borderRadius]=1; });
        var named=all.every(function(s){ return (s.getAttribute('aria-label')||'').length>0 && (s.getAttribute('data-tip')||'').length>0; });
        return { hasStats:!!stats, nGroups:groups.length, nPipe:pipe.length, nFlags:flags.length,
                 nShapes:Object.keys(radii).length, nAll:all.length, named:named }; }""")
    ck("(c) the cluster is ONE .stats with two meaning groups", cl["hasStats"] and cl["nGroups"]==2, cl)
    ck("(c) the pipeline group holds the five states", cl["nPipe"]==5, cl)
    ck("(c) the status-flag group holds the flags (live + waiting + stalled + archived)", cl["nFlags"]==4, cl)
    ck("(c) every chip shares ONE shape (single border-radius across the cluster)", cl["nAll"]>=8 and cl["nShapes"]==1, cl)

    # (d) every stat chip is named AND touch-revealed
    ck("(d) every stat chip carries aria-label + data-tip (name reachable on SR/touch)", cl["named"], cl)
    touch = pg.evaluate("""()=>{ var el=document.querySelector('.stat'); if(!el) return null;
        var ev=new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch'}); el.dispatchEvent(ev);
        var tip=document.getElementById('thriveTip'); return tip ? { on:tip.classList.contains('on'), text:tip.textContent } : null; }""")
    ck("(d) a touch tap on a stat reveals the ONE tooltip (not hover-only)", bool(touch) and touch["on"] is True and len(touch["text"])>0, touch)

    ck("(g) no uncaught page error (desktop EN)", perr==[], perr)

    # ============ iPad 1024 ============
    ipg = ctx.new_page()
    ipg.set_viewport_size({"width":1024,"height":768})
    ipg.goto(f"{base}/library/board.html", wait_until="load"); ipg.wait_for_selector(".lane", timeout=8000); ipg.wait_for_timeout(300)
    ipad = ipg.evaluate("""()=>{ var brand=document.querySelector('.brand'), op=document.getElementById('opChip');
        var br=brand.getBoundingClientRect(), opr=op.getBoundingClientRect();
        return { nbars:document.querySelectorAll('.topbar').length, sameRow:Math.abs(br.top-opr.top)<26,
                 overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth }; }""")
    ck("(a/ipad) still ONE bar, one aligned row at 1024, no horizontal overflow", ipad["nbars"]==1 and ipad["sameRow"] and ipad["overflow"]<=1, ipad)
    ipg.close()

    ctx.close()

    # ============ PHONE 390 ============
    pctx = b.new_context(viewport={"width":390,"height":840}, is_mobile=True); wire(pctx)
    ppg = pctx.new_page(); pperr=[]; ppg.on("pageerror", lambda e: pperr.append(str(e)))
    ppg.goto(f"{base}/library/board.html", wait_until="load"); ppg.wait_for_selector(".lane", timeout=8000); ppg.wait_for_timeout(300)
    ph = ppg.evaluate("""()=>{
        var bars=document.querySelectorAll('.topbar'); var tb=bars[0];
        var cs=tb?getComputedStyle(tb):null;
        // one bar, one hairline still
        var oneHair = cs && cs.borderBottomWidth!=='0px' && cs.borderTopWidth==='0px';
        // no horizontal overflow of the document (the ONLY x-scroller is .lanes)
        var docOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        // every stat chip sits inside the viewport (no clip / no bleed past the right edge)
        var vw=window.innerWidth, bad=[];
        var stats=[].slice.call(document.querySelectorAll('.stat'));
        stats.forEach(function(s){ var r=s.getBoundingClientRect(); if(r.left< -0.5 || r.right>vw+0.5) bad.push([s.getAttribute('aria-label'), Math.round(r.left), Math.round(r.right)]); });
        // the .stats container itself does not overflow its own box (no clipped chips)
        var sc=document.querySelector('.stats'); var statsOverflow = sc ? (sc.scrollWidth - sc.clientWidth) : 0;
        // the two groups stack onto their own rows (compact grid), proving the phone reflow
        var pipe=document.querySelector('.stat-pipe'), flg=document.querySelector('.stat-flags');
        var stacked = pipe && flg ? (flg.getBoundingClientRect().top - pipe.getBoundingClientRect().top > 4) : false;
        return { nbars:bars.length, oneHair:oneHair, docOverflow:docOverflow, badChips:bad,
                 statsOverflow:statsOverflow, nStats:stats.length, stacked:stacked }; }""")
    ck("(a/phone) still ONE .topbar with ONE hairline at 390 (no broken second slab)", ph["nbars"]==1 and ph["oneHair"], ph)
    ck("(a/phone) no horizontal page overflow at 390 (header does not force a widen)", ph["docOverflow"]<=1, ph)
    ck("(c/phone) every stat chip stays inside the 390 viewport (no overflow / no clip)", ph["nStats"]>=8 and ph["badChips"]==[] and ph["statsOverflow"]<=1, ph)
    ck("(c/phone) the cluster reflows: the two groups stack onto their own rows", ph["stacked"], ph)
    ck("(g) no uncaught page error (phone)", pperr==[], pperr)
    pctx.close()

    # ============ ARABIC (mirrored) ============
    actx = b.new_context(viewport={"width":1440,"height":900}); wire(actx, ar=True)
    apg = actx.new_page(); aperr=[]; apg.on("pageerror", lambda e: aperr.append(str(e)))
    apg.goto(f"{base}/library/board.html", wait_until="load"); apg.wait_for_selector(".lane", timeout=8000); apg.wait_for_timeout(400)
    ab = apg.evaluate("""()=>{
        var w=document.getElementById('brandWord'); var pn=document.querySelector('.stat .pn');
        var cw=w?getComputedStyle(w):null, cpn=pn?getComputedStyle(pn):null, cb=getComputedStyle(document.body);
        var brand=document.querySelector('.brand'), end=document.querySelector('.topbar-end');
        var br=brand.getBoundingClientRect(), er=end.getBoundingClientRect();
        return { dir:document.documentElement.getAttribute('dir'), word:w?w.textContent:'',
                 wls:cw?cw.letterSpacing:'', wtt:cw?cw.textTransform:'',
                 pnBidi:cpn?(cpn.unicodeBidi||''):'', font:cb.fontFamily||'',
                 brandLeads:br.left > er.left }; }""")
    ck("(f) Arabic is mirrored (dir=rtl)", ab["dir"]=="rtl", ab)
    ck("(f) the Arabic wordmark is غرفة التحكم", ab["word"]=="غرفة التحكم", ab)
    ck("(f) the wordmark carries letter-spacing:normal and no uppercase in AR", ab["wls"] in ("normal","0px") and ab["wtt"]=="none", ab)
    ck("(f) the Alyamama family is bound in AR", "Alyamama" in ab["font"], ab)
    ck("(f) the stat numbers stay bidi-isolated (Western numerals)", "isolate" in ab["pnBidi"], ab)
    ck("(f) the brand leads on the right in AR (mark before the nav cluster)", ab["brandLeads"], ab)
    ck("(g) no uncaught page error (AR)", aperr==[], aperr)
    actx.close()

    b.close()

print()
if fails:
    print("FAILED: " + str(len(fails)) + " check(s)")
    for f in fails: print("  - " + f)
    raise SystemExit(1)
print("ALL HEADER ONE-BAR + CLUSTER CHECKS PASS")
