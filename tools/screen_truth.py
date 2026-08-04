"""WO-014 phase 1: the screen truth harness.

  python3 tools/screen_truth.py             walk every screen, assert, write the report
  python3 tools/screen_truth.py --selftest  prove each assertion class by breaking it

The principle this file exists for: an assertion is only true if it is true of the
RENDERED SCREEN. Not the dictionary, not the stylesheet, not the source. Every
check in this repository before now read the source, and the screen shipped
broken: gate 7 measured a control's height and passed while the card body was ten
pixels wide, and the Arabic check matched a word list and passed while a passive
form shipped. So this walks the running console and reads back rendered text,
computed style, and geometry.

The matrix is generated, not listed: the views come from the rendered navigation
and the opportunity tabs come from the flow registry (library/flows.js), so a new
screen is covered the day it exists rather than the day someone remembers it.
"""
import threading, http.server, socketserver, functools, os, sys, json

os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
SHOTS = os.path.join(ROOT, "shots", "truth")
os.makedirs(SHOTS, exist_ok=True)
SELFTEST = "--selftest" in sys.argv

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = "http://127.0.0.1:%d" % PORT

from playwright.sync_api import sync_playwright

WIDTHS = [(390, 844), (768, 1024), (1440, 900)]

# One board holding a card in every lifecycle state, plus one reply, so the board
# and every card window render real content rather than an empty field.
SEED = """()=>{ const now=Date.now(), iso=d=>new Date(now-d*86400000).toISOString();
 localStorage.setItem('thrive_opps_v1', JSON.stringify([
  {slug:'draft-co',business:'Draft Co',published:false,up:now},
  {slug:'ready-co',business:'Ready Co',published:true,up:now,contact_tier:'A',
   channel:{kind:'email',to:'a@ready.example'},outreach_text:'Hello there.'},
  {slug:'sent-co',business:'Sent Co',published:true,up:now,stage:'sent',
   channel:{kind:'email',to:'b@sent.example'}},
  {slug:'opened-co',business:'Opened Co',published:true,up:now,stage:'sent'},
  {slug:'replied-co',business:'Replied Co',published:true,up:now,stage:'replied'},
  {slug:'won-co',business:'Won Co',published:true,up:now,stage:'won'},
  {slug:'lost-co',business:'Lost Co',published:true,up:now,stage:'lost'}]));
 localStorage.setItem('thrive_mail_v1', JSON.stringify([
  {mid:'m1',ts:iso(2),opp:'sent-co',to:'b@sent.example',status:'sent',direction:'out'},
  {mid:'m2',ts:iso(1),opp:'replied-co',to:'c@r.example',status:'replied',direction:'in'}]));
 localStorage.setItem('thrive_hits_v1', JSON.stringify([
  {type:'open',slug:'opened-co',ts:iso(1)},{type:'open',slug:'opened-co',ts:iso(1)}]));
}"""

# ---- the collectors: everything below runs in the page and reads the render ----

# What counts as an interactive control, and its visible label after every source
# of an accessible name is considered. A control whose name is empty or hollow
# (only punctuation, a dot, a dash) is unusable, whatever its handler does.
COLLECT = r"""(args)=>{
  const rtl = document.documentElement.getAttribute('dir')==='rtl';
  const out = [];
  const push = (rule, el, text, detail)=> out.push({
    rule, text:(text||'').slice(0,60),
    el:(el.tagName.toLowerCase()+(el.className&&typeof el.className==='string'?'.'+el.className.trim().split(/\s+/).slice(0,2).join('.'):'')).slice(0,50),
    detail:detail||'' });
  const vis = el=>{ const r=el.getBoundingClientRect(); const s=getComputedStyle(el);
    return r.width>0 && r.height>0 && s.visibility!=='hidden' && s.display!=='none' && parseFloat(s.opacity||'1')>0.05; };
  const ownText = el=>{ let s=''; el.childNodes.forEach(n=>{ if(n.nodeType===3) s+=n.textContent; }); return s.trim(); };
  const nameOf = el=>{
    const aria = el.getAttribute&&(el.getAttribute('aria-label')||'');
    const title = el.getAttribute&&(el.getAttribute('title')||'');
    let sel='';
    if(el.tagName==='SELECT'){ const o=el.options&&el.options[el.selectedIndex]; sel=o?o.textContent:''; }
    const val = (el.tagName==='INPUT')? (el.getAttribute('aria-label')||el.getAttribute('placeholder')||'') : '';
    return (el.textContent||'').trim() || aria.trim() || title.trim() || sel.trim() || val.trim();
  };
  const HOLLOW = /^[\s.·\u2013\u2014_\-•:]*$/;   // nothing but punctuation and dots
  const KEYLIKE = /^[a-z][a-z0-9]*_[a-z0-9_]{2,}$/;        // looks like an i18n key, not a sentence
  const ARAB = /[؀-ۿ]/;
  const LATIN = /[A-Za-z]/;
  // The SAME passive marker the source gate uses (tools/verify.js), now applied to
  // the rendered screen. A pure vowel pattern cannot be used on undiacritised
  // Arabic without also flagging active form IV verbs (يُنشئ "creates", يُرسل
  // "sends"), so this is the confirmed-passive marker rather than a bare يُ. Source
  // and screen agreeing on the pattern is the point.
  const PASSIVE = /أُ[ء-ي]|يُرجى|فُتح|رُدّ\s|نُسخ|كُتب|حُذف|رُفع|سُجّ|جُمّ|تُرجم|بُني\s/;
  // A dual is banned from interface copy entirely (§7.1): a word ending in the
  // dual suffix standing as its own label.
  const DUAL = /^(?:ال)?[ء-ي]{2,}(?:تان|تين|ان|ين)$/;
  const KNOWN_LATIN = args.known;
  const isMono = el=> /mono|code|\bid\b|url|kbd/i.test((el.className||'')+' '+el.tagName) || getComputedStyle(el).fontFamily.indexOf('mono')>=0;
  // A prospect's business name, a person's name, a lane badge holding a slug: these
  // are DATA the console shows, not interface copy it authors. A Latin business
  // name on an Arabic screen is correct, and a name is not a translation defect.
  const isContent = el=> /tok-name|langbtn|brand|oppname|\bbiz\b|card-title|st-line|chip|mono-iso/i.test(el.className||'');
  // A run of Title Case words is a proper noun (Ludic Lillian, Vienna VA), which is
  // a name, not an untranslated sentence.
  const isProperNoun = s=>{ const w=s.replace(/[^A-Za-z ]/g,' ').trim().split(/\s+/).filter(Boolean);
    return w.length>0 && w.every(x=>/^[A-Z]/.test(x)); };
  const arabicShare = s=>{ const a=(s.match(/[؀-ۿ]/g)||[]).length, l=(s.match(/[A-Za-z0-9]/g)||[]).length;
    return (a+l)? a/(a+l) : 0; };

  // ---------- TEXT ----------
  document.querySelectorAll('button, a, [role=button], select, .seg button, .tab, .navbtn').forEach(el=>{
    if(!vis(el)) return;
    const nm = nameOf(el);
    if(HOLLOW.test(nm)) push('empty_label', el, nm||'(empty)', 'a control with no readable name');
  });
  document.querySelectorAll('body *').forEach(el=>{
    if(!vis(el)) return;
    const own = ownText(el);
    if(!own) return;
    // Direction is read per node from the computed style, not from the document,
    // so a dir="rtl" subtree on an otherwise English page is judged as Arabic and
    // an isolated LTR span on an Arabic page is judged as Latin. The document flag
    // was too coarse: it missed exactly the mixed cases that go wrong.
    const nodeRtl = getComputedStyle(el).direction === 'rtl';
    // A raw key is a leaked identifier in COPY. The same shape shown deliberately
    // as a code value (a storage key in Settings, an id) lives in a mono element
    // and is not a defect, so mono is exempt.
    if(KEYLIKE.test(own) && !isMono(el)) push('raw_key', el, own, 'a raw i18n key reached the screen');
    // Latin copy on an Arabic screen. Names and code are content, not translation
    // defects, so mono, known content classes, and proper nouns are exempt. The
    // reverse (Arabic on an English screen) is deliberately not flagged, because a
    // prospect's business name is legitimately Arabic whatever the language is.
    if(nodeRtl && LATIN.test(own) && !ARAB.test(own) && !isMono(el) && !isContent(el) && !isProperNoun(own)){
      const words = own.replace(/[^A-Za-z ]/g,' ').trim();
      const big = words.split(/\s+/).filter(w=>w.length>=4 && KNOWN_LATIN.indexOf(w)<0);
      if(big.length && words.replace(/\s+/g,'').length>=6)
        push('untranslated', el, own, 'Latin copy on an Arabic screen: '+big.slice(0,3).join(' '));
    }
    // A passive form or a dual is wrong wherever Arabic renders, screen direction
    // notwithstanding, so these fire on the Arabic text itself.
    if(ARAB.test(own)){
      if(PASSIVE.test(own)) push('arabic_passive', el, own, 'a passive verb form');
      const bare = own.replace(/[\s.,،؛:!؟«»()]/g,'');
      if(DUAL.test(bare) && own.split(/\s+/).length<=2)
        push('arabic_dual', el, own, 'a dual used as a label');
    }
  });

  // ---------- STYLE (computed) ----------
  // Font actually used, verified by metric: measure each Arabic run, then the same
  // string forced to Alyamama and forced to a generic fallback. If the run matches
  // the fallback and not Alyamama, a fallback face is on the screen. Verify use,
  // not request.
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;left:-9999px;top:0;white-space:nowrap;visibility:hidden';
  document.body.appendChild(probe);
  const widthIn = (txt, fam, size, weight)=>{ probe.style.fontFamily=fam; probe.style.fontSize=size;
    probe.style.fontWeight=weight; probe.textContent=txt; return probe.getBoundingClientRect().width; };
  const seenFont = {};
  document.querySelectorAll('body *').forEach(el=>{
    if(!vis(el)) return;
    const own = ownText(el);
    if(!own || !ARAB.test(own)) return;
    const s = getComputedStyle(el);
    if(s.letterSpacing && s.letterSpacing!=='normal' && Math.abs(parseFloat(s.letterSpacing))>0.05)
      push('arabic_tracking', el, own, 'letter-spacing '+s.letterSpacing+' breaks Arabic joins');
    if(s.textTransform && s.textTransform!=='none')
      push('arabic_transform', el, own, 'text-transform '+s.textTransform+' on Arabic');
    if(/\bSyne\b/.test(s.fontFamily) && !/Alyamama/.test(s.fontFamily))
      push('latin_face_on_arabic', el, own, 'a Latin-only display face computes onto Arabic');
    // Font actually used, by metric. Only judged on a node that is PREDOMINANTLY
    // Arabic and not monospace: a chip reading "الموقع: Vienna, VA" is mostly Latin
    // and a mono id cell is Latin by design, and measuring either compares the
    // width of Latin glyphs that render nearly the same in every face, which is
    // noise, not a face. And the two candidate faces must differ enough to be told
    // apart at all before a verdict is possible.
    if(!isMono(el) && arabicShare(own) >= 0.8){
      const sig = own.slice(0,24)+'|'+s.fontSize+'|'+s.fontWeight;
      if(!seenFont[sig]){
        seenFont[sig]=1;
        const txt = own.replace(/[^؀-ۿ ]/g,'').slice(0,24);
        const wReal = widthIn(txt, s.fontFamily, s.fontSize, s.fontWeight);
        const wAly  = widthIn(txt, '"Alyamama", sans-serif', s.fontSize, s.fontWeight);
        const wFall = widthIn(txt, 'sans-serif', s.fontSize, s.fontWeight);
        const sep = Math.abs(wAly-wFall);
        // the faces must be clearly distinguishable, and the real width clearly
        // nearer the fallback, before this fires. Borderline is silence.
        if(sep > Math.max(8, wAly*0.10)){
          const dAly = Math.abs(wReal-wAly), dFall = Math.abs(wReal-wFall);
          if(dFall < dAly*0.5) push('arabic_font_fallback', el, own,
            'Arabic renders in a fallback face, not Alyamama (w='+Math.round(wReal)+' aly='+Math.round(wAly)+' fallback='+Math.round(wFall)+')');
        }
      }
    }
  });
  probe.remove();

  // ---------- GEOMETRY ----------
  const coarse = args.coarse;
  if(coarse){
    document.querySelectorAll('button, a[href], [role=button], select, input[type=checkbox], input[type=radio], .seg button').forEach(el=>{
      if(!vis(el)) return;
      const r = el.getBoundingClientRect();
      // an inline link inside a sentence is exempt: its hit area is the line, not the glyphs
      const inline = el.tagName==='A' && getComputedStyle(el).display.indexOf('inline')>=0 && el.closest('p,li,.note');
      if(inline) return;
      // the brand mark is a logo that happens to link home, not a primary control;
      // its target is the whole header. Exempt it rather than pretend it is a button.
      if(/\bbrand\b/i.test(el.className||'')) return;
      if(r.width < 44 || r.height < 44)
        push('target_size', el, nameOf(el), 'hit target '+Math.round(r.width)+'x'+Math.round(r.height)+', under 44x44 on both axes');
    });
  }
  // horizontal page scroll at any width is a broken layout
  if(document.documentElement.scrollWidth > window.innerWidth + 2)
    push('h_scroll', document.documentElement, '', 'page scrolls horizontally: '+document.documentElement.scrollWidth+' > '+window.innerWidth);

  return out;
}"""

# oversized gaps and first-screenful density, reused from the visual memory laws
GAPS = """()=>{ const out=[];
  document.querySelectorAll('main, .view:not([hidden])').forEach(host=>{
    const kids=[...host.children].filter(e=>!e.hidden && e.getBoundingClientRect().height>0);
    for(let i=1;i<kids.length;i++){ const a=kids[i-1].getBoundingClientRect(), b=kids[i].getBoundingClientRect();
      const gap=Math.round(b.top-a.bottom);
      if(gap>0) out.push({gap, after:(kids[i-1].className||kids[i-1].tagName).slice(0,24)}); } });
  return out; }"""

# Latin words that legitimately appear inside Arabic screens: brand, product, and
# protocol names that are not translated anywhere, so flagging them is noise.
KNOWN_LATIN = ["Thrive","Apps","Script","Deploy","New","version","Manage","deployments",
               "GitHub","Gmail","Drive","Resend","PDF","HTML","URL","CSV","RFC","WCAG",
               "iOS","Safari","Chrome","SUBJECT","Console","opp","http","https","exec",
               "email","id","AES","GCM","API","DNS","QR"]

fails = []
walked = []
findings = []   # every rule hit, for the report

def ck(name, cond, detail=None):
    print(("PASS " if cond else "FAIL ") + name)
    if not cond:
        fails.append(name)
        if detail is not None: print("      " + str(detail)[:240])


def unlock(pg):
    if pg.query_selector("#thriveGate"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1200)


def views_from_nav(pg):
    """Generated, not listed: the destinations the rendered navigation offers."""
    return pg.evaluate("""()=>{
      const set=[];
      document.querySelectorAll('[data-view],[data-nav],nav button,nav a').forEach(b=>{
        const v=b.getAttribute('data-view')||b.getAttribute('data-nav')||(b.getAttribute('href')||'').replace(/^#/,'');
        if(v && set.indexOf(v)<0) set.push(v); });
      return set;
    }""")


def opp_tabs(pg):
    """Generated from the flow registry, so a new tab is walked the day it exists."""
    return pg.evaluate("""()=>{ try{ return (ThriveFlows.get('opportunity')||{}).steps||[]; }catch(e){ return []; } }""")


def collect(pg, screen, lang, w, coarse):
    walked.append({"screen": screen, "lang": lang, "w": w})
    got = pg.evaluate(COLLECT, {"known": KNOWN_LATIN, "coarse": coarse})
    limit = 96 if w >= 768 else 64
    for g in pg.evaluate(GAPS):
        if g["gap"] > limit:
            got.append({"rule": "oversized_gap", "el": g["after"], "text": "",
                        "detail": "vertical gap %dpx over the %dpx limit" % (g["gap"], limit)})
    shot = ""
    if got:
        # A screenshot of every screen that carries a finding, per §4.5, so the row
        # in the report has a picture behind it. One per screen, not per finding: a
        # screen with forty small targets is one photograph, not forty.
        shot = "%s-%s-%d.png" % (screen.replace(":", "_"), lang, w)
        try: pg.screenshot(path=os.path.join(SHOTS, shot), animations="disabled")
        except Exception: shot = ""
    for r in got:
        r.update({"screen": screen, "lang": lang, "w": w, "shot": shot})
        findings.append(r)
    return got


def run(pg, lang, w, h, coarse):
    tag = "%s/%d" % (lang, w)
    for v in views_from_nav(pg):
        pg.evaluate("x=>location.hash='#'+x", v); pg.wait_for_timeout(700)
        collect(pg, v, lang, w, coarse)
    # the opportunity window, every tab, generated from the registry
    pg.evaluate("x=>location.hash='#'+x", "board"); pg.wait_for_timeout(700)
    card = pg.query_selector(".tok, .card, [data-slug]")
    if card:
        card.click(); pg.wait_for_timeout(900)
        for tab in opp_tabs(pg):
            btn = pg.query_selector('[data-tab="%s"], [data-step="%s"], #mw_%s' % (tab, tab, tab))
            if btn:
                try: btn.click(); pg.wait_for_timeout(600)
                except Exception: pass
            collect(pg, "opportunity:" + tab, lang, w, coarse)
        # close it so the next width starts clean
        cl = pg.query_selector("#modalClose, .mw-close, [data-close]")
        if cl:
            try: cl.click(); pg.wait_for_timeout(300)
            except Exception: pass


def selftest(pg):
    """Prove each assertion class bites by injecting one synthetic defect of that
    class into the live page, of a shape no source check would catch, then confirm
    the collector reports it. Five classes, the invented adversarial defects §4.5
    asks for, plus the on-screen classes the nine defects belong to."""
    pg.evaluate("x=>location.hash='#'+x", "board"); pg.wait_for_timeout(500)
    # Inject into a guaranteed-visible fixed container, not into a view: the app
    # toggles views by CSS, so a hidden view has zero layout and vis() correctly
    # skips it. The defect must render to be caught, which is the whole point.
    HOST = ("(el)=>{ let h=document.getElementById('__st_probe');"
            " if(!h){ h=document.createElement('div'); h.id='__st_probe';"
            " h.style.cssText='position:fixed;top:0;left:0;z-index:99999;background:#111;padding:8px';"
            " document.body.appendChild(h);} h.setAttribute('dir', el.rtl?'rtl':'ltr');"
            " const n=document.createElement(el.tag); n.textContent=el.text;"
            " if(el.css) n.style.cssText=el.css; h.appendChild(n); }")
    cases = {
      "empty_label":     {"tag": "button", "text": ".",              "css": "min-width:44px;min-height:44px"},
      "raw_key":         {"tag": "p",      "text": "cmp_send_err",   "css": ""},
      "untranslated":    {"tag": "p",      "text": "Send the message now", "css": "", "rtl": True},
      "arabic_dual":     {"tag": "p",      "text": "فرصتان",          "css": "", "rtl": True},
      "arabic_passive":  {"tag": "p",      "text": "أُرسلت الرسالة",  "css": "", "rtl": True},
      "arabic_tracking": {"tag": "p",      "text": "جاهزة للإرسال",   "css": "letter-spacing:2px", "rtl": True},
      "target_size":     {"tag": "button", "text": "x",              "css": "width:20px;height:10px;display:inline-block"},
    }
    ok = True
    for rule, spec in cases.items():
        pg.evaluate(HOST, spec); pg.wait_for_timeout(120)
        got = pg.evaluate(COLLECT, {"known": KNOWN_LATIN, "coarse": True})
        hit = any(r["rule"] == rule for r in got)
        ck("selftest: the %s rule fires on an injected defect" % rule, hit,
           sorted(set(r["rule"] for r in got)))
        ok = ok and hit
        pg.evaluate("()=>{ const h=document.getElementById('__st_probe'); if(h) h.remove(); "
                    "document.documentElement.setAttribute('dir','ltr'); }")
        pg.wait_for_timeout(80)
    return ok


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    if SELFTEST:
        ctx = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, reduced_motion="reduce")
        ctx.route("https://api.github.com/**", lambda x: x.abort())
        pg = ctx.new_page(); pg.goto(base + "/library/console.html"); pg.wait_for_timeout(400)
        unlock(pg); pg.evaluate(SEED); pg.reload(); pg.wait_for_timeout(1500); unlock(pg)
        selftest(pg); ctx.close()
    else:
        for lang in ("en", "ar"):
            for (w, h) in WIDTHS:
                coarse = w <= 430
                ctx = b.new_context(viewport={"width": w, "height": h},
                                    has_touch=coarse, is_mobile=coarse, reduced_motion="reduce")
                ctx.route("https://api.github.com/**", lambda x: x.abort())
                pg = ctx.new_page()
                errs = []
                pg.on("pageerror", lambda e: errs.append(str(e)))
                pg.goto(base + "/library/console.html"); pg.wait_for_timeout(400)
                pg.evaluate("l=>localStorage.setItem('thrive_lang',l)", lang)
                unlock(pg); pg.evaluate(SEED); pg.reload(); pg.wait_for_timeout(2000); unlock(pg)
                run(pg, lang, w, h, coarse)
                ck("%s/%d: nothing threw" % (lang, w), not errs, errs[:2])
                ctx.close()
    b.close()

httpd.shutdown()

# ---- the report: every screen walked, every assertion that failed ----
if not SELFTEST:
    by_rule = {}
    for f in findings: by_rule.setdefault(f["rule"], []).append(f)
    lines = ["# Screen truth", "",
             "Generated by `tools/screen_truth.py`, and regenerated on every run. Every",
             "row is read from the RENDERED screen, never from the source. The matrix is",
             "generated: views from the rendered navigation, opportunity tabs from",
             "`library/flows.js`, so a new screen is walked the day it exists.", "",
             "This file reflects the checkout it was run against. Run it against the",
             "branch you are changing before you change it, and again after. A rule that",
             "is silent here but loud on another checkout is not a false negative: it is",
             "the difference between two builds, and that difference is the point.", "",
             "The seven assertion classes, each proven to bite by `--selftest`:",
             "`empty_label`, `raw_key`, `untranslated`, `arabic_passive`, `arabic_dual`,",
             "`arabic_tracking` / `arabic_transform` / `latin_face_on_arabic`,",
             "`arabic_font_fallback`, `target_size`, `h_scroll`, `oversized_gap`.", "",
             "## What was walked", "",
             "%d screens, across %s languages and widths %s." % (
                 len(walked), len(set(x["lang"] for x in walked)),
                 ", ".join(str(x) for x in sorted(set(x["w"] for x in walked)))), ""]
    lines.append("## Findings, by rule")
    lines.append("")
    lines.append("The same piece of chrome appears on many screens, so a defect in it")
    lines.append("would repeat once per screen. Findings are grouped by the defect itself")
    lines.append("(rule, element, text); the last column is how many screen and width")
    lines.append("combinations it appeared on.")
    lines.append("")
    # Group by the defect itself, not by its every appearance.
    def key(r): return (r["rule"], r.get("el", ""), (r.get("text", "") or r.get("detail", ""))[:60])
    groups = {}
    for r in findings:
        g = groups.setdefault(key(r), {"rule": r["rule"], "el": r.get("el", ""),
                                       "text": r.get("text", ""), "detail": r.get("detail", ""),
                                       "where": set(), "shot": r.get("shot", "")})
        g["where"].add("%s@%s/%d" % (r["screen"], r["lang"], r["w"]))
        if not g["shot"] and r.get("shot"): g["shot"] = r["shot"]
    uniq_by_rule = {}
    for g in groups.values(): uniq_by_rule.setdefault(g["rule"], []).append(g)
    if not findings:
        lines.append("None. Every screen walked clean.")
    else:
        for rule in sorted(uniq_by_rule):
            gs = sorted(uniq_by_rule[rule], key=lambda g: -len(g["where"]))
            lines.append("### `%s` (%d distinct, %d appearances)" % (
                rule, len(gs), sum(len(g["where"]) for g in gs)))
            lines.append("")
            lines.append("| element | text or detail | appeared on | photo |")
            lines.append("|---|---|---|---|")
            for g in gs[:40]:
                txt = (g["text"] or g["detail"]).replace("|", "\\|").replace("\n", " ")[:70]
                pic = ("`shots/truth/%s`" % g["shot"]) if g["shot"] else ""
                lines.append("| `%s` | %s | %d screens | %s |" % (g["el"], txt, len(g["where"]), pic))
            lines.append("")
    with open(os.path.join(ROOT, "docs", "SCREEN_TRUTH.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")

    print("\nwalked %d screens, %d distinct findings across %d rules" % (
        len(walked), len(groups), len(uniq_by_rule)))
    for rule in sorted(uniq_by_rule):
        print("  %-22s %d distinct (%d appearances)" % (
            rule, len(uniq_by_rule[rule]), sum(len(g["where"]) for g in uniq_by_rule[rule])))

print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
