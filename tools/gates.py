"""Ten review gates. Run them all: python3 tools/gates.py

A gate is not a checklist item. It is a question the console has to answer in a browser, with
real data, in both languages, at the widths people actually hold. Each one exists because
something got through: the numbered notes say what.

  1  Boot          every page and every view starts, with nothing blank and nothing thrown
  2  Doors         every link leads somewhere real, and its parameters arrive
  3  Round trip    what the window borrows it gives back; a view re-entered is a view reloaded
  4  Truth         lanes, pills and tables report the same facts, and only facts with evidence,
                and two devices sharing one store are the same console, removals included
  5  Bilingual     both languages complete, no key on screen, plural forms correct
  6  Typography    one Latin face and one Arabic face, everywhere, measured not assumed
  7  Layout        nothing scrolls sideways, everything a finger uses clears 40px
  8  Forms         every control is labelled, reachable, and does what it says
  9  Resilience    relay down, relay slow, no data: a designed state, never a blank or a spinner
 10  Build         the gate passes, the shell is regenerated from source, the offline file works

Gate 8 ends by sending a real message through a relay that answers and remembers what it was
handed, then watches the opportunity move from Ready to Sent. Gate 9 takes that same session,
exports a backup, wipes the device, and restores it. Those two are the loops the console exists
for, and neither had ever been proven end to end.
"""
import threading, http.server, socketserver, functools, os, sys, json, subprocess, re

os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
EP = f"{base}/exec"

from playwright.sync_api import sync_playwright

results = {}          # gate number -> [(name, ok)]
GATE8_CTX = []        # the session that sent, handed to gate 9 so the backup has real content
current = [0]

def gate(n, title):
    current[0] = n
    results.setdefault(n, {"title": title, "checks": []})

def ck(name, ok, detail=None):
    ok = bool(ok)
    results[current[0]]["checks"].append((name, ok))
    print(("  PASS " if ok else "  FAIL ") + name)
    if not ok and detail is not None:
        print("        " + str(detail)[:400])

# ---------------------------------------------------------------- fixture data
HITS = [
    {"type": "open", "slug": "wise-butterfly", "ts": "2026-07-30T11:00:00Z", "vid": "v1"},
    {"type": "open", "slug": "wise-butterfly", "ts": "2026-07-31T09:00:00Z", "vid": "v2"},
    {"type": "open", "slug": "wise-butterfly", "ts": "2026-08-01T09:00:00Z", "vid": "v3"},
    {"type": "open", "slug": "ludic-lillian",  "ts": "2026-07-29T10:00:00Z", "vid": "v4"},
    {"type": "dwell", "slug": "ludic-lillian", "ts": "2026-07-29T10:02:00Z", "vid": "v4", "ms": 74000},
    {"type": "open", "slug": "thrive-july",    "ts": "2026-08-01T10:00:00Z", "vid": "v5"},
]
MAIL = [
    {"mid": "m1", "ts": "2026-07-28T12:00:00Z", "opp": "ludic-lillian", "to": "hello@ludic.example",
     "toName": "Lillian", "subject": "Ludic Lillian x Thrive", "templateId": "opp-intro",
     "templateName": "Send an opportunity page", "status": "sent", "direction": "out"},
    {"mid": "m2", "ts": "2026-07-31T12:00:00Z", "opp": "thrive-july", "to": "team@thrive.example",
     "toName": "July", "subject": "thrive-july", "templateId": "opp-intro",
     "templateName": "Send an opportunity page", "status": "sent", "direction": "out"},
]
VIEWS = ["board", "home", "library", "editor", "compose", "templates", "activity", "settings"]
PAGES = ["index", "board", "library", "editor", "compose", "templates", "activity", "settings"]


def relay_ok(route):
    if route.request.method == "GET":
        return route.fulfill(status=200, body="Thrive relay v4 (email + sync + analytics) is running.")
    d = json.loads(route.request.post_data or "{}")
    if d.get("op") == "state_get":
        return route.fulfill(status=200, body=json.dumps({"ok": True, "data": None}))
    if d.get("op") == "hits_get":
        return route.fulfill(status=200, body=json.dumps({"ok": True, "events": HITS}))
    return route.fulfill(status=200, body=json.dumps({"ok": True, "id": "x"}))


def relay_down(route):
    return route.abort()


SENT = []


def relay_sends(route):
    """A relay that answers, and remembers what it was asked to send."""
    if route.request.method == "GET":
        return route.fulfill(status=200, body="Thrive relay v4 (email + sync + analytics) is running.")
    d = json.loads(route.request.post_data or "{}")
    if d.get("op") == "state_get":
        return route.fulfill(status=200, body=json.dumps({"ok": True, "data": None}))
    if d.get("op") == "hits_get":
        return route.fulfill(status=200, body=json.dumps({"ok": True, "events": []}))
    if d.get("op"):
        return route.fulfill(status=200, body=json.dumps({"ok": True}))
    SENT.append(d)
    return route.fulfill(status=200, body=json.dumps({"ok": True, "id": "re_test_1"}))


def relay_old(route):
    # a relay serving the ORIGINAL script: it only knows how to send mail
    if route.request.method == "GET":
        return route.fulfill(status=200, body="Thrive relay is running.")
    return route.fulfill(status=200, body=json.dumps({"ok": False, "error": 'missing "to"'}))


def session(b, lang="en", width=1280, relay=relay_ok, seed=True, page="console.html"):
    ctx = b.new_context(viewport={"width": width, "height": 900},
                        has_touch=(width <= 430), is_mobile=(width <= 430))
    ctx.route("**/exec", relay)
    ctx.route("**/library/sync.json",
              lambda r: r.fulfill(status=200, body=json.dumps({"ep": EP, "up": 1})))
    ctx.route("https://api.github.com/**", lambda r: r.abort())
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append("console: " + m.text)
          if (m.type == "error" and "Failed to load resource" not in m.text) else None)
    pg.goto(f"{base}/library/{page}")
    pg.wait_for_timeout(400)
    pg.evaluate("l=>localStorage.setItem('thrive_lang',l)", lang)
    if pg.query_selector("#thriveGate"):
        pg.fill("#gateInput", "ConThrive2030")
        pg.click(".gate-btn")
        pg.wait_for_timeout(1300)
    if seed:
        pg.evaluate("(d)=>{localStorage.setItem('thrive_hits_remote_v1',JSON.stringify(d.h));"
                    "localStorage.setItem('thrive_mail_v1',JSON.stringify(d.m));}",
                    {"h": HITS, "m": MAIL})
        pg.reload()
        pg.wait_for_timeout(2600)
    return ctx, pg, errs


def centred(pg):
    """Equal margins on all four sides, measured. Under 720 the same component is a bottom
    sheet, which is centred on the inline axis and deliberately not on the block axis."""
    return pg.evaluate("""()=>{const m=document.getElementById('modal');
      if(!m||m.hidden) return false;
      const r=m.getBoundingClientRect(), w=innerWidth, h=innerHeight;
      const near=(a,b,tol)=>Math.abs(a-b)<=tol;
      if(!near(r.left, w-r.right, 2)) return false;
      if(w<=720) return true;
      return near(r.top, h-r.bottom, 2);}""")


def visible(pg, vid):
    return pg.evaluate("""(id)=>{const e=document.getElementById('view-'+id)||document.querySelector('main.wrap');
      if(!e) return {miss:true};
      const r=e.getBoundingClientRect();
      return {visible:!!(e.offsetParent!==null&&r.width>1&&r.height>1),
              text:(e.innerText||'').trim().length,
              controls:e.querySelectorAll('input,select,textarea,button,a').length};}""", vid)


# ================================================================ 1  BOOT
def gate1(b):
    gate(1, "Boot")
    for lang in ("en", "ar"):
        ctx, pg, errs = session(b, lang)
        for v in VIEWS:
            pg.evaluate("v=>location.hash='#'+v", v)
            pg.wait_for_timeout(1200)
            st = visible(pg, v)
            ck(f"{lang}: the {v} view starts and shows something",
               st.get("visible") and st["text"] > 40, st)
        ck(f"{lang}: nothing threw while walking every view", not errs, errs[:4])
        ctx.close()
    # the single pages still stand on their own, which is what makes the shell replaceable
    ctx = b.new_context(viewport={"width": 1280, "height": 900})
    ctx.route("**/exec", relay_ok)
    ctx.route("https://api.github.com/**", lambda r: r.abort())
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    for name in PAGES:
        pg.goto(f"{base}/library/{name}.html")
        pg.wait_for_timeout(300)
        if pg.query_selector("#thriveGate"):
            pg.fill("#gateInput", "ConThrive2030")
            pg.click(".gate-btn")
            pg.wait_for_timeout(1400)
        st = visible(pg, "none")
        ck(f"the standalone page {name}.html still stands on its own",
           st.get("visible") and st["text"] > 40, st)
    ck("no page threw on its own", not errs, errs[:4])
    ctx.close()


# ================================================================ 2  DOORS
def gate2(b):
    gate(2, "Doors")
    for lang, w in (("en", 1280), ("ar", 390)):
        ctx, pg, errs = session(b, lang, w)
        tag = f"{lang}/{w}"

        # no internal link may leave the shell
        out = pg.evaluate("""()=>[...document.querySelectorAll('a[href]')]
            .map(a=>a.getAttribute('href'))
            .filter(h=>/\\.html($|[?#])/.test(h) && !/^https?:/.test(h))""")
        ck(f"{tag}: no link in the shell walks out to a second document", not out, out)

        # the board's own doors
        pg.evaluate("()=>location.hash='#board'")
        pg.wait_for_timeout(1200)
        links = pg.evaluate("""()=>[...document.querySelectorAll('#view-board a[href^="#"]')]
            .map(a=>({h:a.getAttribute('href'), t:a.textContent.trim()}))""")
        ck(f"{tag}: the board offers its four doors", len(links) >= 4, links)
        for l in links:
            pg.evaluate("()=>location.hash='#board'")
            pg.wait_for_timeout(600)
            pg.click(f"#view-board a[href='{l['h']}']")
            pg.wait_for_timeout(1500)
            vid = l["h"].lstrip("#").split("?")[0]
            st = visible(pg, vid)
            ck(f"{tag}: '{l['t']}' lands on a real page",
               st.get("visible") and st["text"] > 40 and st["controls"] > 2, st)

        # parameters, which is where the doors were actually broken
        cases = [
            ("#library", "#compose?slug=", None, None,
             "the composer knows which opportunity it is"),
            ("#library", "#editor?slug=", "()=>(document.getElementById('f_biz')||{}).value||''",
             lambda v: len(v) > 1, "the editor loads the opportunity you tapped"),
            ("#templates", "#editor?t=", "()=>(document.getElementById('f_template')||{}).value||''",
             lambda v: len(v) > 1, "the editor opens on the page template you chose"),
            ("#templates", "#compose?etpl=", "()=>(document.getElementById('etpl')||{}).value||''",
             lambda v: len(v) > 1, "the composer opens on the message template you chose"),
        ]
        for start, prefix, probe, good, what in cases:
            pg.evaluate("h=>location.hash=h", start)
            pg.wait_for_timeout(1800)
            if start == "#templates" and "etpl" in prefix:
                pg.click("#tplTabs [data-tpltab='mail']")
                pg.wait_for_timeout(600)
            href = pg.evaluate("""(p)=>{const a=[...document.querySelectorAll('a[href]')]
                .find(x=>(x.getAttribute('href')||'').indexOf(p)===0);return a?a.getAttribute('href'):'';}""", prefix)
            ck(f"{tag}: a link exists for {prefix}", bool(href), href)
            if not href:
                continue
            pg.click(f"a[href='{href}']")
            pg.wait_for_timeout(2200)
            if probe is None:
                # The composer prints no slug until there is a message, so ask it the way a
                # person would: pick a starting message and see whose page it points at.
                want = href.split("slug=")[1]
                pg.click("#etplQuick [data-quick]")
                pg.wait_for_timeout(1000)
                val = pg.evaluate("()=>document.getElementById('ebody').innerHTML")
                ck(f"{tag}: {what}", want in val, val[:200])
            else:
                val = pg.evaluate(probe)
                ck(f"{tag}: {what}", good(val), repr(val)[:200])

        # the board chips filter rather than leave
        pg.evaluate("()=>location.hash='#board'")
        pg.wait_for_timeout(1400)
        chips = pg.evaluate("()=>[...document.querySelectorAll('#boardChips [data-chip]')].map(c=>c.dataset.chip)")
        for c in chips:
            pg.evaluate("()=>location.hash='#board'")
            pg.wait_for_timeout(700)
            pg.click(f"#boardChips [data-chip='{c}']")
            pg.wait_for_timeout(1600)
            here = pg.evaluate("()=>location.pathname")
            ck(f"{tag}: the {c} chip stays inside the console", here.endswith("console.html"), here)

        ck(f"{tag}: nothing threw while opening every door", not errs, errs[:4])
        ctx.close()


# ================================================================ 3  ROUND TRIP
def gate3(b):
    gate(3, "Round trip")
    ctx, pg, errs = session(b, "en", 1280)
    pg.evaluate("()=>location.hash='#board'")
    pg.wait_for_timeout(1400)

    tok = pg.query_selector(".tok[data-slug]")
    ck("there is a card to open", tok is not None)
    if tok:
        tok.click()
        pg.wait_for_timeout(1500)
        ck("the window opens over the board", pg.eval_on_selector("#modal", "e=>!e.hidden"))
        ck("it opens on the overview, which is the question the card asked",
           pg.eval_on_selector("#modalOverview", "e=>!e.hidden && e.textContent.trim().length>20"))
        # Centred with equal margins, measured. The panel this replaced satisfied every other
        # check in this file while sitting hard against the inline-end edge.
        ck("it is centred with equal margins on both sides", centred(pg))
        ck("it never exceeds 88vh", pg.evaluate(
            "()=>document.getElementById('modal').getBoundingClientRect().height <= innerHeight*0.881"))
        ck("only its body scrolls, the head and the tabs stay put", pg.evaluate(
            """()=>{const b=document.getElementById('modalBody');
                 const h=document.querySelector('.modal-head'), t=document.getElementById('modalTabs');
                 const sc=e=>getComputedStyle(e).overflowY;
                 return sc(b)==='auto' && sc(h)!=='auto' && sc(t)!=='auto';}"""))
        ck("all five tabs are present",
           pg.eval_on_selector_all("#modalTabs .modal-tab", "e=>e.map(x=>x.dataset.tab).join(',')")
           == "overview,text,page,outreach,history")
        pg.click("#modalTabs [data-tab='text']")
        pg.wait_for_timeout(700)
        # Scoped to the empty state, which is what the rule is about: one icon, one sentence,
        # no action INSIDE it. The panel around it may carry other sections, and since WO-012
        # phase 1 it does. Querying the whole panel was measuring the wrong element, so this
        # is now stricter on the right one rather than looser on the wrong one.
        ck("the text tab shows its empty state, one icon and one sentence and no action",
           pg.eval_on_selector("#modalText .mw-empty",
             "e=>e.querySelectorAll('svg').length===1 && e.querySelectorAll('p').length===1 "
             "&& e.querySelectorAll('button,a,input,textarea,select').length===0"))
        pg.click("#modalTabs [data-tab='outreach']")
        pg.wait_for_timeout(1500)
        ck("the outreach tab is holding the composer itself, not a copy",
           pg.evaluate("()=>!!document.querySelector('#modalHost #view-compose')"))
        ck("and there is exactly one of every composer field in the document",
           pg.evaluate("()=>['eto','esubject','ebody','eSend'].every(i=>document.querySelectorAll('#'+i).length===1)"))
        pg.click("#modalTabs [data-tab='page']")
        pg.wait_for_timeout(1500)
        ck("the page tab is holding the editor itself, not a copy",
           pg.evaluate("()=>!!document.querySelector('#modalHost #view-editor')"))
        ck("and there is exactly one of every editor field in the document",
           pg.evaluate("()=>['f_biz','f_slug','publishBtn'].every(i=>document.querySelectorAll('#'+i).length===1)"))
        # Re-entering a tab must not wire an already-wired DOM. That doubles every listener on
        # it, and on a composer a doubled listener means one click on Send sending twice.
        ctx.grant_permissions(["clipboard-read", "clipboard-write"])
        pg.click("#modalTabs [data-tab='outreach']")
        pg.wait_for_timeout(1500)
        before = pg.evaluate("()=>getMailLog().length")
        pg.click("#eCopy")
        pg.wait_for_timeout(1100)
        ck("one click writes one ledger row, after any number of tab changes",
           pg.evaluate("()=>getMailLog().length") - before == 1)
        ck("the body cannot scroll while the window is open",
           pg.evaluate("()=>getComputedStyle(document.body).position==='fixed'"))
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(900)
        ck("closing it gives the composer back to the document",
           pg.evaluate("()=>!document.querySelector('#modalHost #view-compose')"))
        ck("and the body scrolls again",
           pg.evaluate("()=>getComputedStyle(document.body).position!=='fixed'"))
        for v in ("compose", "editor"):
            pg.evaluate("x=>location.hash='#'+x", v)
            pg.wait_for_timeout(1600)
            st = visible(pg, v)
            ck(f"and #{v} opens on a real page afterwards, not a blank one",
               st.get("visible") and st["text"] > 40, st)

        # navigating away while it is open must close it and hand the view back
        pg.evaluate("()=>location.hash='#board'")
        pg.wait_for_timeout(1200)
        pg.query_selector(".tok[data-slug]").click()
        pg.wait_for_timeout(1400)
        pg.click("#modalTabs [data-tab='outreach']")
        pg.wait_for_timeout(1300)
        pg.evaluate("()=>location.hash='#library'")
        pg.wait_for_timeout(1500)
        ck("navigating away closes the window", pg.eval_on_selector("#modal", "e=>e.hidden") is True)
        ck("and nothing borrowed is left inside it",
           pg.eval_on_selector("#modalHost", "e=>e.children.length") == 0)

    # a view re-entered with different parameters is a view reloaded, not a stale one
    def composed_for(slug):
        pg.evaluate("h=>location.hash=h", "#compose?slug=" + slug)
        pg.wait_for_timeout(2100)
        pg.click("#etplQuick [data-quick]")
        pg.wait_for_timeout(900)
        return pg.evaluate("()=>document.getElementById('ebody').innerHTML")
    first = composed_for("ludic-lillian")
    second = composed_for("wise-butterfly")
    ck("the same view asked for twice with different parameters reads them both",
       "ludic-lillian" in first and "wise-butterfly" in second, [first[:120], second[:120]])

    # and it must not have collected a second copy of its own listeners
    dupes = pg.evaluate("""()=>{const ids={};let d=0;
      document.querySelectorAll('[id]').forEach(e=>{ if(ids[e.id]) d++; ids[e.id]=1; });return d;}""")
    ck("no element id exists twice in the document", dupes == 0, dupes)
    ck("nothing threw", not errs, errs[:4])
    ctx.close()


# ================================================================ 4  TRUTH
def gate4(b):
    gate(4, "Truth")
    r = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "lane-truth.py")],
                       capture_output=True, text=True, timeout=900)
    bad = [l for l in r.stdout.splitlines() if l.startswith("FAIL")]
    ck("the lane rule holds against the four real records (tools/lane-truth.py)",
       r.returncode == 0, "\n".join(bad[:6]) or r.stderr[-400:])

    ctx, pg, errs = session(b, "en", 1280)
    # the board, the library and the insights tables have to be reading one set of facts
    pg.evaluate("()=>location.hash='#board'")
    pg.wait_for_timeout(1600)
    lanes = pg.evaluate("""()=>{const o={};document.querySelectorAll('[data-count]')
        .forEach(e=>o[e.dataset.count]=parseInt(e.textContent,10));return o}""")
    pg.evaluate("()=>location.hash='#library'")
    pg.wait_for_timeout(2000)
    pills = pg.evaluate("""()=>{const o={};document.querySelectorAll('[data-stage-f]')
        .forEach(e=>o[e.dataset.stageF]=parseInt(e.querySelector('b').textContent,10));return o}""")
    for k in ("draft", "live", "sent", "opened", "replied"):
        ck(f"the {k} lane and the {k} pill agree", lanes.get(k) == pills.get(k),
           f"lane {lanes.get(k)} pill {pills.get(k)}")
    pg.evaluate("()=>location.hash='#home'")
    pg.wait_for_timeout(2600)
    row = pg.evaluate("""()=>{const r=[...document.querySelectorAll('#homeCampaigns tbody tr')]
        .find(t=>/Wise Butterfly/.test(t.innerText)); if(!r) return null;
        return [...r.children].map(e=>e.innerText.trim());}""")
    ck("a page read but never written to reports views and no opens",
       row and row[1] == "0" and row[2] == "3" and row[3] == "0", row)
    # A conversation filed against the wrong opportunity is correctable, because the console
    # cannot know which one it belonged to and must not guess.
    pg.evaluate("()=>location.hash='#activity'")
    pg.wait_for_timeout(2400)
    sel = pg.query_selector(".th-opp")
    ck("a conversation can be moved to the opportunity it is really about", sel is not None)
    ck("and the control is on the row, not hidden inside it",
       pg.evaluate("""()=>{const s=document.querySelector('.th-opp');
           return !!(s && s.closest('summary'));}"""))
    if sel:
        opts = pg.evaluate("()=>[...document.querySelector('.th-opp').options].map(o=>o.value)")
        ck("and every live opportunity is offered", len(opts) >= 2, opts)
        target = [o for o in opts if o and o != "ludic-lillian"]
        if target:
            pg.select_option(".th-opp", target[0])
            pg.wait_for_timeout(1400)
            moved = pg.evaluate("(s)=>getMailLog().some(m=>m.opp===s)", target[0])
            ck("moving it rewrites every message in that conversation", moved, target[0])

    ck("nothing threw", not errs, errs[:4])
    ctx.close()

    # Two devices, one store. A console that only ever unions is an archive that argues with
    # you: the deleted opportunity comes back, and the two devices are never the same console.
    r = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "mirror.py")],
                       capture_output=True, text=True, timeout=900)
    bad = [l for l in r.stdout.splitlines() if l.startswith("FAIL")]
    ck("two devices sharing one store hold the same console (tools/mirror.py)",
       r.returncode == 0, "\n".join(bad[:8]) or r.stderr[-400:])


# ================================================================ 5  BILINGUAL
def gate5(b):
    gate(5, "Bilingual")
    r = subprocess.run(["node", os.path.join(ROOT, "tools", "verify.js")],
                       capture_output=True, text=True, timeout=300)
    ck("EN/AR parity and the house copy rules (tools/verify.js)", r.returncode == 0,
       r.stdout[-600:])
    for lang in ("en", "ar"):
        ctx, pg, errs = session(b, lang)
        for v in VIEWS:
            pg.evaluate("x=>location.hash='#'+x", v)
            pg.wait_for_timeout(1100)
            leak = pg.evaluate("""()=>{const m=(document.body.innerText||'')
                .match(/\\b(nav_|board_|lane_|tok_|vd_|dw_|conn_|home_|sy_|cmp_|tpl_|et_|set_|gh_|ins_|stage_|col_|story_|tip_)[a-z0-9_]+/g);
                return m?[...new Set(m)]:[];}""")
            ck(f"{lang}: no untranslated key is on screen in {v}", not leak, leak[:6])
        # a number-bearing sentence has to inflect, which is the whole reason for the form objects
        if lang == "ar":
            for key in ("vd_opened", "story_sent", "story_opens", "act_s_replies",
                        "act_s_published", "home_data_self", "export_local_note"):
                forms = pg.evaluate("""(k)=>{const out={};
                    [1,2,3,11,100].forEach(n=>out[n]=boardText('ar',k,n));return out;}""", key)
                ck(f"ar: {key} inflects at 1, 2, 3, 11 and 100",
                   len(set(forms.values())) >= 5, forms)
            # and no sentence on screen may leave a raw placeholder behind
            pg.evaluate("()=>location.hash='#home'")
            pg.wait_for_timeout(2600)
            raw = pg.evaluate("""()=>{const t=document.getElementById('view-home').innerText;
                const m=t.match(/\{[a-z]+\}/g); return m?[...new Set(m)]:[];}""")
            ck("ar: no placeholder is left unfilled on Insights", not raw, raw)
        ck(f"{lang}: nothing threw", not errs, errs[:4])
        ctx.close()


# ================================================================ 6  TYPOGRAPHY
def gate6(b):
    gate(6, "Typography")
    # The rendered face, asked of the engine rather than inferred from the stack. A Latin word
    # on an Arabic screen was being drawn in Alyamama's own serif Latin, and no computed style
    # would have said so.
    for lang in ("ar", "en"):
        ctx, pg, errs = session(b, lang)
        cdp = ctx.new_cdp_session(pg)
        cdp.send("DOM.enable")
        cdp.send("CSS.enable")

        def faces(selector):
            doc = cdp.send("DOM.getDocument")
            nid = cdp.send("DOM.querySelector", {"nodeId": doc["root"]["nodeId"], "selector": selector})["nodeId"]
            if not nid:
                return []
            out = cdp.send("CSS.getPlatformFontsForNode", {"nodeId": nid})["fonts"]
            # the engine names the variant it drew: "Lato Black" is Lato at 900
            return sorted(set(f["familyName"].split(" ")[0] for f in out if f.get("glyphCount", 0) > 0))

        pg.evaluate("()=>location.hash='#board'")
        pg.wait_for_timeout(1600)
        for sel, what in ((".tok-name", "a business name on the board"),
                          (".lane-count", "a lane count"),
                          (".verdict", "the verdict sentence")):
            f = faces(sel)
            ck(f"{lang}: {what} uses only the two console faces",
               f and all(x in ("Lato", "Alyamama") for x in f), f)
        pg.evaluate("()=>location.hash='#library'")
        pg.wait_for_timeout(2000)
        f = faces(".card .biz")
        ck(f"{lang}: a business name on its card uses only the two console faces",
           f and all(x in ("Lato", "Alyamama") for x in f), f)

        if lang == "ar":
            pg.evaluate("()=>location.hash='#board'")
            pg.wait_for_timeout(1400)
            ck("ar: a Latin name keeps its own reading order",
               pg.evaluate("""()=>{const t=[...document.querySelectorAll('.tok-name')]
                   .find(e=>/^\\s*2 Faces/.test(e.textContent));
                   return !t || getComputedStyle(t).unicodeBidi==='plaintext';}"""))
            ck("ar: no letter-spacing reaches Arabic text",
               pg.evaluate("""()=>[...document.querySelectorAll('.lane-title,.verdict,.tok-name,.chip,.nav a,.title')]
                 .filter(e=>/[\\u0600-\\u06FF]/.test(e.textContent))
                 .every(e=>{const ls=getComputedStyle(e).letterSpacing;return ls==='normal'||ls==='0px';})"""))
            ck("ar: the document reads right to left",
               pg.evaluate("()=>document.documentElement.dir") == "rtl")
        ck(f"{lang}: nothing threw", not errs, errs[:4])
        ctx.close()


# ================================================================ 7  LAYOUT
def gate7(b):
    gate(7, "Layout")
    for lang in ("en", "ar"):
        for w in (320, 390, 430, 768, 1024, 1440):
            ctx, pg, errs = session(b, lang, w)
            for v in ("board", "home", "library", "compose", "templates", "settings"):
                pg.evaluate("x=>location.hash='#'+x", v)
                pg.wait_for_timeout(1000)
                ck(f"{lang}/{w}: {v} never scrolls sideways",
                   pg.evaluate("()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1"),
                   pg.evaluate("()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]"))
            if w <= 430:
                pg.evaluate("()=>location.hash='#board'")
                pg.wait_for_timeout(1200)
                small = pg.eval_on_selector_all(
                    ".nav a,.btn,.tok,.chip,.langbtn,.seg button",
                    "els=>els.filter(e=>e.offsetParent&&e.getBoundingClientRect().height<40)"
                    ".map(e=>(e.innerText||e.className).slice(0,24))")
                ck(f"{lang}/{w}: every control a finger uses clears 40px", not small, small)
            if w >= 390:
                pg.evaluate("()=>location.hash='#board'")
                pg.wait_for_timeout(1000)
                rows = pg.evaluate("""()=>{const n=document.querySelector('.nav');
                    const kids=[...n.children].map(e=>e.getBoundingClientRect());
                    const tall=Math.max.apply(null,kids.map(r=>r.height));
                    return Math.round(n.getBoundingClientRect().height/tall*10)/10;}""")
                ck(f"{lang}/{w}: the bar stays one row", rows <= 1.2, rows)
                heights = pg.evaluate("""()=>[...document.querySelector('.nav').children]
                    .map(e=>Math.round(e.getBoundingClientRect().height))""")
                ck(f"{lang}/{w}: every control in the bar is the same height",
                   len(set(heights)) == 1, heights)
            ctx.close()


# ================================================================ 8  FORMS
def gate8(b):
    gate(8, "Forms")
    ctx, pg, errs = session(b, "en", 1280)

    pg.evaluate("()=>location.hash='#templates'")
    pg.wait_for_timeout(2000)
    ck("the templates page separates the two kinds with tabs",
       pg.evaluate("()=>document.querySelectorAll('#tplTabs [data-tpltab]').length") == 2)
    ck("it opens on page templates",
       pg.evaluate("()=>!document.querySelector('[data-tplpane=\\'page\\']').hidden") and
       pg.evaluate("()=>document.querySelector('[data-tplpane=\\'mail\\']').hidden"))
    pg.click("#tplTabs [data-tpltab='mail']")
    pg.wait_for_timeout(800)
    ck("and the message tab shows message templates and hides page templates",
       pg.evaluate("()=>!document.querySelector('[data-tplpane=\\'mail\\']').hidden") and
       pg.evaluate("()=>document.querySelector('[data-tplpane=\\'page\\']').hidden"))
    n = pg.evaluate("()=>document.querySelectorAll('#emailTplList .item').length")
    ck("there is more than one message to choose between", n >= 4, n)
    kinds = pg.evaluate("()=>[...document.querySelectorAll('#emailTplList .id')].map(e=>e.textContent)")
    ck("each one says it is a message, not a page", all("EMAIL" in k or "MESSAGE" in k for k in kinds), kinds[:4])

    # composing for an opportunity: one tap to a real message
    pg.evaluate("()=>location.hash='#compose?slug=wise-butterfly'")
    pg.wait_for_timeout(2200)
    q = pg.evaluate("""()=>{const b=document.getElementById('etplQuick');
        return b&&!b.hidden?[...b.querySelectorAll('[data-quick]')].map(x=>x.textContent):[];}""")
    ck("it offers message templates to start from", len(q) >= 2, q)
    if q:
        pg.click("#etplQuick [data-quick]")
        pg.wait_for_timeout(1000)
        sub = pg.evaluate("()=>document.getElementById('esubject').value")
        bod = pg.evaluate("()=>document.getElementById('ebody').innerHTML")
        ck("choosing one writes the subject", len(sub) > 3, sub)
        ck("and a message with no merge slot left unfilled", "{{" not in bod, bod[:200])
        ck("and the page link is inside real words, not printed as a URL",
           "wise-butterfly" in bod and "<a " in bod, bod[:200])
        ck("and the offer withdraws once there is something to lose",
           pg.evaluate("()=>document.getElementById('etplQuick').hidden") is True)

    # the editor's optional half is folded, and folding never hides something you typed
    pg.evaluate("()=>location.hash='#editor'")
    pg.wait_for_timeout(1800)
    ck("the editor folds its optional fields away",
       pg.evaluate("()=>!!document.getElementById('edMore') && document.getElementById('edMore').hidden"))
    ck("and asks for the required content at rest",
       pg.evaluate("""()=>['f_biz','f_slug','f_proof1','f_proof2','f_proof3','f_want']
           .every(id=>{const e=document.getElementById(id);return e && e.offsetParent!==null;})"""))
    pg.click("#edMoreBtn")                     # you open it, exactly as a person would
    pg.wait_for_timeout(400)
    ck("opening it shows the optional fields",
       pg.evaluate("()=>!document.getElementById('edMore').hidden"))
    # the send date is filled in for you, so the count starts above zero: what matters is that
    # it follows what you type rather than that it happens to be one
    def more_count():
        txt = pg.evaluate("()=>document.getElementById('edMoreBtn').textContent")
        m = re.search(r"\((\d+)\)", txt)
        return int(m.group(1)) if m else 0
    before_n = more_count()
    pg.fill("#f_location", "Fairfax, VA")
    pg.wait_for_timeout(500)
    ck("and the button counts what is filled in behind it",
       more_count() == before_n + 1,
       (before_n, pg.evaluate("()=>document.getElementById('edMoreBtn').textContent")))

    # every input a person types into has a label
    for v in ("compose", "editor", "settings"):
        pg.evaluate("x=>location.hash='#'+x", v)
        pg.wait_for_timeout(1600)
        naked = pg.evaluate("""(vid)=>{const root=document.getElementById('view-'+vid);
            return [...root.querySelectorAll('input,select,textarea')]
              .filter(e=>e.type!=='hidden'&&e.offsetParent!==null)
              .filter(e=>!e.labels?.length && !e.getAttribute('aria-label') &&
                          !e.getAttribute('placeholder') && !e.closest('label'))
              .map(e=>e.id||e.name||e.className);}""", v)
        ck(f"every control in {v} says what it is", not naked, naked)
    ck("nothing threw", not errs, errs[:4])
    ctx.close()

    # The loop the whole console exists for: write a message, send it, and watch the
    # opportunity move. Under the lane rule the ledger is the only send evidence, so a send
    # that does not reach the ledger leaves the board frozen and the console decorative.
    SENT.clear()
    ctx = b.new_context(viewport={"width": 1280, "height": 950}, accept_downloads=True)
    ctx.route("**/exec", relay_sends)
    ctx.route("**/library/sync.json",
              lambda r: r.fulfill(status=200, body=json.dumps({"ep": EP, "up": 1})))
    ctx.route("https://api.github.com/**", lambda r: r.abort())
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_timeout(400)
    pg.fill("#gateInput", "ConThrive2030")
    pg.click(".gate-btn")
    pg.wait_for_timeout(2000)
    pg.evaluate("ep=>localStorage.setItem('thrive_email_ep_v1', ep)", EP)
    pg.reload()
    pg.wait_for_timeout(2400)

    pg.evaluate("()=>location.hash='#board'")
    pg.wait_for_timeout(1800)
    ck("an opportunity with no send starts in Ready",
       pg.evaluate("""()=>{const t=document.querySelector(".tok[data-slug='2-faces']");
           return t? t.closest('.lane').dataset.lane : null;}""") == "live")
    pg.evaluate("()=>location.hash='#compose?slug=2-faces'")
    pg.wait_for_timeout(2200)
    pg.click("#etplQuick [data-quick]")
    pg.wait_for_timeout(900)
    pg.fill("#eto", "owner@2faces.example")
    pg.fill("#ename", "Sara")
    pg.wait_for_timeout(400)
    pg.click("#eSend")
    pg.wait_for_timeout(2500)
    ck("sending hands the relay exactly one message", len(SENT) == 1, SENT)
    if SENT:
        m = SENT[0]
        ck("addressed to the person typed in", m.get("to") == "owner@2faces.example", m.get("to"))
        ck("sent from the Thrive address", "thriveiii.com" in str(m.get("from", "")), m.get("from"))
        ck("with that page's link in the html it actually sends",
           "opp/2-faces" in str(m.get("html", "")), str(m.get("html"))[:200])
    led = pg.evaluate("()=>getMailLog().filter(x=>x.opp==='2-faces')")
    ck("the ledger records it as a send", led and led[0].get("status") == "sent", led)
    pg.evaluate("()=>location.hash='#board'")
    pg.wait_for_timeout(2200)
    ck("and the board moves it from Ready to Sent",
       pg.evaluate("""()=>{const t=document.querySelector(".tok[data-slug='2-faces']");
           return t? t.closest('.lane').dataset.lane : null;}""") == "sent")
    ck("the day's quota counted it", pg.evaluate("()=>quotaUsage().day") == 1,
       pg.evaluate("()=>quotaUsage()"))
    pg.evaluate("()=>location.hash='#home'")
    pg.wait_for_timeout(2600)
    tpl = pg.eval_on_selector("#homeTemplates", "e=>e.innerText")
    ck("and the message it went out with became measurable",
       "opportunity page" in tpl or "فرصة" in tpl, tpl[:200])
    ck("nothing threw in the send loop", not errs, errs[:4])
    GATE8_CTX.append((ctx, pg))

# ================================================================ 9  RESILIENCE
def gate9(b):
    gate(9, "Resilience")
    # the relay is unreachable
    ctx, pg, errs = session(b, "en", 1280, relay=relay_down)
    pg.evaluate("()=>location.hash='#home'")
    pg.wait_for_timeout(3000)
    note = pg.evaluate("()=>(document.getElementById('homeDataNote')||{}).innerText||''")
    ck("with the relay unreachable, the analytics note says so", len(note.strip()) > 10, note)
    ck("and the page is still readable", visible(pg, "home")["text"] > 100)
    pg.evaluate("()=>location.hash='#board'")
    pg.wait_for_timeout(1600)
    ck("the board still renders from what this device knows",
       visible(pg, "board")["text"] > 60)
    ck("nothing threw when the network refused", not errs, errs[:4])
    ctx.close()

    # the relay is serving the old script
    ctx, pg, errs = session(b, "en", 1280, relay=relay_old)
    pg.evaluate("()=>location.hash='#settings'")
    pg.wait_for_timeout(1500)
    pg.click("#connRun")
    pg.wait_for_timeout(9000)
    verdict = pg.evaluate("()=>(document.getElementById('connNote')||{}).innerText||''")
    rows = pg.evaluate("()=>document.querySelectorAll('#connList li').length")
    ck("an old relay ends with a verdict on screen, not a spinner", len(verdict.strip()) > 10, verdict[:200])
    ck("and every link in the chain is reported", rows >= 5, rows)
    ck("nothing threw", not errs, errs[:4])
    ctx.close()

    # no data at all
    ctx, pg, errs = session(b, "en", 1280, seed=False)
    pg.evaluate("""()=>{['thrive_opps_v1','thrive_mail_v1','thrive_hits_remote_v1','thrive_hits_v1']
        .forEach(k=>localStorage.removeItem(k));}""")
    pg.reload()
    pg.wait_for_timeout(2600)
    for v in ("board", "home", "library", "activity"):
        pg.evaluate("x=>location.hash='#'+x", v)
        pg.wait_for_timeout(1400)
        st = visible(pg, v)
        ck(f"with nothing stored, {v} shows a designed empty state", st["text"] > 40, st)
    ck("nothing threw on an empty console", not errs, errs[:4])
    ctx.close()

    # A backup that does not round trip is a data loss waiting for the day it is needed.
    if GATE8_CTX:
        ctx, pg = GATE8_CTX.pop()
        pg.evaluate("()=>location.hash='#settings'")
        pg.wait_for_timeout(2000)
        with pg.expect_download() as dl:
            pg.click("#bkExport")
        path = dl.value.path()
        raw = open(path, encoding="utf-8").read()
        ck("the backup is real content, not an empty file", len(raw) > 200, len(raw))
        try:
            obj = json.loads(raw)
        except Exception as e:
            obj = None
            ck("the backup parses", False, e)
        if obj:
            for k in ("opps", "mail", "activity", "emailTemplates"):
                ck(f"the backup carries {k}", k in obj, sorted(obj.keys()))
            ck("and the send that was just made is inside it",
               any(x.get("opp") == "2-faces" for x in obj.get("mail", [])), obj.get("mail"))
            pg.evaluate("""()=>{['thrive_mail_v1','thrive_opps_v1','thrive_log_v1',
                'thrive_email_templates_v1','thrive_quota_v1'].forEach(k=>localStorage.removeItem(k));}""")
            pg.reload()
            pg.wait_for_timeout(2400)
            pg.evaluate("()=>location.hash='#settings'")
            pg.wait_for_timeout(1800)
            pg.set_input_files("#bkFile", path)
            pg.wait_for_timeout(2500)
            ck("restoring the file brings the ledger back",
               pg.evaluate("()=>getMailLog().filter(x=>x.opp==='2-faces').length") == 1)
            pg.evaluate("()=>location.hash='#board'")
            pg.wait_for_timeout(2200)
            ck("and the board reads the same as it did before the wipe",
               pg.evaluate("""()=>{const t=document.querySelector(".tok[data-slug='2-faces']");
                   return t? t.closest('.lane').dataset.lane : null;}""") == "sent")
        ctx.close()


# ================================================================ 10  BUILD
def gate10():
    gate(10, "Build")
    before = open(os.path.join(ROOT, "library", "console.html"), "rb").read()
    r = subprocess.run(["node", os.path.join(ROOT, "tools", "bundle.js")],
                       capture_output=True, text=True, cwd=ROOT, timeout=300)
    ck("the shell regenerates from source", r.returncode == 0, r.stderr[-300:])
    after = open(os.path.join(ROOT, "library", "console.html"), "rb").read()
    ck("and what is committed is what the source produces", before == after,
       "library/console.html is stale: run node tools/bundle.js and commit it")
    off = os.path.join(ROOT, "dist", "thrive-console.html")
    ck("the offline single file is produced", os.path.exists(off) and os.path.getsize(off) > 200000,
       os.path.getsize(off) if os.path.exists(off) else "missing")
    src = open(off, encoding="utf-8").read()
    ck("and it carries no external reference it cannot reach offline",
       not re.search(r'(src|href)="https?://(?!thriveiii)', src),
       (re.search(r'(src|href)="https?://(?!thriveiii)[^"]*', src) or [""])[0])
    r = subprocess.run(["node", os.path.join(ROOT, "tools", "verify.js")],
                       capture_output=True, text=True, timeout=300)
    ck("the verify gate passes", r.returncode == 0, r.stdout[-400:])


# ================================================================ run
def main():
    only = set(int(x) for x in sys.argv[1:] if x.isdigit())
    with sync_playwright() as b0:
        b = b0.chromium.launch(executable_path=CH)
        for n, fn in ((1, gate1), (2, gate2), (3, gate3), (4, gate4), (5, gate5),
                      (6, gate6), (7, gate7), (8, gate8), (9, gate9)):
            if only and n not in only:
                continue
            print(f"\n=== GATE {n} ===")
            fn(b)
        b.close()
    if not only or 10 in only:
        print("\n=== GATE 10 ===")
        gate10()
    httpd.shutdown()

    print("\n" + "=" * 62)
    bad = 0
    for n in sorted(results):
        checks = results[n]["checks"]
        f = [c for c, ok in checks if not ok]
        bad += len(f)
        mark = "PASS" if not f else "FAIL"
        print(f"  {mark}  gate {n:>2}  {results[n]['title']:<12} {len(checks) - len(f)}/{len(checks)}")
        for c in f:
            print(f"          - {c}")
    total = sum(len(results[n]["checks"]) for n in results)
    print("=" * 62)
    print(f"{total - bad}/{total} checks passed across {len(results)} gates")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
