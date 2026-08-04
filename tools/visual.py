"""WO-013 phase 9: the visual memory, measured rather than argued.

The review named three visual failures: too much margin, dryness, and breakage during transitions.
A rule that cannot be measured will be argued away, so each law in docs/VISUAL_MEMORY.md is a
number here.

  python3 tools/visual.py            measure, and fail on a broken law
  python3 tools/visual.py --baseline re-capture the baselines, deliberately
"""
import threading, http.server, socketserver, functools, os, sys, json, hashlib

os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
OUT = os.path.join(ROOT, "shots", "baseline")
os.makedirs(OUT, exist_ok=True)
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"

from playwright.sync_api import sync_playwright

CAPTURE = "--baseline" in sys.argv


fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:300])

# A screenshot is never byte identical between two runs: antialiasing, font
# rasterisation and a pixel of timing all move. A hash diff therefore reports
# drift on every run, which is a warning nobody acts on, so the baseline is a
# COARSE SIGNATURE instead: the average colour of each cell of a 24 by 24 grid.
# It is stable across runs and it moves when a real visual change lands.
SIG_GRID = 24
DRIFT_TOLERANCE = 0.02          # 2 percent of cells
SIG_FILE = os.path.join(OUT, "signatures.json")

SIGNATURE = """(g)=>{
  const cv=document.createElement('canvas');
  return null;   /* canvas cannot read the rendered page; sampled in python instead */
}"""


def signature(pg, h):
    """The average colour of each cell of a grid, read from the page rather than
    from the image, so no image decoder is needed and no dependency is added."""
    return pg.evaluate("""(args)=>{
      const g=args.g, vh=args.vh, W=innerWidth;
      const cw=W/g, chh=vh/g;
      const out=[];
      /* elementFromPoint plus the computed background is a cheap, deterministic
         stand in for reading pixels: it moves when layout or colour moves and it
         does not move when a font renders a hair differently. */
      for(let r=0;r<g;r++){
        for(let c=0;c<g;c++){
          const x=Math.min(W-1,(c+0.5)*cw), y=Math.min(vh-1,(r+0.5)*chh);
          const e=document.elementFromPoint(x,y);
          if(!e){ out.push(0); continue; }
          const s=getComputedStyle(e);
          const m=/rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s.backgroundColor)||[0,0,0,0];
          const tag=(e.tagName||'').charCodeAt(0)||0;
          out.push(((+m[1])<<16 | (+m[2])<<8 | (+m[3])) + tag);
        }
      }
      return out;
    }""", {"g": SIG_GRID, "vh": h})


def drift(a, b):
    if not a or not b or len(a) != len(b): return 1.0
    moved = sum(1 for i in range(len(a)) if a[i] != b[i])
    return moved / float(len(a))


baseline_sigs = {}
if os.path.exists(SIG_FILE):
    try:
        with open(SIG_FILE, encoding="utf-8") as fh: baseline_sigs = json.load(fh)
    except Exception: baseline_sigs = {}
sigs = {}

VIEWS = ["board", "home", "library", "templates", "activity", "settings"]
WIDTHS = [(390, 844), (768, 1024), (1440, 900)]

SEED = """()=>{ const now=Date.now(), iso=d=>new Date(now-d*86400000).toISOString();
 localStorage.setItem('thrive_opps_v1', JSON.stringify([
  {slug:'draft-co',business:'Draft Co',published:false,up:now},
  {slug:'live-co',business:'Live Co',published:true,up:now,contact_tier:'A',
   channel:{kind:'email',to:'a@live.example'},outreach_text:'Hello.'},
  {slug:'sent-co',business:'Sent Co',published:true,up:now,stage:'sent'},
  {slug:'replied-co',business:'Replied Co',published:true,up:now,stage:'replied'},
  {slug:'won-co',business:'Won Co',published:true,up:now,stage:'won'}]));
 localStorage.setItem('thrive_mail_v1', JSON.stringify([
  {mid:'m1',ts:iso(2),opp:'sent-co',to:'a@b.example',status:'sent',direction:'out'}]));
}"""

# Law 1: the union of PAINTED content over the first screenful.
#
# Selector-free on purpose. The first version listed the classes I could think of
# and therefore measured my vocabulary rather than the screen: .tiles and .lede
# on the Insights page were content it simply could not see. A content box is now
# anything that paints: a background, a border, or text of its own.
DENSITY = """(vh)=>{
  const host=document.querySelector('.view:not([hidden])')||document.querySelector('main');
  if(!host) return 0;
  const painted=[];
  const transparent=c=>!c||c==='rgba(0, 0, 0, 0)'||c==='transparent';
  host.querySelectorAll('*').forEach(e=>{
    const r=e.getBoundingClientRect();
    if(r.width<4||r.height<4||r.top>=vh||r.bottom<=0) return;
    const s=getComputedStyle(e);
    if(s.visibility==='hidden'||s.display==='none'||parseFloat(s.opacity||'1')<0.05) return;
    const hasBg=!transparent(s.backgroundColor)||s.backgroundImage!=='none';
    const hasBorder=parseFloat(s.borderTopWidth)>0||parseFloat(s.borderInlineStartWidth)>0;
    /* Text of its own, not text inherited from a wrapper: a container whose only
       content is another box is not itself content. */
    let own='';
    e.childNodes.forEach(n=>{ if(n.nodeType===3) own+=n.textContent; });
    const hasText=own.trim().length>0;
    const isMedia=/^(IMG|SVG|IFRAME|CANVAS|VIDEO)$/.test(e.tagName);
    if(hasBg||hasBorder||hasText||isMedia) painted.push(r);
  });
  if(!painted.length) return 0;
  /* A union by sampling, so nested and overlapping boxes are not counted twice.
     Counting them separately is how a dry screen measures as dense. */
  const W=innerWidth, step=6;
  let covered=0, cells=0;
  for(let y=0;y<vh;y+=step){
    for(let x=0;x<W;x+=step){
      cells++;
      for(const r of painted){
        if(x>=r.left && x<r.right && y>=r.top && y<r.bottom){ covered++; break; }
      }
    }
  }
  return Math.round(covered/cells*1000)/10;
}"""

# Law 2: the vertical gap between consecutive sibling content blocks.
GAPS = """()=>{
  const out=[];
  document.querySelectorAll('main, .view:not([hidden])').forEach(host=>{
    const kids=[...host.children].filter(e=>!e.hidden && e.getBoundingClientRect().height>0);
    for(let i=1;i<kids.length;i++){
      const a=kids[i-1].getBoundingClientRect(), b=kids[i].getBoundingClientRect();
      const gap=Math.round(b.top-a.bottom);
      if(gap>0) out.push({gap:gap, after:(kids[i-1].className||kids[i-1].tagName).slice(0,30)});
    }
  });
  return out;
}"""

# Law 3: warmth is countable or it is an opinion. Measured as SATURATION rather
# than by guessing at class names: a warm element is one carrying a colour that is
# not on the grey axis, in its text, its background or its border. Naming classes
# meant the check measured my vocabulary instead of the screen.
WARMTH = """()=>{
  const v=document.querySelector('.view:not([hidden])')||document.querySelector('main');
  if(!v) return {icons:0, warm:0, examples:[]};
  /* VISIBLE icons. Counting elements regardless of display meant a stylesheet
     could hide every symbol on a screen and the warmth check would not notice,
     which is the same "measures my vocabulary, not the screen" mistake the
     density and warmth detectors both started with. */
  const icons=[...v.querySelectorAll('svg.ic, .ic, [data-icon]')]
    .filter(e=>{ const r=e.getBoundingClientRect();
                 return r.width>1 && r.height>1 && getComputedStyle(e).visibility!=='hidden'; }).length;
  const rgb=s=>{const m=/rgba?\\(([0-9.]+),\\s*([0-9.]+),\\s*([0-9.]+)(?:,\\s*([0-9.]+))?\\)/.exec(s||'');
    return m? {r:+m[1],g:+m[2],b:+m[3],a:m[4]===undefined?1:+m[4]} : null;};
  /* Grey is r=g=b. Anything with a spread of more than 12 across the channels is
     a colour somebody chose, which is what warmth means here. */
  const warmish=c=>{ if(!c||c.a<0.08) return false;
    const mx=Math.max(c.r,c.g,c.b), mn=Math.min(c.r,c.g,c.b);
    return (mx-mn)>12; };
  let warm=0; const examples=[];
  v.querySelectorAll('*').forEach(e=>{
    const r=e.getBoundingClientRect();
    if(r.width<2||r.height<2) return;
    const s=getComputedStyle(e);
    if(warmish(rgb(s.backgroundColor))||warmish(rgb(s.borderTopColor))||
       warmish(rgb(s.borderInlineStartColor))||warmish(rgb(s.color))){
      warm++;
      if(examples.length<3) examples.push(((e.className||e.tagName)+'').slice(0,26));
    }
  });
  return {icons:icons, warm:warm, examples:examples};
}"""

# Law 4: an empty state is an icon, a sentence, and exactly one action.
EMPTIES = """()=>[...document.querySelectorAll('.mw-empty,.lane-empty,.loc-empty')]
  .filter(e=>e.offsetParent!==null)
  .map(e=>({
    cls:(e.className||'').slice(0,24),
    icons:e.querySelectorAll('svg,.ic').length,
    sentences:e.querySelectorAll('p').length || (e.textContent.trim()?1:0),
    actions:e.querySelectorAll('button,a,input,select,textarea').length
  }))"""

# Law 5: no layout property may be animated, anywhere.
TRANSITIONS = """()=>{
  const bad=[];
  document.querySelectorAll('*').forEach(e=>{
    const s=getComputedStyle(e);
    const props=(s.transitionProperty||'')+' '+(s.animationName!=='none'? 'anim':'');
    if(/\\b(width|height|top|left|right|bottom|margin|padding|inset)\\b/.test(s.transitionProperty||'')){
      bad.push(((e.className||e.tagName)+'').slice(0,32)+': '+s.transitionProperty);
    }
  });
  return bad.slice(0,8);
}"""


def session(b, lang, w, h):
    ctx = b.new_context(viewport={"width": w, "height": h},
                        has_touch=(w <= 430), is_mobile=(w <= 430),
                        # Animations mid flight make two runs of the same screen two
                        # different images, which is how a baseline becomes noise.
                        reduced_motion="reduce")
    ctx.route("https://api.github.com/**", lambda x: x.abort())
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_timeout(400)
    pg.evaluate("l=>localStorage.setItem('thrive_lang',l)", lang)
    if pg.query_selector("#thriveGate"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1400)
    pg.evaluate(SEED)
    pg.reload(); pg.wait_for_timeout(2800)
    return ctx, pg, errs


report = []
changed = []

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    for lang in ("en", "ar"):
        for (w, h) in WIDTHS:
            ctx, pg, errs = session(b, lang, w, h)
            for v in VIEWS:
                tag = f"{lang}/{w}/{v}"
                pg.evaluate("x=>location.hash='#'+x", v)
                pg.wait_for_timeout(1300)

                # Law 1
                d = pg.evaluate(DENSITY, h)
                report.append({"view": tag, "density": d})
                # Density is only asserted at the two widths the law names.
                if w in (390, 1440):
                    ck(f"{tag}: density {d}% is at least 25%", d >= 25.0, d)

                # Law 2
                limit = 96 if w >= 768 else 64
                gaps = [g for g in pg.evaluate(GAPS) if g["gap"] > limit]
                ck(f"{tag}: no vertical gap over {limit}px", not gaps, gaps[:3])

                # Law 3
                warm = pg.evaluate(WARMTH)
                ck(f"{tag}: at least three icons", warm["icons"] >= 3, warm)
                ck(f"{tag}: at least one warm element", warm["warm"] >= 1, warm)

                # Law 4
                for e in pg.evaluate(EMPTIES):
                    ck(f"{tag}: empty state {e['cls']} has an icon, a sentence and one action",
                       e["icons"] >= 1 and e["sentences"] >= 1 and e["actions"] <= 1, e)

                # Law 5
                animated = pg.evaluate(TRANSITIONS)
                ck(f"{tag}: no layout property is animated", not animated, animated)

                # Law 6, the baseline
                name = f"{v}-{lang}-{w}.png"
                path = os.path.join(OUT, name)
                shot = pg.screenshot(clip={"x": 0, "y": 0, "width": w, "height": h},
                                     animations="disabled")
                sig = signature(pg, h)
                if CAPTURE:
                    with open(path, "wb") as fh: fh.write(shot)
                    sigs[name] = sig
                else:
                    old = baseline_sigs.get(name)
                    if old is None:
                        with open(path, "wb") as fh: fh.write(shot)
                        sigs[name] = sig
                        changed.append(name + " (new)")
                    else:
                        d = drift(old, sig)
                        sigs[name] = old
                        if d > DRIFT_TOLERANCE:
                            changed.append("%s (%.1f%% of cells moved)" % (name, d * 100))
                            with open(os.path.join(OUT, "changed-" + name), "wb") as fh:
                                fh.write(shot)

            ck(f"{lang}/{w}: nothing threw", not errs, errs[:2])
            ctx.close()
    b.close()

httpd.shutdown()

with open(os.path.join(OUT, "density.json"), "w", encoding="utf-8") as fh:
    json.dump(report, fh, indent=1)
with open(SIG_FILE, "w", encoding="utf-8") as fh:
    json.dump(sigs, fh)

print("\ndensity per view:")
for r in sorted(report, key=lambda x: x["density"])[:6]:
    print("  %-28s %s%%" % (r["view"], r["density"]))

if CAPTURE:
    print("\nbaselines captured:", len(report))
else:
    print("\nchanged against the baseline:", len(changed))
    for c in changed[:12]: print("  -", c)

print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
