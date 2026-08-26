"""BOARD_FIDELITY (Layer 2, browser, fails-when-broken).

Closes the gap between board.html's plain cards and the engine's board, still reading console_board for the
stage authority (never derived locally) and adding console_inbound only for reply DETAIL. Locks:

  1. Lane completeness: bounced + failed as their own lanes; won/lost/dropped + archived in a collapsible tray;
     "other" ends empty; every opp in its server stage's lane.
  2. Card richness: verdict hero (count-up), pipeline strip, chips (stalled/archived), new-activity dot.
  3. Reply fidelity: N-badge count == reply list length == the console_inbound grouping (dedup by sender,
     auto/bounce excluded); the inbound-health pill counts unattributed replies.
  4. AR shows the business NAME, not the slug, in both languages.
  5. No fabricated stage: a card sits in its console_board stage's lane, never promoted locally.
"""
import os, json, threading, http.server, socketserver, functools
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

board = open(os.path.join(ROOT, "library/board.html")).read()

# ---- source guards -------------------------------------------------------------------------------
ck("stage still comes from console_board only (bucketed, never derived)",
   "the SERVER stage only (never derived here)" in board and "BOARD_LANES.indexOf(st)" in board)
ck("domain law: a replied opp stays Replied even when archived (archiving never subtracts from the stage)",
   'if(st==="replied") return "replied";' in board)
ck("ONE count path: the stage numbers read the lane grouping (laneN); the old archived-subtracting cnt() is gone",
   "function laneN(l){ return (groups[l]||[]).length; }" in board and "function cnt(" not in board and "cnt(rows," not in board)
ck("the archived tray lists every archived opp (shelf, not exclusion) independent of its stage lane",
   "r.archived || TRAY_STAGES.indexOf" in board)
ck("reply detail reads console_inbound (best-effort, never blocks the board)",
   "/rest/v1/console_inbound?select=" in board and "if(!res.ok) return [];" in board)
ck("one resolver: auto/bounce excluded, dedup by sender, numbered",
   'r.kind==="auto" || r.bounce' in board and "it.num=i+1;" in board)
ck("drift/sync pills intentionally not carried (documented)",
   "drift/sync pills are intentionally NOT carried" in board)

# ---- data ----------------------------------------------------------------------------------------
ROWS = [
  {"slug":"acme","business":"Acme Co","stage":"draft","sent_count":0,"open_count":0,"replied":False,"idle_days":None,"has_page":False,"has_email":True,"archived":False,"last_activity_ts":None},
  {"slug":"beta","business":"Beta LLC","stage":"live","sent_count":0,"open_count":0,"replied":False,"idle_days":None,"has_page":True,"has_email":True,"archived":False,"last_activity_ts":None},
  {"slug":"gamm","business":"Gamma Inc","stage":"sent","sent_count":2,"open_count":0,"replied":False,"idle_days":10,"has_page":True,"has_email":True,"archived":False,"last_activity_ts":"2026-01-01T00:00:00Z"},
  {"slug":"delt","business":"Delta Foods","stage":"opened","sent_count":1,"open_count":4,"replied":False,"idle_days":1,"has_page":True,"has_email":True,"archived":False,"last_activity_ts":"2026-01-02T00:00:00Z"},
  {"slug":"epsi","business":"Epsilon","stage":"replied","sent_count":1,"open_count":2,"replied":True,"idle_days":0,"has_page":True,"has_email":True,"archived":False,"last_activity_ts":"2026-01-03T00:00:00Z"},
  {"slug":"boun","business":"Bounce Co","stage":"bounced","sent_count":1,"open_count":0,"replied":False,"idle_days":2,"has_page":True,"has_email":True,"archived":False,"last_activity_ts":None},
  {"slug":"fail","business":"Fail Co","stage":"failed","sent_count":1,"open_count":0,"replied":False,"idle_days":2,"has_page":True,"has_email":True,"archived":False,"last_activity_ts":None},
  {"slug":"wonn","business":"Won Co","stage":"won","sent_count":1,"open_count":1,"replied":True,"idle_days":9,"has_page":True,"has_email":True,"archived":False,"last_activity_ts":None},
  {"slug":"arch","business":"Archived Co","stage":"sent","sent_count":1,"open_count":0,"replied":False,"idle_days":30,"has_page":True,"has_email":True,"archived":True,"last_activity_ts":None},
  {"slug":"arab","business":"شركة الاختبار","stage":"live","sent_count":0,"open_count":0,"replied":False,"idle_days":None,"has_page":True,"has_email":True,"archived":False,"last_activity_ts":None},
  # Domain law: a REPLIED opp that has been archived (conversation concluded successfully) is STILL Replied - it
  # must count and appear in the Replied lane, AND still be listed on the archived shelf. This is the Basel case.
  {"slug":"basl","business":"Basel Issa","stage":"replied","sent_count":1,"open_count":1,"replied":True,"idle_days":4,"has_page":True,"has_email":True,"archived":True,"last_activity_ts":"2026-01-04T00:00:00Z"},
]
INBOUND = [  # for epsi: two distinct human repliers (a,b) + a dup a + one auto + one bounce; plus one unattributed
  {"opp":"epsi","kind":"human","bounce":None,"ts":"2026-01-01T10:00:00Z","data":{"from":"a@x.com","subject":"Re: hi"}},
  {"opp":"epsi","kind":"human","bounce":None,"ts":"2026-01-02T10:00:00Z","data":{"from":"b@x.com","subject":"Re: hi"}},
  {"opp":"epsi","kind":"human","bounce":None,"ts":"2026-01-03T10:00:00Z","data":{"from":"a@x.com","subject":"Re: hi again"}},
  {"opp":"epsi","kind":"auto","bounce":None,"ts":"2026-01-04T10:00:00Z","data":{"from":"c@x.com"}},
  {"opp":"epsi","kind":"human","bounce":"hard","ts":"2026-01-05T10:00:00Z","data":{"from":"d@x.com"}},
  {"opp":"","kind":"human","bounce":None,"ts":"2026-01-06T10:00:00Z","data":{"from":"waiting@x.com"}},
  {"opp":"basl","kind":"human","bounce":None,"ts":"2026-01-07T10:00:00Z","data":{"from":"basel@issa.com","subject":"Re: hi"}},
]

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
handler = functools.partial(Handler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context()
    ctx.add_init_script("try{localStorage.setItem('console_sb_session', JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'op@thrive.test',uid:'u'}));}catch(e){}")
    ctx.route("**/rest/v1/console_board**", lambda r: r.fulfill(status=200, headers={"content-type":"application/json"}, body=json.dumps(ROWS)))
    ctx.route("**/rest/v1/console_inbound**", lambda r: r.fulfill(status=200, headers={"content-type":"application/json"}, body=json.dumps(INBOUND)))
    pg = ctx.new_page()
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(900)  # > count-up

    st = pg.evaluate("""()=>{
      var lanes={}; document.querySelectorAll('.lane h2').forEach(function(h){ lanes[h.childNodes[0].textContent.trim()]=h.querySelector('.n').textContent.trim(); });
      function laneCards(label){ var out=[]; document.querySelectorAll('.lane').forEach(function(l){ var h=l.querySelector('h2'); if(h && h.childNodes[0].textContent.trim()===label) out=[].map.call(l.querySelectorAll('.card .b'),function(x){return x.textContent;}); }); return out; }
      var epsiCard=null; document.querySelectorAll('.card').forEach(function(c){ if(/Epsilon/.test(c.textContent)) epsiCard=c; });
      var baslCard=null; document.querySelectorAll('.card').forEach(function(c){ if(/Basel Issa/.test(c.textContent)) baslCard=c; });
      return {
        lanes:lanes,
        laneNames:[].map.call(document.querySelectorAll('.lane h2'), function(h){return h.childNodes[0].textContent.trim();}),
        openedCards:laneCards('Opened'),
        repliedCards:laneCards('Replied'),
        hero:(document.querySelector('.vnum')||{}).textContent||'', heroLabel:(document.querySelector('.vlabel')||{}).textContent||'',
        pipe:[].map.call(document.querySelectorAll('.pchip .pn'),function(x){return x.textContent;}),
        chips:(document.querySelector('.chips')||{}).textContent||'',
        pills:(document.querySelector('.pills')||{}).textContent||'',
        trayN:(function(){var t=document.querySelector('.tray-toggle .n');return t?t.textContent.trim():'';})(),
        trayHidden:(function(){var b=document.getElementById('trayBody');return b?b.hidden:null;})(),
        trayNames:(function(){var b=document.getElementById('trayBody');return b?[].map.call(b.querySelectorAll('.card .b'),function(x){return x.textContent;}):[];})(),
        epsiBadge:epsiCard?((epsiCard.querySelector('.nbadge')||{}).textContent||''):'',
        epsiReps:epsiCard?epsiCard.querySelectorAll('.reps .rep').length:-1,
        baslBadge:baslCard?((baslCard.querySelector('.nbadge')||{}).textContent||''):'',
        baslReps:baslCard?baslCard.querySelectorAll('.reps .rep').length:-1,
      };
    }""")
    ck("1: five open lanes render with their server counts (Replied includes the archived Basel)",
       st["lanes"].get("Draft")=="1" and st["lanes"].get("Live")=="2" and st["lanes"].get("Sent")=="1"
       and st["lanes"].get("Opened")=="1" and st["lanes"].get("Replied")=="2", st["lanes"])
    ck("1: bounced and failed appear as their own lanes",
       st["lanes"].get("Bounced")=="1" and st["lanes"].get("Failed")=="1", st["lanes"])
    ck("1: no 'other' catch-all lane (every stage has a home)", "Other" not in st["laneNames"], st["laneNames"])
    # DOMAIN LAW: a replied+archived opp counts as Replied AND is listed on the archived shelf (dual presence).
    ck("LAW: the archived-replied Basel appears in the Replied lane (not subtracted, not hidden)",
       any("Basel Issa" in c for c in st["repliedCards"]) and any("Epsilon" in c for c in st["repliedCards"]), st["repliedCards"])
    ck("LAW: the tray still lists archived opps including Basel (won + archived-sent + archived-replied = 3)",
       st["trayN"]=="3" and st["trayHidden"] is True and any("Basel Issa" in c for c in st["trayNames"]), st)
    ck("5: no fabricated stage (Delta with opens sits in Opened, not promoted)", st["openedCards"]==["Delta Foods"], st["openedCards"])
    ck("2: verdict hero counts up to the replied count (2, includes archived) with its label",
       st["hero"]=="2" and ("replied" in st["heroLabel"]), st)
    ck("2: pipeline Replied count agrees with the lane header - ONE count path (both 2, includes archived)",
       st["pipe"]==["1","2","1","1","2"] and st["lanes"].get("Replied")==st["pipe"][4], st["pipe"])
    ck("2: chips show stalled and archived", ("stalled" in st["chips"]) and ("archived" in st["chips"]), st["chips"])
    ck("3: reply N-badge equals the console_inbound grouping (2 distinct repliers, auto/bounce/dup excluded)",
       st["epsiBadge"]=="2" and st["epsiReps"]==2, st)
    ck("3: the archived Basel still carries his reply badge (N-badge == reply list == 1, one resolver)",
       st["baslBadge"]=="1" and st["baslReps"]==1, st)
    ck("3: inbound-health pill counts the one unattributed reply waiting (Basel's reply is attributed, not waiting)",
       "1" in st["pills"] and ("waiting" in st["pills"]), st["pills"])

    # tray reopens (disclosure)
    pg.click(".tray-toggle"); pg.wait_for_timeout(150)
    ck("1: the tray reopens (disclosure), revealing the 3 closed/archived cards",
       pg.evaluate("()=>{var b=document.getElementById('trayBody');return b && !b.hidden && b.querySelectorAll('.card').length===3;}"), None)

    # AR: names not slugs
    pg.click("#langBtn"); pg.wait_for_timeout(500)
    arb = pg.evaluate("""()=>{
      var t=document.body.textContent;
      return { dir:document.documentElement.getAttribute('dir'),
               arabName: t.indexOf('شركة الاختبار')>=0, arabSlug: /(^|[^a-z])arab([^a-z]|$)/.test(t),
               epsiName: t.indexOf('Epsilon')>=0 };
    }""")
    ck("4: AR flips RTL and shows the Arabic business NAME, not the slug",
       arb["dir"]=="rtl" and arb["arabName"] and not arb["arabSlug"], arb)
    ck("4: the business name (not slug) is shown in AR for Latin names too (Epsilon)", arb["epsiName"], arb)

    ctx.close(); b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL BOARD-FIDELITY CHECKS PASS"))
raise SystemExit(1 if fails else 0)
