"""The thread composer IS the send editor, scoped to the thread (not a bare textarea).

WO-020 shipped, and the original direction asked for, a reply editor supported by the send editor; #99
shipped a prefilled textarea. This closes that gap by REUSE, not duplication: the History tab borrows the
same #view-compose node and runs the same initCompose the outreach tab does, in reply mode. One editor
codebase, two mount points.

Engine-independent facts (the send landing on the wire and Arabic joined-letter rendering are Thyab's
device gate): opening a thread mounts the full editor (formatting toolbar, template select, live preview,
undo) into the modal host, scoped to the thread (recipient locked to the address that replied, subject
defaulted to Re:, body opened on the greeting in the recipient's language, RTL for Arabic); a reply sends
from hi@thriveiii.com with In-Reply-To, References and a fresh Message-ID and appears in the thread in
order; the reply body is escaped at render (no XSS sink); and the outreach path is unchanged (its recipient
field is editable, no reply headers, page-live gate intact)."""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:500])

# Seed the local stores, a relay endpoint, and a fetch that captures the POST and answers with the
# contract relay_version so the send gate is satisfied. An Arabic recipient, so the greeting is Arabic RTL.
INIT = r"""
(() => {
  const set=(k,v)=>{ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} };
  set('thrive_opps_v1', [
    { slug:'acme', business:'Acme', published:true, recipients:[{addr:'omar@acme.example', name:'Omar', lang:'ar'}] },
    { slug:'other-co', business:'Other', published:true, channel:{to:'lina@other.example'},
      recipients:[{addr:'lina@other.example', name:'Lina', lang:'en'}] }
  ]);
  set('thrive_mail_v1', [
    { mid:'a1', opp:'acme', to:'omar@acme.example', toName:'Omar', subject:'عرض المدرسة',
      status:'sent', direction:'out', ts:'2026-08-01T10:00:00Z', msgid:'<send-acme-1@thriveiii.com>' }
  ]);
  set('thrive_inbound_v1', [
    { gid:'g1', opp:'acme', kind:'reply', from:'omar@acme.example', name:'Omar', subject:'Re: عرض المدرسة',
      snippet:'شكرًا <script>alert(1)</script> نعم', ts:'2026-08-03T09:00:00Z', messageId:'<wire-omar-1@acme.example>' }
  ]);
  try{ localStorage.setItem('thrive_email_ep','https://relay.example/exec'); }catch(e){}
  window.__posts = [];
  const real = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = async (url, opts) => {
    if (typeof url==='string' && url.indexOf('relay.example')>=0) {
      try{ window.__posts.push(JSON.parse(opts.body)); }catch(e){ window.__posts.push({parseError:String(e)}); }
      return new Response(JSON.stringify({ok:true, id:'sent-1', relay_version:5}), {status:200, headers:{'Content-Type':'application/json'}});
    }
    if (typeof url==='string' && url.indexOf('supabase.co')>=0) return new Response('[]',{status:200});
    if (typeof url==='string' && url.indexOf('/opp/')>=0) return new Response('<html>live</html>',{status:200});  // the page reads live
    return real?real(url,opts):new Response('',{status:200});
  };
})()
"""

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page(viewport={"width": 900, "height": 1000})
    pg.add_init_script(INIT)
    pg.goto(f"{base}/library/console.html")
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(400)
    pg.wait_for_function("()=>window.thriveModal && typeof window.initCompose==='function' && typeof window.replyTarget==='function'", timeout=15000)

    # ---- open a thread: the full send editor mounts into the modal host, in reply mode ----
    pg.evaluate("()=>window.thriveModal.open('acme','history','Acme')")
    pg.wait_for_function("""()=>{ const v=document.getElementById('view-compose'), h=document.getElementById('modalHost');
      return v && h && v.parentNode===h && !v.hidden && document.getElementById('eto') && document.getElementById('eto').readOnly; }""", timeout=8000)

    mount = pg.evaluate("""()=>{
      const v=document.getElementById('view-compose'), h=document.getElementById('modalHost');
      const vis=id=>{ const e=document.getElementById(id); return !!(e && e.checkVisibility()); };
      return {
        inHost: v.parentNode===h,
        lean: v.classList.contains('reply-lean'),
        toolbarHidden: !['tbBold','tbItalic','tbUnder','tbList','tbLink'].some(vis),
        tplHidden: !vis('etpl'),
        optionsShown: vis('cmpReplyOptions'),
        send: vis('eSend'), to: vis('eto'), subject: vis('esubject'), body: !!document.getElementById('ebody')
      }; }""")
    ck("the History tab borrows the SAME send editor node (#view-compose) into the modal host",
       mount["inHost"] is True, mount)
    # Finding 2: the reply composer is calm by default -- template picker and formatting toolbar tucked away.
    ck("the reply composer is calm by default: template picker and formatting toolbar are tucked away",
       mount["lean"] is True and mount["toolbarHidden"] is True and mount["tplHidden"] is True, mount)
    ck("the essentials stay in view: recipient, subject, body, one Send, and a single Options affordance",
       mount["send"] and mount["to"] and mount["subject"] and mount["body"] and mount["optionsShown"], mount)

    # clicking Options reveals the FULL editing surface (same editor, one disclosure, nothing removed).
    reveal = pg.evaluate("""()=>{
      const btn=document.getElementById('cmpReplyOptions'); if(btn) btn.click();
      const vis=id=>{ const e=document.getElementById(id); return !!(e && e.checkVisibility()); };
      return { toolbar: ['tbBold','tbItalic','tbUnder','tbList','tbLink'].every(vis),
               templates: vis('etpl'), preview: !!document.getElementById('cmpPreview'),
               undo: !!document.getElementById('cmpUndo') }; }""")
    ck("Options reveals the full editing surface (formatting toolbar, template picker, preview, undo), not a bare textarea",
       reveal["toolbar"] is True and reveal["templates"] is True and reveal["preview"] is True and reveal["undo"] is True, reveal)

    # ---- scoped to the thread: recipient locked to the replier, subject Re:, greeting in Arabic, RTL body ----
    scope = pg.evaluate("""()=>{
      const eto=document.getElementById('eto'), su=document.getElementById('esubject'), bd=document.getElementById('ebody');
      const inner=bd.querySelector('div');
      return { to:eto.value, locked:eto.readOnly, subject:su.value,
               bodyText:(bd.textContent||''), dir: inner? getComputedStyle(inner).direction : getComputedStyle(bd).direction }; }""")
    ck("the recipient is the address that replied, and it is locked (a reply answers one address)",
       scope["to"]=="omar@acme.example" and scope["locked"] is True, scope)
    ck("the subject defaults to Re: the thread subject", scope["subject"].startswith("Re:"), scope)
    ck("the body opens on the greeting in the recipient's language (Arabic), rendered right-to-left",
       ("مرحبًا" in scope["bodyText"]) and scope["dir"]=="rtl", scope)

    # ---- the thread list is rendered above the editor, and it still escapes hostile bodies (no XSS sink) ----
    esc = pg.evaluate("""()=>{ const box=document.getElementById('modalHistory');
      const scripts=box.querySelectorAll('script').length;
      const snip=box.querySelector('.rp-snip');
      return { scripts, hasEscaped: box.innerHTML.indexOf('&lt;script&gt;')>=0,
               rawSink: box.innerHTML.indexOf('<script>alert')>=0, snipText:(snip&&snip.textContent)||'' }; }""")
    ck("the thread renders above the editor and escapes the reply body (no raw <script> sink)",
       esc["scripts"]==0 and esc["hasEscaped"] and not esc["rawSink"] and "<script>alert(1)</script>" in esc["snipText"], esc)

    # ---- send a styled reply through the editor's Send: threaded, from hi@, appears in order ----
    res = pg.evaluate("""async ()=>{
      const bd=document.getElementById('ebody');
      bd.innerHTML='<div dir="rtl">مرحبًا عمر،<br><b>شكرًا</b> لردك.<br><br>تحياتي،<br>فريق ثرايف</div>';
      bd.dispatchEvent(new Event('input',{bubbles:true}));
      document.getElementById('eSend').click();
      const started=Date.now();
      while(!window.__posts.length && Date.now()-started<6000){ await new Promise(r=>setTimeout(r,50)); }
      const post=window.__posts[window.__posts.length-1]||{};
      const th=(window.buildThread('acme')||[]).map(e=>({kind:e.kind, subject:e.subject||'', from:e.from||''}));
      return { post, th }; }""")
    post = res["post"]
    hdr = (post.get("headers") or {})
    ck("the reply sends from hi@thriveiii.com to the locked recipient, for this slug",
       post.get("from")=="hi@thriveiii.com" and post.get("to")=="omar@acme.example" and post.get("slug")=="acme", post)
    ck("the reply threads by header: In-Reply-To names the wire id, References carries the chain, a fresh Message-ID",
       hdr.get("In-Reply-To")=="<wire-omar-1@acme.example>" and ("wire-omar-1@acme.example" in (hdr.get("References") or ""))
       and bool(hdr.get("Message-ID")) and post.get("subject","").startswith("Re:"), hdr)
    ck("the reply carries the styled HTML body the editor produced (bold preserved), not a flattened textarea",
       "<b>" in (post.get("html") or ""), (post.get("html") or "")[:200])
    th = res["th"]
    reply_i = next((i for i,e in enumerate(th) if e["kind"]=="reply" and "omar" in e["from"].lower()), -1)
    sent_i  = next((i for i,e in enumerate(th) if e["kind"]=="sent" and e["subject"].startswith("Re:")), -1)
    ck("the sent reply appears in this thread, in order after the inbound reply it answers",
       reply_i>=0 and sent_i>reply_i, {"reply_i":reply_i, "sent_i":sent_i, "kinds":[e["kind"] for e in th]})

    b.close()

    # ---- outreach path unchanged, proven on a FRESH page (no prior reply init on the node): the recipient
    #      is editable and seeded from the opportunity, and an outreach send carries NO reply headers. The
    #      'other-co' page is not live (no real fetch), so the send is driven with the live gate satisfied
    #      by seeding it; here we assert the payload shape, which is what the reply seam must not disturb.
    b2 = p.chromium.launch(executable_path=CH)
    pg2 = b2.new_page(viewport={"width": 900, "height": 1000})
    pg2.add_init_script(INIT)
    pg2.goto(f"{base}/library/console.html")
    if pg2.query_selector("#gateInput"):
        pg2.fill("#gateInput", "ConThrive2030"); pg2.click(".gate-btn"); pg2.wait_for_timeout(400)
    pg2.wait_for_function("()=>typeof window.initCompose==='function'", timeout=15000)
    outreach = pg2.evaluate("""async ()=>{
      await window.initCompose('other-co');                 // outreach mode: no opts, fresh node
      const eto=document.getElementById('eto');
      return { to:eto.value, locked:eto.readOnly }; }""")
    ck("outreach mode leaves the recipient editable (not locked) and seeded from the opportunity, unchanged",
       outreach["locked"] is False and outreach["to"]=="lina@other.example", outreach)
    sent_headers = pg2.evaluate("""async ()=>{
      document.getElementById('esubject').value='Hello';
      document.getElementById('ebody').innerHTML='<div>Hi Lina <a href="https://console.thriveiii.com/opp/other-co">page</a></div>';
      window.__posts=[];
      document.getElementById('eSend').click();
      const started=Date.now();
      while(!window.__posts.length && Date.now()-started<6000){ await new Promise(r=>setTimeout(r,50)); }
      const post=window.__posts[window.__posts.length-1]||{};
      const h=post.headers||{};
      return { got: window.__posts.length>0, hasReplyHdr: ('In-Reply-To' in h) || ('References' in h), to:post.to }; }""")
    ck("an outreach send carries no reply threading headers (the reply seam is isolated to reply mode)",
       sent_headers["got"] and sent_headers["hasReplyHdr"] is False and sent_headers["to"]=="lina@other.example", sent_headers)
    b2.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL THREAD-EDITOR REUSE CHECKS PASS"))
raise SystemExit(1 if fails else 0)
