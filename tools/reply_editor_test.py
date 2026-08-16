"""A real reply editor and durable, correctly-rendered threads (WO-020).

Engine-independent facts (the send landing on the wire is Thyab's device gate): the thread render
escapes every reply body (no XSS sink) and isolates each message's direction so Arabic reads
right-to-left without interleaving; the composer answers from hi@thriveiii.com to the right recipient,
threaded by In-Reply-To with a fresh Message-ID, scoped to this slug only (no cross-thread leak); the
sent reply appears in the thread in order; a three-message exchange stays ordered."""
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

# Seed the local stores + the relay endpoint, and capture the relay POST. No sign-in: the thread
# functions are global and read the local stores directly.
INIT = r"""
(() => {
  const set=(k,v)=>{ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} };
  set('thrive_opps_v1', [
    { slug:'thrive-july', business:'July', published:true, recipients:[{addr:'basel.personal@gmail.com', name:'Basel', lang:'ar'}] },
    { slug:'other-co',   business:'Other', published:true, recipients:[{addr:'lina@school.com', name:'Lina', lang:'en'}] }
  ]);
  set('thrive_mail_v1', [
    { mid:'j1', opp:'thrive-july', to:'basel.personal@gmail.com', toName:'Basel', subject:'من جد وجد',
      status:'sent', direction:'out', ts:'2026-07-31T17:02:00Z', msgid:'<c-send-1@thriveiii.com>' }
  ]);
  set('thrive_inbound_v1', [
    { gid:'g1', opp:'thrive-july', kind:'reply', from:'basel.personal@gmail.com', name:'Basel',
      subject:'Re: من جد وجد', snippet:'نعم، رائع جدًا <script>alert(1)</script> شكرًا لكم', ts:'2026-08-03T09:00:00Z',
      messageId:'<wire-basel-1@gmail.com>' },
    { gid:'g2', opp:'other-co', kind:'reply', from:'lina@school.com', subject:'Re: A page', snippet:'yes thanks', ts:'2026-08-02T09:00:00Z' }
  ]);
  try{ localStorage.setItem('thrive_email_ep','https://relay.example/exec'); }catch(e){}
  window.__posts = [];
  const real = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = async (url, opts) => {
    if (typeof url==='string' && url.indexOf('relay.example')>=0) {
      try{ window.__posts.push(JSON.parse(opts.body)); }catch(e){ window.__posts.push({parseError:String(e)}); }
      // A healthy relay answers with its version, so the hardened send (relaySend) is satisfied it matches
      // the request shape. Without relay_version the send is correctly refused as behind, which is the fix.
      return new Response(JSON.stringify({ok:true, id:'sent-1', relay_version:5}), {status:200, headers:{'Content-Type':'application/json'}});
    }
    if (typeof url==='string' && url.indexOf('supabase.co')>=0) return new Response('[]',{status:200});
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
    pg = b.new_page(viewport={"width": 700, "height": 800})
    pg.add_init_script(INIT)
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_function("()=>typeof window.threadListHtml==='function' && typeof window.replyTarget==='function' && typeof window.sendThreadReply==='function'", timeout=15000)

    # ---- replyTarget resolves the recipient, language, and what to thread onto, from this slug only ----
    tgt = pg.evaluate("()=>window.replyTarget('thrive-july')")
    ck("replyTarget answers the address that replied, in its language, threaded onto its wire id",
       tgt["addr"]=="basel.personal@gmail.com" and tgt["lang"]=="ar" and tgt["inReplyTo"]=="wire-basel-1@gmail.com", tgt)

    # ---- (Audit S4) the bare-textarea composer (replyComposerHtml) is retired: the thread reply is the same
    #      full send editor in reply mode. replyTarget (who/lang) is still the source of the greeting, and the
    #      mounted editor's Arabic greeting is covered by thread_editor_reuse_test. ----
    ck("the orphaned bare-textarea reply composer (replyComposerHtml) is retired: one composer for one job",
       pg.evaluate("()=>typeof window.replyComposerHtml")=="undefined")
    ck("the reply greeting still speaks the recipient's language (Arabic) via replyTarget/replyGreeting",
       "مرحبًا" in pg.evaluate("()=>{ const tg=window.replyTarget('thrive-july'); return window.replyGreeting?window.replyGreeting(tg):''; }"))

    # ---- the thread render escapes hostile bodies (no XSS sink) and isolates direction ----
    thtml = pg.evaluate("()=>window.threadListHtml('thrive-july')")
    ck("the reply body is escaped in the thread render (no raw <script> sink)",
       "&lt;script&gt;" in thtml and "<script>alert" not in thtml, thtml[:300] if "<script>alert" in thtml else None)
    ck("the reply subject and snippet carry dir=auto so each message keeps its own direction",
       'class="rp-subj" dir="auto"' in thtml and 'class="rp-snip" dir="auto"' in thtml)

    # ---- render into the DOM: no script node executes; the Arabic snippet computes rtl ----
    # WO-022: each line of a body is now its own direction-isolated block (.rp-line dir=auto), so a mixed
    # line reads in order instead of scrambling. The reply's direction is read on the line, where it now
    # lives; the XSS guarantee is unchanged (still escaped, no script node from the body).
    dom = pg.evaluate("""()=>{
      const d=document.createElement('div'); d.id='thProbe'; d.innerHTML=window.threadListHtml('thrive-july');
      document.body.appendChild(d);
      const snip=d.querySelector('.rp-snip'), line=d.querySelector('.rp-snip .rp-line');
      return { scripts:d.querySelectorAll('script').length, snipText:(snip&&snip.textContent)||'',
               dir:line?getComputedStyle(line).direction:'' };
    }""")
    ck("no script element is created from the reply body (inert, escaped as text)",
       dom["scripts"]==0 and "<script>alert(1)</script>" in dom["snipText"], dom)
    ck("the Arabic reply line computes right-to-left (per-line isolation, no interleaving)", dom["dir"]=="rtl", dom)
    en_dir = pg.evaluate("""()=>{
      const d=document.createElement('div'); d.innerHTML=window.threadListHtml('other-co'); document.body.appendChild(d);
      const s=d.querySelector('.rp-snip .rp-line'); return s?getComputedStyle(s).direction:'';
    }""")
    ck("an English reply line computes left-to-right", en_dir=="ltr", en_dir)

    # ---- send a reply: the relay payload is correct and scoped; it appears in the thread in order ----
    res = pg.evaluate("""async ()=>{
      const r = await window.sendThreadReply('thrive-july', 'مرحبًا باسل، شكرًا لردك.');
      const post = window.__posts[window.__posts.length-1];
      const slim = th => th.map(e=>({kind:e.kind, subject:e.subject||'', from:e.from||''}));
      return { r, post, july: slim(window.buildThread('thrive-july')), other: slim(window.buildThread('other-co')) };
    }""")
    post = res["post"]
    ck("the reply is sent from hi@thriveiii.com to the prospect, with Message-ID and In-Reply-To, for this slug",
       post["from"]=="hi@thriveiii.com" and post["to"]=="basel.personal@gmail.com" and
       post["subject"].startswith("Re:") and bool(post["headers"].get("Message-ID")) and
       post["headers"].get("In-Reply-To")=="<wire-basel-1@gmail.com>" and post["slug"]=="thrive-july", post)
    july = res["july"]
    reply_i = next((i for i,e in enumerate(july) if e["kind"]=="reply" and "basel" in e["from"].lower()), -1)
    sent_i  = next((i for i,e in enumerate(july) if e["kind"]=="sent" and e["subject"].startswith("Re:")), -1)
    ck("the sent reply appears in this thread, in order after the inbound reply it answers",
       reply_i>=0 and sent_i>reply_i, {"reply_i":reply_i, "sent_i":sent_i, "kinds":[e["kind"] for e in july]})
    ck("the reply never crosses into another prospect's thread (other-co has no Re: من جد وجد, one reply)",
       (not any(e["subject"].startswith("Re: من") for e in res["other"])) and
       sum(1 for e in res["other"] if e["kind"]=="reply")==1, [e["kind"]+":"+e["subject"] for e in res["other"]])

    # ---- a three-message exchange stays ordered ----
    order = pg.evaluate("""async ()=>{
      await window.sendThreadReply('thrive-july', 'ومتى يناسبك اتصال قصير؟');
      const th = window.buildThread('thrive-july');
      const msgs = th.filter(e=>e.kind==='sent'||e.kind==='reply');
      const ts = msgs.map(e=>e.ts);
      const sorted = ts.slice().sort();
      return { kinds: msgs.map(e=>e.kind), ordered: JSON.stringify(ts)===JSON.stringify(sorted), n: msgs.length };
    }""")
    ck("a three-message exchange (send, reply, send, send) stays in timestamp order",
       order["ordered"] and order["n"]>=3, order)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL REPLY EDITOR CHECKS PASS"))
raise SystemExit(1 if fails else 0)
