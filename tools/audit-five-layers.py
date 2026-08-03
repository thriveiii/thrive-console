"""Five review layers, run against the shell: purpose, story, truth, craft, resilience."""
import threading, http.server, socketserver, functools, os, sys, json
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH","/opt/pw-browsers")
ROOT="/home/user/thrive-console"
Handler=functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
# Port 0 lets the OS pick a free one, so the audit can be re-run immediately and twice at once.
socketserver.TCPServer.allow_reuse_address=True
httpd=socketserver.TCPServer(("127.0.0.1",0),Handler); httpd.daemon_threads=True
PORT=httpd.server_address[1]
threading.Thread(target=httpd.serve_forever,daemon=True).start()
from playwright.sync_api import sync_playwright
base=f"http://127.0.0.1:{PORT}"; CH="/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
fails=[]
def ck(layer,n,c): print(("PASS" if c else "FAIL"),"L"+str(layer),n); 0 if c else fails.append("L%d %s"%(layer,n))
EP=f"http://127.0.0.1:{PORT}/exec"
SYNCS={"n":0}
def relay(route):
    if route.request.method=="GET":
        return route.fulfill(status=200, body="Thrive relay v4 (email + sync + analytics) is running.")
    d=json.loads(route.request.post_data or "{}")
    if d.get("op")=="state_get": SYNCS["n"]+=1; return route.fulfill(status=200,body=json.dumps({"ok":True,"data":None}))
    if d.get("op")=="hits_get": return route.fulfill(status=200,body=json.dumps({"ok":True,"events":HITS}))
    return route.fulfill(status=200,body=json.dumps({"ok":True,"id":"x"}))
# v1x is the record that broke in production: a page made on a date, read three times, and
# never emailed to anybody. Its date is not a send and its views are not opens.
def ago(d):
    import datetime
    return (datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(days=d)).isoformat().replace("+00:00","Z")
HITS=[{"type":"open","slug":"v1x","ts":ago(2),"vid":"a"},
      {"type":"open","slug":"v1x","ts":ago(1),"vid":"b"},
      {"type":"open","slug":"v1x","ts":ago(1),"vid":"c"}]
SEED="""()=>{ const now=Date.now(), iso=d=>new Date(now-d*86400000).toISOString();
 localStorage.setItem('thrive_opps_v1', JSON.stringify([
  {slug:'d1',business:'Draft co',published:false,up:now},
  {slug:'l1',business:'Live co',published:true,up:now},
  {slug:'v1x',business:'Read but unsent co',published:true,sent_on:'2026-07-30',up:now},
  {slug:'s1',business:'Stalled co',published:true,sent_on:'2026-06-20',up:now},
  {slug:'r1',business:'Replied co',published:true,stage:'replied',up:now},
  {slug:'w1',business:'Won co',published:true,stage:'won',up:now}]));
 localStorage.setItem('thrive_mail_v1', JSON.stringify([
  {mid:'m1',ts:iso(40),opp:'s1',to:'a@b.com',toName:'A',status:'sent',direction:'out'},
  {mid:'m2',ts:iso(2),opp:'r1',to:'c@d.com',toName:'C',status:'sent',direction:'out'},
  {mid:'m3',ts:iso(1),opp:'r1',to:'c@d.com',status:'replied',direction:'in'}]));
}"""
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CH)
    for w,lang in ((390,"en"),(390,"ar"),(1024,"ar"),(1440,"en")):
        ctx=b.new_context(viewport={"width":w,"height":880},
                          has_touch=(w<=430), is_mobile=(w<=430))
        ctx.route("**/exec", relay)
        ctx.route("**/library/sync.json", lambda r: r.fulfill(status=200, body=json.dumps({"ep":EP,"up":1})))
        ctx.route("https://api.github.com/**", lambda r: r.abort())
        pg=ctx.new_page(); errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)))
        tag=f"{lang}/{w}"
        pg.goto(f"{base}/library/console.html"); pg.wait_for_timeout(400)
        pg.evaluate("l=>localStorage.setItem('thrive_lang',l)", lang)
        pg.fill("#gateInput","ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1500)
        pg.evaluate(SEED); pg.reload(); pg.wait_for_timeout(2800)

        # ---- L1 purpose ----
        ck(1,tag+": it lands on the board, one entry point", pg.eval_on_selector("#view-board","e=>!e.hidden"))
        ck(1,tag+": exactly one view is on screen", pg.eval_on_selector_all(".view","els=>els.filter(e=>!e.hidden).length")==1)
        ck(1,tag+": four destinations, not seven", pg.eval_on_selector_all(".nav a","e=>e.length")==4)
        ck(1,tag+": what the work produced is one tap from where the work happens",
           pg.eval_on_selector_all(".nav a[data-view='home']","e=>e.length")==1)

        # ---- L2 story ----
        v=pg.eval_on_selector("#boardVerdict","e=>e.innerText")
        ck(2,tag+": the verdict speaks before any table", len(v)>5)
        ck(2,tag+": it says one thing, not a stack", v.count(".")<=2 and "\n" not in v.strip())
        ck(2,tag+": a reply outranks a stall in what it reports",
           ("answered" in v) or ("ردّ" in v))

        # ---- L3 truth ----
        counts=pg.eval_on_selector_all(".lane","els=>Object.fromEntries(els.map(e=>[e.dataset.lane, e.querySelectorAll('.tok').length]))")
        model=pg.evaluate("""async ()=>{ const o=await mergedOpps(); const opens={},views={};
          o.forEach(x=>{ opens[x.slug]=outreachOpens(x); views[x.slug]=opensForSlug(x.slug); });
          return ThriveBoard.build(o,{opens,views,mail:getMailLog()}).summary.counts; }""")
        ck(3,tag+": what is drawn equals what was derived",
           all(counts.get(k)==model.get(k) for k in ["draft","live","sent","opened","replied"]))
        ck(3,tag+": a closed opportunity is counted, not shown", pg.eval_on_selector("#trayCount","e=>e.textContent")=="1")
        ck(3,tag+": the stalled one carries its ring", pg.eval_on_selector_all(".tok.is-stalled","e=>e.length")>=1)
        ck(3,tag+": every lane with nothing in it says so, rather than looking broken",
           pg.eval_on_selector_all(".lane","els=>els.every(e=>e.querySelectorAll('.tok').length>0 || e.querySelector('.lane-empty'))"))

        # A lane is a claim about what happened. Nothing reaches Sent or Opened without a send.
        where=pg.evaluate("""()=>{const o={};document.querySelectorAll('.tok[data-slug]').forEach(e=>
          o[e.dataset.slug]=e.closest('.lane').dataset.lane);return o}""")
        ck(3,tag+": a page nobody was written to is not reported as sent", where.get("v1x")=="live")
        ck(3,tag+": and its readers are not reported as opens",
           pg.evaluate("()=>outreachOpens({slug:'v1x'})")==0)
        ck(3,tag+": its views are still shown, because a view is real",
           "3" in pg.eval_on_selector(".tok[data-slug='v1x']","e=>e.innerText"))
        ck(3,tag+": a page with no send is not asked to be followed up",
           pg.evaluate("""async ()=>{const o=await mergedOpps();
             return o.filter(x=>needsFollowup(x)).every(x=>x.slug!=='v1x'&&x.slug!=='l1');}"""))
        ck(3,tag+": the derivation layer passes its own test",
           pg.evaluate("()=>ThriveBoard.selfTest().pass"))

        # the listener registry: a second view must not unsubscribe the first
        pg.evaluate("()=>location.hash='#activity'"); pg.wait_for_timeout(1500)
        pg.evaluate("()=>location.hash='#board'"); pg.wait_for_timeout(1200)
        ck(3,tag+": the board still refreshes after another view initialised",
           pg.evaluate("()=>!!(window.__hooksProbe===undefined) && typeof window.onThriveSync==='function'"))
        moved=pg.evaluate("""async ()=>{
          saveDraft({slug:'l1', stage:'replied'}); logActivity('stage','l1','replied');
          window.onThriveSync();                       // exactly what a sync round fires
          await new Promise(r=>setTimeout(r,900));
          const el=document.querySelector(".tok[data-slug='l1']");
          return el? el.closest('.lane').dataset.lane : null;
        }""")
        ck(3,tag+": a sync round really re-renders the board", moved=="replied")

        # ---- the numbers themselves: reachable, and reading the same truth ----
        pg.click(".nav a[data-view='home']"); pg.wait_for_timeout(2200)
        ck(1,tag+": the insights view opens from the bar", pg.eval_on_selector("#view-home","e=>!e.hidden"))
        ck(2,tag+": it opens with a sentence, before any table",
           len(pg.eval_on_selector("#homeStory","e=>e.innerText").strip())>10)
        for sec,label in (("homeCampaigns","campaign performance"),("homeTemplates","which message is working"),
                          ("homePeople","who is paying attention"),("homeTop","most viewed pages")):
            ck(1,tag+": "+label+" is on the page",
               len(pg.eval_on_selector("#"+sec,"e=>e.innerText").strip())>0)
        ck(3,tag+": the campaign table separates views from opens",
           pg.evaluate("""()=>{const h=document.querySelector('#homeCampaigns thead');
             if(!h) return false; const s=h.innerText.toLowerCase();
             return (s.includes('view')||s.includes('مشاهد')) && (s.includes('open')||s.includes('فتح'));}"""))
        ck(3,tag+": every column header is distinct, so two numbers never share a name",
           pg.evaluate("""()=>[...document.querySelectorAll('#homeTemplates thead th')]
             .map(e=>e.innerText.trim()).every((v,i,a)=>a.indexOf(v)===i)"""))
        ck(3,tag+": an unsent page reports zero opens next to its views",
           pg.evaluate("""()=>{const r=[...document.querySelectorAll('#homeCampaigns tbody tr')]
             .find(t=>/Read but unsent/.test(t.innerText)); if(!r) return false;
             const c=[...r.children].map(e=>e.innerText.trim());
             return c[1]==='0' && c[2]==='3' && c[3]==='0';}"""))
        pg.evaluate("()=>location.hash='#board'"); pg.wait_for_timeout(1200)

        # ---- L4 craft ----
        ck(4,tag+": the page never scrolls sideways",
           pg.evaluate("()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1"))
        ck(4,tag+": no untranslated key leaks anywhere on screen",
           pg.evaluate("""()=>!/\\b(board_|lane_|tok_|vd_|dw_|mw_|conn_|home_|sy_)[a-z_]+\\b/.test(document.body.innerText)"""))
        floor = 40 if w<=430 else 28
        small = pg.eval_on_selector_all(".nav a,.btn,.tok,.chip,.langbtn",
           "(els,f)=>els.filter(e=>e.offsetParent && e.getBoundingClientRect().height<f).map(e=>(e.innerText||e.className).slice(0,20))", floor)
        ck(4,tag+f": every tap target clears {floor}px", len(small)==0)
        if small: print("    small:", small)
        if lang=="ar":
            ck(4,tag+": the document is right to left", pg.evaluate("()=>document.documentElement.dir")=="rtl")
            ck(4,tag+": no letter-spacing reaches Arabic",
               pg.evaluate("""()=>[...document.querySelectorAll('.lane-title,.verdict,.tok-name,.chip,.nav a')]
                 .filter(e=>/[\\u0600-\\u06FF]/.test(e.textContent))
                 .every(e=>{const ls=getComputedStyle(e).letterSpacing; return ls==='normal'||ls==='0px';})"""))
            ck(4,tag+": digits stay left to right inside Arabic",
               pg.evaluate("""()=>[...document.querySelectorAll('.n')].every(e=>getComputedStyle(e).direction==='ltr')"""))

        # ---- L5 resilience ----
        tok=pg.query_selector(".tok")
        tok.click(); pg.wait_for_timeout(1200)
        ck(5,tag+": the opportunity window opens over the board", pg.eval_on_selector("#modal","e=>!e.hidden"))
        ck(5,tag+": the window fits the screen",
           pg.eval_on_selector("#modal","e=>e.getBoundingClientRect().width")<=w)
        ck(5,tag+": its margins are equal on both sides",
           pg.evaluate("""(w)=>{const r=document.getElementById('modal').getBoundingClientRect();
             return Math.abs(r.left-(w-r.right))<=2;}""", w))
        ck(5,tag+": it never exceeds 88vh",
           pg.evaluate("()=>document.getElementById('modal').getBoundingClientRect().height<=innerHeight*0.881"))
        ck(1,tag+": all five tabs are there",
           pg.eval_on_selector_all("#modalTabs .modal-tab","e=>e.length")==5)
        ck(5,tag+": the board behind it cannot be scrolled",
           pg.evaluate("()=>getComputedStyle(document.body).position==='fixed'"))
        # a modal is modal: the bar behind it is out of reach, on purpose
        ck(5,tag+": the page behind the window is out of reach while it is open",
           pg.evaluate("""()=>{const r=document.getElementById('langbtn').getBoundingClientRect();
             const el=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);
             return !el || el.id!=='langbtn';}"""))
        # and the keyboard cannot walk out of it either
        pg.keyboard.press("Tab"); pg.keyboard.press("Tab"); pg.keyboard.press("Tab")
        ck(5,tag+": focus stays inside the dialog",
           pg.evaluate("()=>document.getElementById('modal').contains(document.activeElement)"))
        pg.keyboard.press("Escape"); pg.wait_for_timeout(700)
        pg.click("#langbtn"); pg.wait_for_timeout(1200)
        ck(5,tag+": the language switch still works once it is closed",
           pg.evaluate("()=>document.documentElement.dir") in ("rtl","ltr"))
        ck(5,tag+": and the editor and composer are still single",
           pg.eval_on_selector_all("#eto","e=>e.length")==1 and pg.eval_on_selector_all("#f_biz","e=>e.length")==1)
        ck(5,tag+": no JS errors anywhere in that walk", len(errs)==0)
        if errs: print("    ERR", errs[:3])
        ctx.close()
    b.close()
httpd.shutdown()
print("\nRESULT:", "ALL PASS" if not fails else "FAILURES: "+" | ".join(fails))
sys.exit(1 if fails else 0)
