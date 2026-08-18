"""P18 · The universal contact model (R11), on the LIVE console surface.

Extraction fills the envelope, but before this the contact never reached the card: the send_to was not
wired onto the opportunity's channel field, and capture was email-only. R11 makes one channel list the
single source - {type,value,platform,handle,tier,tier_basis,source,primary} - and the Communication tab,
the composer and the Contact Book all read it through the SAME reader (contactChannels).

This drives the real card modal (window.thriveModal.open -> Communication tab) and the real composer
(compose.html?slug=), and proves:

  1. a research-stated email renders in the tab as a channel row with a Tier A chip whose basis reads
     "per research, confirm", a primary marker, and a one-tap Confirm; one tap flips the basis to
     sighted and the Confirm control goes away (never auto-upgraded).
  2. a card with a non-email primary (WhatsApp) lists every channel, offers no email path, and its
     composer To stays blank with the "not an email channel" note rather than sending to the wrong place.
  3. a legacy card that predates R11 (no channels[]) is read into the SAME shape by the one reader, so
     its email still appears in the tab - one model, no second store.
  4. the email-primary card's composer To resolves to exactly the primary email address.
  5. zero "no channel" cards among cards that carry a channel; the tab mirrors to RTL in Arabic with the
     Arabic tier/basis strings.

WebKit at device widths is Thyab's gate; this is engine-independent behaviour in Chromium.
"""
import threading, http.server, socketserver, functools, os, sys, json
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True; threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

def ch(type_, value, **kw):
    o = {"type": type_, "value": value, "platform": kw.get("platform", ""), "handle": kw.get("handle", ""),
         "tier": kw.get("tier", ""), "tier_basis": kw.get("tier_basis", ""),
         "source": kw.get("source", "research md"), "primary": kw.get("primary", False)}
    return o

# One research-stated email (the batch-13 shape): Tier A / stated, primary and the send target.
OPPS = [
    {"slug": "dripdocx", "business": "Drip Docx Wellness and Aesthetics", "published": True,
     "outreach_subject": "From press to booked chairs", "outreach_text": "Hi Narges. [LINK]",
     "channels": [ch("email", "info@dripdocx.com", tier="A", tier_basis="stated", primary=True)]},
    # A non-email primary: WhatsApp is the send road, no email exists. The composer must not invent one.
    {"slug": "bloom", "business": "Bloom Studio", "published": True,
     "channels": [ch("whatsapp", "https://wa.me/15552003040", tier="A", tier_basis="stated", primary=True),
                  ch("phone", "+15552003040", tier="A", tier_basis="stated"),
                  ch("social", "https://instagram.com/bloomstudio", platform="instagram", handle="bloomstudio",
                     tier="A", tier_basis="stated")]},
    # A legacy card from before R11: NO channels[]. The one reader derives its email from the old fields.
    {"slug": "legacy-co", "business": "Legacy Co", "published": True,
     "channel": {"kind": "email", "to": "owner@legacy.example"}, "contact_tier": "A"},
]

def boot(pg, lang, opps):
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_function("()=>typeof window.thriveModal==='object'", timeout=15000)
    pg.evaluate("()=>{document.documentElement.classList.remove('gate-locked');const g=document.getElementById('thriveGate');if(g)g.remove();}")
    pg.evaluate("""(a)=>{ localStorage.setItem('thrive_lang',a.lang);
        localStorage.setItem('thrive_opps_v1',JSON.stringify(a.opps)); }""", {"lang": lang, "opps": opps})
    pg.reload()
    pg.wait_for_function("()=>typeof window.thriveModal==='object'", timeout=15000)
    pg.evaluate("()=>{document.documentElement.classList.remove('gate-locked');const g=document.getElementById('thriveGate');if(g)g.remove();}")

def open_comm(pg, slug):
    pg.evaluate("(s)=>window.thriveModal.open(s,'overview')", slug)
    pg.wait_for_timeout(200)
    pg.evaluate("()=>window.thriveModal.tab('outreach')")
    pg.wait_for_timeout(300)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width": 1280, "height": 1000})
    ctx.route("https://api.github.com/**", lambda r: r.abort())
    ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body='{"opportunities":[]}'))
    pg = ctx.new_page()
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))

    # ===== English: the Communication tab reads the one channel list =====
    boot(pg, "en", OPPS)

    # -- 1. research-stated email: chip, basis, primary, one-tap Confirm --
    open_comm(pg, "dripdocx")
    d = pg.evaluate("""()=>{ var o=document.getElementById('modalOutreach');
      var chs=o.querySelector('.oc-chs');
      var email=o.querySelector('.oc-ch');
      var tier=o.querySelector('.oc-tier');
      return { hasList: !!chs, rows: o.querySelectorAll('.oc-ch').length,
        emailType: (o.querySelector('.oc-ch-type')||{}).textContent||'',
        emailVal: (o.querySelector('.oc-ch-val')||{}).textContent||'',
        tierCls: tier? tier.className : '', tierTxt: tier? tier.textContent.replace(/\\s+/g,' ').trim() : '',
        primary: !!o.querySelector('.oc-primary'),
        confirm: !!o.querySelector('.oc-confirm'),
        emailPathOffered: !!o.querySelector('.och-card[data-path=\"email\"]'),
        emptyListNote: [].some.call(o.querySelectorAll('.mw-note'), e=>/supplied no channel/i.test(e.textContent)) }; }""")
    ck("1. the Communication tab lists the email as a channel row (the one model reaches the tab)",
       d["hasList"] and d["rows"] == 1 and "info@dripdocx.com" in d["emailVal"], d)
    ck("1. the row carries a Tier A chip whose basis reads 'per research, confirm'",
       "is-stated" in d["tierCls"] and "Tier A" in d["tierTxt"] and "per research, confirm" in d["tierTxt"], d)
    ck("1. the channel is marked primary and offers the email send path",
       d["primary"] and d["emailPathOffered"], d)
    ck("1. a research-stated tier shows a one-tap Confirm (never auto-upgraded)", d["confirm"] is True, d)
    ck("1. the channel list itself renders rows, never its 'no channel' empty note", d["emptyListNote"] is False, d)

    # one tap confirms the sighting: basis flips to sighted, the Confirm control goes away
    pg.click("#modalOutreach .oc-confirm"); pg.wait_for_timeout(400)
    after = pg.evaluate("""()=>{ var o=document.getElementById('modalOutreach');
      var tier=o.querySelector('.oc-tier');
      var saved=JSON.parse(localStorage.getItem('thrive_opps_v1')||'[]').find(x=>x.slug==='dripdocx');
      return { tierCls: tier? tier.className : '', confirm: !!o.querySelector('.oc-confirm'),
        savedBasis: saved && saved.channels && saved.channels[0] ? saved.channels[0].tier_basis : '' }; }""")
    ck("1. one tap flips the basis to sighted and removes the Confirm control",
       "is-sighted" in after["tierCls"] and after["confirm"] is False, after)
    ck("1. the flip is written back onto the ONE channel list (tier_basis=sighted), not a shadow field",
       after["savedBasis"] == "sighted", after)
    pg.evaluate("()=>window.thriveModal.close(true)"); pg.wait_for_timeout(150)

    # -- 2. non-email primary: every channel listed, no email path offered --
    open_comm(pg, "bloom")
    bl = pg.evaluate("""()=>{ var o=document.getElementById('modalOutreach');
      var types=[].map.call(o.querySelectorAll('.oc-ch-type'),e=>e.textContent);
      return { rows: o.querySelectorAll('.oc-ch').length, types: types,
        emailPathOffered: !!o.querySelector('.och-card[data-path=\"email\"]'),
        emailOff: !!o.querySelector('.och-card.is-off'),
        primaryType: (o.querySelector('.oc-ch.is-primary .oc-ch-type')||{}).textContent||'' }; }""")
    ck("2. a non-email card lists every captured channel (WhatsApp, Phone, Instagram)",
       bl["rows"] == 3 and "WhatsApp" in bl["types"] and "Phone" in bl["types"], bl)
    ck("2. no email send path is offered when there is no email channel (and the email card reads off)",
       bl["emailPathOffered"] is False and bl["emailOff"] is True, bl)
    ck("2. the WhatsApp channel is the marked primary (the recorded send road)",
       bl["primaryType"] == "WhatsApp", bl)
    pg.evaluate("()=>window.thriveModal.close(true)"); pg.wait_for_timeout(150)

    # -- 3. legacy card (no channels[]): the one reader derives the email into the same shape --
    open_comm(pg, "legacy-co")
    lg = pg.evaluate("""()=>{ var o=document.getElementById('modalOutreach');
      return { rows: o.querySelectorAll('.oc-ch').length,
        val: (o.querySelector('.oc-ch-val')||{}).textContent||'',
        type: (o.querySelector('.oc-ch-type')||{}).textContent||'' }; }""")
    ck("3. a legacy card with no channels[] still shows its email in the tab (one reader, no second store)",
       lg["rows"] == 1 and lg["type"] == "Email" and "owner@legacy.example" in lg["val"], lg)
    pg.evaluate("()=>window.thriveModal.close(true)"); pg.wait_for_timeout(150)

    # ===== 5. Arabic: the tab mirrors and speaks the Arabic tier/basis strings =====
    boot(pg, "ar", OPPS)
    open_comm(pg, "dripdocx")
    ar = pg.evaluate("""()=>{ var o=document.getElementById('modalOutreach');
      var tier=o.querySelector('.oc-tier');
      return { dir: document.documentElement.dir,
        tierTxt: tier? tier.textContent.replace(/\\s+/g,' ').trim() : '',
        primaryTxt: (o.querySelector('.oc-primary')||{}).textContent||'' }; }""")
    ck("5. Arabic: the document mirrors to rtl", ar["dir"] == "rtl", ar)
    ck("5. Arabic: the tier chip reads «الفئة A حسب البحث، أكِّد»",
       "الفئة A" in ar["tierTxt"] and "حسب البحث" in ar["tierTxt"], ar)
    ck("5. Arabic: the primary marker reads «الأساسية»", ar["primaryTxt"].strip() == "الأساسية", ar)
    pg.evaluate("()=>window.thriveModal.close(true)"); pg.wait_for_timeout(150)

    # ===== 4. the composer To resolves from the primary channel (compose.html) =====
    def compose_to(slug, opps):
        # Seed the store BEFORE the page runs, so initCompose's first pass already has the opp - no reload
        # race, and each call is independent of the last card's resolved To.
        pg.add_init_script("try{ localStorage.setItem('thrive_lang','en'); localStorage.setItem('thrive_opps_v1', %s); }catch(e){}" % json.dumps(json.dumps(opps)))
        pg.goto(f"{base}/library/compose.html?slug={slug}")
        pg.evaluate("()=>{document.documentElement.classList.remove('gate-locked');const g=document.getElementById('thriveGate');if(g)g.remove();}")
        pg.wait_for_selector("#eto", state="attached", timeout=15000)
        # the To fills asynchronously once initCompose loads the opp; wait for a resolved value or the note
        pg.wait_for_function("""()=>{ var e=document.getElementById('eto');
            return e && (e.value.trim() || document.querySelector('.eto-note')); }""", timeout=8000)
        pg.wait_for_timeout(300)
        return pg.evaluate("""()=>({ to: (document.getElementById('eto')||{}).value||'',
           note: (document.querySelector('.eto-note')||{}).textContent||'' })""")

    r = compose_to("dripdocx", OPPS)
    ck("4. the email-primary card's composer To resolves to exactly the primary email address",
       r["to"] == "info@dripdocx.com", r)

    r2 = compose_to("bloom", OPPS)
    ck("4. a non-email-primary card leaves the composer To blank and shows the 'not an email channel' note",
       r2["to"] == "" and "not an email channel" in r2["note"].lower(), r2)

    ck("no page errors across the whole session", len(errs) == 0, errs)
    ctx.close(); b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
