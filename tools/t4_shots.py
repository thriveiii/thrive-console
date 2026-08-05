"""T4 evidence: the counter and the quiet glow.
Seeds a board where a DIFFERENT row wins each comparable column, so the glow can
be shown marking one cell per column (not a field of cells), plus cards in the
actionable lanes (replied, live) and a verdict number for the counter. Captures
the board and the campaign table at three widths in both locales, plus a
reduced-motion pass, and asserts one glow per column."""
import threading, http.server, socketserver, functools, os, json
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; PORT = 8841
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
httpd = socketserver.TCPServer(("127.0.0.1", PORT), Handler); httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
from playwright.sync_api import sync_playwright
base = f"http://127.0.0.1:{PORT}"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
OUT = ROOT + "/shots/t4"; os.makedirs(OUT, exist_ok=True)

# alpha wins Sent(3), bravo wins Views/Opens/Unique/Dwell, charlie+hotel are replied
# (so the verdict counts 2 and both cards glow), delta is live (ready to send, glows).
SEED = """()=>{ const now=Date.now(), iso=d=>new Date(now-d*86400000).toISOString();
 localStorage.setItem('thrive_opps_v1', JSON.stringify([
  {slug:'alpha',business:'Alpha Analytics',published:true,up:now,stage:'sent'},
  {slug:'bravo',business:'Bravo Media',published:true,up:now,stage:'sent'},
  {slug:'charlie',business:'Charlie Co',published:true,up:now,stage:'replied'},
  {slug:'hotel',business:'Hotel Group',published:true,up:now,stage:'replied'},
  {slug:'delta',business:'Delta Ready Co',published:true,up:now,contact_tier:'A',channel:{kind:'email',to:'d@delta.example'},outreach_text:'Hello.'},
  {slug:'echo',business:'Echo Draft',published:false,up:now}]));
 const mail=[
  {mid:'a1',opp:'alpha',direction:'out',status:'sent',to:'a@x.example',ts:iso(5)},
  {mid:'a2',opp:'alpha',direction:'out',status:'sent',to:'a@x.example',ts:iso(5)},
  {mid:'a3',opp:'alpha',direction:'out',status:'sent',to:'a@x.example',ts:iso(5)},
  {mid:'b1',opp:'bravo',direction:'out',status:'sent',to:'b@x.example',ts:iso(6)},
  {mid:'c1',opp:'charlie',direction:'out',status:'sent',to:'c@x.example',ts:iso(7)},
  {mid:'c2',opp:'charlie',direction:'in',status:'replied',to:'c@x.example',ts:iso(2)},
  {mid:'c3',opp:'charlie',direction:'in',status:'replied',to:'c@x.example',ts:iso(1)},
  {mid:'h1',opp:'hotel',direction:'out',status:'sent',to:'h@x.example',ts:iso(6)},
  {mid:'h2',opp:'hotel',direction:'in',status:'replied',to:'h@x.example',ts:iso(1)}];
 localStorage.setItem('thrive_mail_v1', JSON.stringify(mail));
 const hits=[];
 // bravo: 6 opens, 4 unique visitors, long dwell -> wins views/opens/unique/dwell
 ['v1','v2','v3','v4','v1','v2'].forEach((vid,i)=>hits.push({type:'open',slug:'bravo',vid:vid,ts:iso(3)}));
 [90000,80000,70000].forEach(ms=>hits.push({type:'dwell',slug:'bravo',ms:ms,vid:'v1',ts:iso(3)}));
 // alpha: 1 open, short dwell
 hits.push({type:'open',slug:'alpha',vid:'v9',ts:iso(1)});
 hits.push({type:'dwell',slug:'alpha',ms:8000,vid:'v9',ts:iso(1)});
 // charlie: 2 opens
 hits.push({type:'open',slug:'charlie',vid:'v7',ts:iso(1)});
 hits.push({type:'open',slug:'charlie',vid:'v8',ts:iso(1)});
 localStorage.setItem('thrive_hits_v1', JSON.stringify(hits));
}"""

def enter(pg, lang):
    pg.goto(base + "/library/console.html"); pg.wait_for_timeout(400)
    pg.evaluate("l=>localStorage.setItem('thrive_lang',l)", lang)
    if pg.query_selector("#thriveGate"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1200)
    pg.evaluate(SEED); pg.reload(); pg.wait_for_timeout(2000)
    if pg.query_selector("#thriveGate"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1200)
    pg.evaluate("()=>{document.querySelectorAll('.brand img,.gate-logo').forEach(e=>e.style.animation='none')}")

WIDTHS = [(390, 900), (768, 1000), (1440, 900)]

def board_facts(pg):
    return pg.evaluate("""()=>{
      const vc=document.querySelector('.vcount');
      const glowCards=[...document.querySelectorAll('.tok.is-glow[data-slug]')].map(e=>e.getAttribute('data-slug')).sort();
      const newOnLoad=document.querySelectorAll('.is-glow-new').length;   // 0 = no glow storm on a fresh load
      return { counter: vc? vc.textContent : null, restingGlowCards: glowCards, glowNewOnFreshLoad:newOnLoad };
    }""")

def glowchanged_unit(pg):
    # the mechanism itself: first sight is not a change; the same signature is not a change;
    # a new signature fires once; the next render at that signature rests.
    return pg.evaluate("""()=>({
      firstSight: glowChanged('__probe','1'),
      sameAgain:  glowChanged('__probe','1'),
      changed:    glowChanged('__probe','2'),
      restedAfter:glowChanged('__probe','2')
    })""")

def table_glow_per_column(pg):
    # count is-glow cells per column index in the campaign table
    return pg.evaluate("""()=>{
      const t=document.querySelector('#homeCampaigns table.logtable'); if(!t) return null;
      const per={};
      t.querySelectorAll('tbody tr').forEach(tr=>{
        [...tr.children].forEach((td,ci)=>{ if(td.classList.contains('is-glow')){ per[ci]=(per[ci]||0)+1; } });
      });
      return per;
    }""")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    for lang in ("en", "ar"):
        for (w, h) in WIDTHS:
            ctx = b.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce" if False else "no-preference")
            ctx.route("https://api.github.com/**", lambda x: x.abort())
            pg = ctx.new_page(); enter(pg, lang)
            # board: counter + card glow
            pg.evaluate("()=>location.hash='#board'"); pg.wait_for_timeout(1000)
            pg.screenshot(path=f"{OUT}/board-{lang}-{w}.png", clip={"x":0,"y":0,"width":w,"height":min(h,780)})
            if w == 768:
                print(lang, "board:", board_facts(pg))
                if lang == "en":
                    print("glowChanged unit (expect firstSight F, sameAgain F, changed T, restedAfter F):",
                          glowchanged_unit(pg))
            # home campaign table: highest-in-column glow
            pg.evaluate("()=>location.hash='#home'"); pg.wait_for_timeout(1400)
            el = pg.query_selector("#homeCampaigns")
            if el: el.screenshot(path=f"{OUT}/table-{lang}-{w}.png")
            if w == 768:
                per = table_glow_per_column(pg)
                print(lang, "table glow per column index:", per,
                      "-> max cells in any one column:", max(per.values()) if per else 0)
            ctx.close()
    # reduced-motion pass (en, 1024): animation must be gone, static accent remains
    ctx = b.new_context(viewport={"width": 1024, "height": 900}, reduced_motion="reduce")
    ctx.route("https://api.github.com/**", lambda x: x.abort())
    pg = ctx.new_page(); enter(pg, "en")
    pg.evaluate("()=>location.hash='#board'"); pg.wait_for_timeout(1000)
    anim = pg.evaluate("""()=>{ const e=document.querySelector('.tok.is-glow'); if(!e) return 'no-glow-card';
       return getComputedStyle(e).animationName; }""")
    ring = pg.evaluate("""()=>{ const e=document.querySelector('.tok.is-glow'); if(!e) return null;
       return getComputedStyle(e).boxShadow!=='none'; }""")
    print("reduced-motion board: is-glow-new animationName=", anim, " static ring present=", ring)
    pg.screenshot(path=f"{OUT}/reduced-board.png", clip={"x":0,"y":0,"width":1024,"height":760})
    pg.evaluate("()=>location.hash='#home'"); pg.wait_for_timeout(1400)
    el = pg.query_selector("#homeCampaigns")
    if el: el.screenshot(path=f"{OUT}/reduced-table.png")
    tanim = pg.evaluate("""()=>{ const e=document.querySelector('#homeCampaigns td.is-glow'); if(!e) return 'no-glow-cell';
       return getComputedStyle(e).animationName+' | bg='+ (getComputedStyle(e).backgroundColor); }""")
    print("reduced-motion table: td.is-glow animationName | bg =", tanim)
    ctx.close()
    b.close()
httpd.shutdown()
