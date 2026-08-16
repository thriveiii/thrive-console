"""One source of stage everywhere, zero drift.

The structural gap this closes: "list from the manifest, stage from the view" let a manifest card
that has NO console_opps row (so no console_board row) render one stage on the board and another in
the detail. The board fell back to its own base (ready/draft); the card detail read effStage, a second
derivation over the local mail/hits/inbound stores, and so showed opened or replied for the very card
the board called ready. Ludic Lillian was the live instance.

The fix: the board lane AND the card detail (the Overview State row, the modal header pill, the closed
reply check) resolve stage through ONE authority, resolvedStage -> boardViewStage: the server view's
stage for a card the view holds, else the record's own base. No surface re-derives sent/opened/replied
from the local stores. A manifest card absent from the view renders ready or draft in BOTH places, the
same answer, and the board card shows no reply glow or reply badge the lane denies.

Engine-independent (the final glyphs and WebKit are Thyab's device gate): this asserts the resolved
stage the two surfaces compute is the SAME string, and that the on-board reply decorations follow the
resolved lane. Fails-when-broken: route the detail back through effStage and the Ludic card's detail
reads 'replied' while its lane reads 'live' -- the agreement check below goes red."""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

# ---- source guards: the one authority, routed into every detail-stage read -------------------------
app = open(f"{ROOT}/library/app.js", encoding="utf-8").read()
ck("resolvedStage is the one authority and delegates to the board's boardViewStage",
   "function resolvedStage(o){ return boardViewStage(o); }" in app and "window.resolvedStage=resolvedStage" in app)
ck("the Overview State row reads the one authority, not the local re-derivation",
   "const st=resolvedStage(o);" in app and "mw-state-'+esc(st)" in app)
ck("the modal header pill reads the one authority",
   "const st=rec? resolvedStage(rec) : \"\";" in app)
ck("the closed-reply reopen check reads the one authority",
   "var st=resolvedStage(o);" in app)
ck("no detail-stage badge still reads effStage directly (the second source is retired from the detail)",
   "const st=effStage(o);" not in app and "const st=rec? effStage(rec)" not in app)
ck("no em dash / zero-Lotus in the touched source", "\u2014" not in app and "lotus" not in app.lower())

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

# Ludic: a manifest card with real local activity (a send, an open, a reply) but NO board-view row.
# effStage over these stores would return 'replied'; the board's baseStage returns 'live' (ready), because
# the card is published and absent from the view. That is the exact two-source contradiction.
SEED = r"""
(() => {
  const set=(k,v)=>{ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} };
  set('thrive_opps_v1', [
    { slug:'ludic-lillian', business:'Ludic Lillian', published:true, up:1 },
    { slug:'madar', business:'Madar', published:true, up:1 }
  ]);
  set('thrive_mail_v1', [
    { mid:'l1', opp:'ludic-lillian', to:'lil@ludic.example', subject:'Hello', status:'sent', direction:'out', ts:'2026-08-01T10:00:00Z' },
    { mid:'m1', opp:'madar', to:'head@madar.example', subject:'Marhaba', status:'sent', direction:'out', ts:'2026-08-01T10:00:00Z' }
  ]);
  set('thrive_hits_v1', [
    { type:'open', slug:'ludic-lillian', ts:'2026-08-02T10:00:00Z', vid:'v1' }
  ]);
  set('thrive_inbound_v1', [
    { gid:'lr1', opp:'ludic-lillian', kind:'reply', from:'lil@ludic.example', subject:'Re: Hello', snippet:'yes please', ts:'2026-08-03T09:00:00Z' }
  ]);
})()
"""

def open_board(pg):
    pg.goto(f"{base}/library/console.html")
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn")
    pg.wait_for_function("()=>typeof window.thriveBoardRefresh==='function' && typeof window.__boardViewSet==='function' && typeof window.thriveModal==='object'", timeout=15000)
    pg.evaluate("(s)=>{ eval(s); }", SEED)
    pg.evaluate("()=>{ location.hash='#board'; }")
    # The view holds ONLY madar (stage opened). Ludic is deliberately absent: it has no console_opps row,
    # so no console_board row, so the board reads its own base for it.
    pg.evaluate("""()=>window.__boardViewSet([
      {slug:'madar', stage:'opened', open_count:1, replied:false, idle_days:1, has_page:true, has_email:false, archived:false}
    ])""")
    pg.evaluate("()=>window.thriveBoardRefresh&&window.thriveBoardRefresh()")
    pg.wait_for_function("""()=>!!document.querySelector('#boardLanes .tok[data-slug=\\"ludic-lillian\\"]') && !!document.querySelector('#boardLanes .tok[data-slug=\\"madar\\"]')""", timeout=8000)

# Read a card's board lane and its DETAIL stage (Overview State class + header pill class), then compare.
PROBE = r"""
async (slug) => {
  const tok = document.querySelector('#boardLanes .tok[data-slug="'+slug+'"]');
  const lane = tok ? tok.getAttribute('data-lane') : null;
  const hasReply = tok ? tok.classList.contains('has-reply') : null;
  const badge = tok ? !!tok.querySelector('.tok-replies') : null;
  window.thriveModal.open(slug, 'overview', slug);
  await new Promise(r=>setTimeout(r, 250));
  const ov = document.getElementById('modalOverview');
  const sEl = ov ? ov.querySelector('.mw-state') : null;
  let ovStage = '';
  if (sEl) { (sEl.className.match(/mw-state-(\w+)/)||[]).forEach((m,i)=>{ if(i===1) ovStage=m; }); }
  const pill = document.getElementById('modalState');
  let pillStage = '';
  if (pill) { (pill.className.match(/mw-state-(\w+)/)||[]).forEach((m,i)=>{ if(i===1) pillStage=m; }); }
  try { window.thriveModal.close && window.thriveModal.close(); } catch(e){}
  return { lane, hasReply, badge, ovStage, pillStage };
}
"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page(viewport={"width": 1280, "height": 900})
    open_board(pg)

    # ---- ACCEPTANCE 1: Ludic's lane and its detail agree (ready everywhere, never opened/replied) ----
    lud = pg.evaluate(PROBE, "ludic-lillian")
    ck("Ludic (absent from the view) is 'live' (ready) on the board, from its own has_page, not re-derived",
       lud["lane"]=="live", lud)
    ck("Ludic's Overview State row equals its board lane (the one authority, not effStage's 'replied')",
       lud["ovStage"]==lud["lane"], lud)
    ck("Ludic's modal header pill equals its board lane",
       lud["pillStage"]==lud["lane"], lud)
    ck("Ludic shows NO reply glow on the board (the lane denies a reply, so no second store paints one)",
       lud["hasReply"] is False, lud)
    ck("Ludic shows NO reply-count badge on the board (gated on the resolved lane)",
       lud["badge"] is False, lud)

    # ---- ACCEPTANCE 2: a card the view holds reads the view's stage in BOTH surfaces ----
    mad = pg.evaluate(PROBE, "madar")
    ck("Madar (held by the view) is 'opened' on the board, from the server view",
       mad["lane"]=="opened", mad)
    ck("Madar's Overview State row equals its board lane ('opened')",
       mad["ovStage"]==mad["lane"]=="opened", mad)
    ck("Madar's modal header pill equals its board lane ('opened')",
       mad["pillStage"]==mad["lane"]=="opened", mad)

    # ---- ACCEPTANCE 5 (stability): ten refreshes, the resolved lane never drifts ----
    lanes = pg.evaluate("""async ()=>{
      const out=[];
      for(let i=0;i<10;i++){
        await window.thriveBoardRefresh();
        const l=s=>{ const t=document.querySelector('#boardLanes .tok[data-slug="'+s+'"]'); return t?t.getAttribute('data-lane'):null; };
        out.push(l('ludic-lillian')+'/'+l('madar'));
      }
      return out;
    }""")
    ck("ten refreshes are identical: the resolved lane never oscillates",
       len(set(lanes))==1 and lanes[0]=="live/opened", lanes)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL ONE-STAGE-SOURCE CHECKS PASS"))
raise SystemExit(1 if fails else 0)
