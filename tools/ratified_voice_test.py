"""The console speaks in the ratified voice: tagline and hero truth (WO-025, FINAL).

Two concerns. The tagline is ratified verbatim, both languages (EN "Where your outreach thrives"; AR
"حيث يزدهر تواصلك مع العالم الخارجي", no guillemets in the UI). And every hero state tells its OWN truth:
the deployed subtitle was chosen by b.summary.stalled ALONE, so a reply hero with any stalled card wore
"Untouched for 10 days or more." Now the subtitle is keyed to the hero state, its count and recency read
from the same derivations the hero uses, and no state borrows another's line.

Engine-independent facts (the rendered copy on WebKit is Thyab's device gate): the tagline renders
character for character and the old string is gone; the reply hero names who answered and when and never
shows the stalled line even when a stalled card is present; the stalled hero shows the stall; the reading
hero shows the last-open recency; and the Arabic reply subtitle uses the active verb أجابك with Western
numerals, never the passive stalled line."""
import threading, http.server, socketserver, functools, os, re
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:500])

# ---- source guards: the ratified tagline verbatim, the old string gone, the AR verb active ----
i18n = open(os.path.join(ROOT, "library/i18n.js"), encoding="utf-8").read()
ck("the ratified EN tagline lands verbatim (board_sub = Where your outreach thrives)",
   'board_sub:      "Where your outreach thrives"' in i18n)
ck("the ratified AR tagline lands verbatim, no guillemets in the UI string",
   'board_sub:      "حيث يزدهر تواصلك مع العالم الخارجي"' in i18n and "«حيث" not in i18n)
ck("the old tagline is gone from the source (greps to zero in library/)",
   "every opportunity stands" not in i18n and "أين تقف كل فرصة" not in i18n)
for f in ["library/console.html","library/board.html","library/app.js"]:
    txt=open(os.path.join(ROOT,f),encoding="utf-8").read()
    ck(f"the old tagline is absent from {f}",
       "every opportunity stands" not in txt and "أين تقف كل فرصة" not in txt)
ck("the reply-hero subtitle uses the ACTIVE verb أجابك (not the passive stalled line)",
   "أجابك {name}" in i18n)

# ---- the subtitle is keyed to the hero STATE, each state its own line (no state borrows another) ----
app = open(os.path.join(ROOT, "library/app.js"), encoding="utf-8").read()
ck("the old selector is gone: the subtitle is no longer chosen by b.summary.stalled alone",
   'boardVerdictSub").innerHTML = b.summary.stalled' not in app)
ck("each hero state routes to its OWN subtitle (replied->replied, opened->opened, stalled->stalled, else nudge)",
   ('v.key==="vd_replied"' in app and '"vd_sub_replied"' in app
    and 'v.key==="vd_opened"' in app and '"vd_sub_opened"' in app
    and 'v.key==="vd_stalled"' in app and '"vd_sub_stalled"' in app
    and '"vd_sub_none"' in app))
ck("the count and recency come from the derivations, not hardcoded (latest reply, opens map)",
   "latestReplyDetail" in app and "latestOpenDays" in app and "daysSince" in app and "openTimes" in app)

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

# Build the local stores in the browser (dynamic timestamps relative to now), then refresh and read the
# rendered verdict + subtitle text. reply 3 days ago; a separate card stalled (sent 20 days ago).
def seed_js(reply_name):
    return ("""(() => {
      const D=(days)=> new Date(Date.now()-(days*86400000 + 3600000)).toISOString();
      const set=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
      set('thrive_opps_v1',[
        {slug:'rep',business:'July',published:true,stage:'sent',recipients:[{addr:'basel@x.ex',name:'REPLY_NAME'}]},
        {slug:'old',business:'Old co',published:true,stage:'sent',recipients:[{addr:'z@x.ex'}]} ]);
      set('thrive_mail_v1',[
        {mid:'s1',opp:'rep',to:'basel@x.ex',subject:'H',status:'sent',direction:'out',ts:D(9)},
        {mid:'s2',opp:'old',to:'z@x.ex',subject:'H',status:'sent',direction:'out',ts:D(20)} ]);
      set('thrive_inbound_v1',[
        {gid:'r1',opp:'rep',kind:'reply',from:'basel@x.ex',name:'REPLY_NAME',subject:'Re: H',snippet:'yes',ts:D(3)} ]);
      set('thrive_hits_v1',[]);
    })()""").replace("REPLY_NAME", reply_name)

SEED_STALLED = """(() => {
  const D=(days)=> new Date(Date.now()-(days*86400000 + 3600000)).toISOString();
  const set=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
  set('thrive_opps_v1',[ {slug:'old',business:'Old co',published:true,stage:'sent',recipients:[{addr:'z@x.ex'}]} ]);
  set('thrive_mail_v1',[ {mid:'s2',opp:'old',to:'z@x.ex',subject:'H',status:'sent',direction:'out',ts:D(20)} ]);
  set('thrive_inbound_v1',[]); set('thrive_hits_v1',[]);
})()"""


def render(pg, seed, lang="en"):
    pg.evaluate("(s)=>eval(s)", seed)
    # The board reads ONE server-computed stage from v_console_board now (it derives no stage of its own),
    # so hand it the computed rows for the seeded cards: the reply card is replied (3 days ago), the old
    # card is a sent card gone stale (idle 20). The hero and its subtitle then read from that one board
    # model. A view row for a slug the seed did not create is simply ignored (that card is not on the board).
    pg.evaluate("""()=>window.__boardViewSet([
      {slug:'rep', stage:'replied', open_count:0, replied:true, idle_days:3, has_page:true, has_email:false, archived:false},
      {slug:'old', stage:'sent', open_count:0, replied:false, idle_days:20, has_page:true, has_email:false, archived:false}
    ])""")
    pg.evaluate("(l)=>{ try{ window.setLang&&window.setLang(l); }catch(e){} }", lang)
    pg.evaluate("()=>window.thriveBoardRefresh&&window.thriveBoardRefresh()")
    pg.wait_for_timeout(120)
    return pg.evaluate("""()=>({ v:(document.getElementById('boardVerdict')||{}).textContent||'',
      sub:(document.getElementById('boardVerdictSub')||{}).textContent||'',
      chips:(document.getElementById('boardChips')||{}).textContent||'' })""")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page()
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_function("()=>typeof window.thriveBoardRefresh==='function'", timeout=15000)

    # ---- the tagline renders from the ratified string ----
    tag = pg.evaluate("()=>{ try{ window.setLang&&window.setLang('en'); }catch(e){} return (typeof t==='function')? t('board_sub') : ''; }")
    ck("the EN tagline renders character for character", tag=="Where your outreach thrives", tag)
    tag_ar = pg.evaluate("()=>{ try{ window.setLang&&window.setLang('ar'); }catch(e){} return (typeof t==='function')? t('board_sub') : ''; }")
    ck("the AR tagline renders character for character (no guillemets)",
       tag_ar=="حيث يزدهر تواصلك مع العالم الخارجي", tag_ar)

    # ---- the reply hero WITH a stalled card present: speaks about the reply, never the stalled line ----
    r = render(pg, seed_js("Basel"), "en")
    ck("the reply hero headline is about the reply", "answered you" in r["v"], r["v"])
    ck("a stalled card IS present (the exact condition that used to hijack the subtitle)",
       "stalled" in r["chips"], r["chips"])
    ck("the reply hero subtitle names who answered and when, from the derivation (Basel, 3 days ago)",
       ("Basel" in r["sub"]) and ("3" in r["sub"]) and ("ago" in r["sub"]), r["sub"])
    ck("the reply hero NEVER shows the stalled line",
       "Untouched" not in r["sub"], r["sub"])

    # ---- the stalled hero shows its own line ----
    rs = render(pg, SEED_STALLED, "en")
    ck("the stalled hero headline is about the stall", "gone quiet" in rs["v"], rs["v"])
    ck("the stalled hero subtitle is the stalled line (Untouched for 10 days or more)",
       "Untouched for" in rs["sub"] and "10" in rs["sub"], rs["sub"])

    # ---- Arabic reply hero: active verb, Western numerals, never the passive stalled line ----
    ra = render(pg, seed_js("باسل"), "ar")
    ck("the Arabic reply subtitle uses the active verb أجابك and names the replier",
       ("أجابك" in ra["sub"]) and ("باسل" in ra["sub"]), ra["sub"])
    ck("the Arabic reply subtitle carries a Western numeral and never the passive stalled line",
       ("3" in ra["sub"]) and ("لم تُلمس" not in ra["sub"]) and not re.search(r"[٠-٩]", ra["sub"]), ra["sub"])

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL RATIFIED-VOICE CHECKS PASS"))
raise SystemExit(1 if fails else 0)
