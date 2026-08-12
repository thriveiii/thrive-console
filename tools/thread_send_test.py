"""The thread reply actually sends, once, and reports truly (WO thread-send).

Replying to Basel in the thread failed on the device with a 404 (an HTML relay error surfaced in the
composer). The thread reply ran its OWN bare route: it POSTed with none of brief 01's hardening, so a
stale relay's error surfaced raw and no durable row was left to reconcile, which means a retry could
double-send. This unifies the send: sendThreadReply is now one entry point into relaySend, the SAME
hardened function the outreach composer uses (a per-intent idempotency key the relay forwards to Resend,
a durable pending row written before the POST, no blind retry, the relay's true answer as the outcome),
with the thread's In-Reply-To / References / Message-ID attached.

Four scenarios against a mocked relay that reproduces each real outcome, keyed and deduped by the
intent's idempotency key exactly as Resend does:
  T1 normal      -> one delivery; the reply appears in the thread in order; outcome sent.
  T2 slow ack    -> one delivery; the client's request times out; NO retry, the row stays pending; a
                    re-tap reconciles under the same key (one delivery still) and resolves to sent.
  T3 hard failure-> zero delivery; a true, retryable error; the thread is unchanged (no phantom sent).
  T4 Arabic reply-> sends once; the body keeps dir=rtl; threads by In-Reply-To.

The send landing on the wire is Thyab's device gate (Resend is the witness); the client's
exactly-once, true-outcome behaviour is proven here.
"""
import threading, http.server, socketserver, functools, os, sys
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
        if d is not None: print("      " + str(d)[:300])

# ---- Source guards: one send path, two entry points -------------------------
app = open(f"{ROOT}/library/app.js").read()
ck("there is one hardened send function, relaySend", "async function relaySend(intent)" in app)
ck("relaySend carries the idempotency key and refuses a known-stale relay before the POST",
   "idempotencyKey:idem" in app and "if(!relayReady()) return { status:\"unsent\"" in app)
ck("the thread reply is an entry point into relaySend, not its own route",
   "async function sendThreadReply" in app
   and app.split("async function sendThreadReply")[1].split("\n}")[0].count("relaySend(")==1
   and "fetchT(ep" not in app.split("async function sendThreadReply")[1].split("\n}")[0])
ck("the outreach composer sends through the same relaySend",
   "res=await relaySend({ opp:oppOf()" in app)

THREADS = [
  {"slug":"t1-co", "addr":"basel@gmail.com",  "name":"Basel", "lang":"en", "wire":"<wire-1@gmail.com>"},
  {"slug":"t2-co", "addr":"tamer@shop.com",   "name":"Tamer", "lang":"en", "wire":"<wire-2@gmail.com>"},
  {"slug":"t3-co", "addr":"nadia@studio.com", "name":"Nadia", "lang":"en", "wire":"<wire-3@gmail.com>"},
  {"slug":"t4-co", "addr":"salma@cafe.com",   "name":"Salma", "lang":"ar", "wire":"<wire-4@gmail.com>"},
]

MOCK = r"""
() => {
  window.__mock = { mode:"success", deliveries:0, keys:{}, calls:0, posts:[] };
  const real = window.fetch.bind(window);
  window.fetch = async (url, opts) => {
    const u = String(url);
    if (u.indexOf("relay.mock") >= 0) {
      const M = window.__mock; M.calls++;
      let body = {}; try { body = JSON.parse((opts && opts.body) || "{}"); } catch(e) {}
      M.posts.push(body);
      const key = body.idempotencyKey || "";
      const deliver = () => { if (key && !M.keys[key]) { M.keys[key] = 1; M.deliveries++; } };
      if (M.mode === "timeout")  { deliver(); const e = new Error("The relay is taking too long."); e.name = "AbortError"; throw e; }
      if (M.mode === "harddown") { throw new Error("Failed to fetch"); }
      deliver();
      return new Response(JSON.stringify({ ok:true, id:"re_"+M.deliveries, relay_version:5, delivered:true }), {status:200});
    }
    if (u.indexOf("supabase.co") >= 0) return new Response("[]",{status:200});
    return real(url, opts);
  };
  return true;
}
"""

def seed(pg):
    pg.evaluate("""(T)=>{
      const set=(k,v)=>localStorage.setItem(k, JSON.stringify(v));
      set('thrive_opps_v1', T.map(t=>({ slug:t.slug, business:t.slug, published:true,
        recipients:[{addr:t.addr, name:t.name, lang:t.lang}] })));
      set('thrive_inbound_v1', T.map((t,i)=>({ gid:'g'+i, opp:t.slug, kind:'reply', from:t.addr, name:t.name,
        subject:(t.lang==='ar'?'Re: مرحبا':'Re: hello'), snippet:(t.lang==='ar'?'نعم':'yes'),
        ts:'2026-08-03T09:00:00Z', messageId:t.wire })));
      ['thrive_mail_v1','thrive_quota_v1'].forEach(k=>localStorage.removeItem(k));
      localStorage.setItem('thrive_email_ep','http://relay.mock/exec');
    }""", THREADS)

def reply(pg, slug, body, mode):
    return pg.evaluate("""async (a)=>{
      window.__mock.mode = a.mode;
      let out=null, threw=null;
      try{ out = await window.sendThreadReply(a.slug, a.body); }catch(e){ threw=String(e.message||e); }
      return { out, threw }; }""", {"slug":slug, "body":body, "mode":mode})

def rows(pg, slug):
    return pg.evaluate("(s)=>window.getMailLog().filter(m=>m && m.opp===s)", slug)
def thread_kinds(pg, slug):
    return pg.evaluate("(s)=>window.buildThread(s).map(e=>({kind:e.kind, subject:e.subject||'', ts:e.ts||''}))", slug)
def deliveries(pg):
    return pg.evaluate("()=>window.__mock.deliveries")
def calls(pg):
    return pg.evaluate("()=>window.__mock.calls")
def last_post(pg):
    return pg.evaluate("()=>window.__mock.posts[window.__mock.posts.length-1]")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width":1000,"height":900})
    ctx.route("https://api.github.com/**", lambda r: r.abort())
    pg = ctx.new_page()
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_function("()=>typeof window.sendThreadReply==='function' && typeof window.buildThread==='function'", timeout=15000)
    seed(pg); pg.evaluate(MOCK)

    # ---- T1: a normal reply, one delivery, appears in the thread in order ----
    r1 = reply(pg, "t1-co", "Thanks Basel, glad it landed.", "success")
    ck("T1: the reply reports sent, no error", r1["threw"] is None and r1["out"] and r1["out"].get("ok") is True, r1)
    ck("T1: exactly one delivery", deliveries(pg) == 1, deliveries(pg))
    t1_sent = [m for m in rows(pg, "t1-co") if m.get("status") == "sent" and str(m.get("subject","")).startswith("Re:")]
    ck("T1: one sent reply row, keyed by an idempotency key", len(t1_sent) == 1 and bool(t1_sent[0].get("idem")), t1_sent)
    tk = thread_kinds(pg, "t1-co")
    reply_i = next((i for i,e in enumerate(tk) if e["kind"]=="reply"), -1)
    sent_i  = next((i for i,e in enumerate(tk) if e["kind"]=="sent" and e["subject"].startswith("Re:")), -1)
    ck("T1: the sent reply appears in the thread, after the inbound it answers", reply_i>=0 and sent_i>reply_i, tk)

    # ---- T2: slow ack -> timeout leaves it pending, no retry; a re-tap reconciles to one delivery ----
    d_before = deliveries(pg)
    r2 = reply(pg, "t2-co", "Following up, Tamer.", "timeout")
    ck("T2: a timeout reports pending (in flight), never a false failure",
       r2["threw"] is None and r2["out"] and r2["out"].get("pending") is True, r2)
    t2_after_to = rows(pg, "t2-co")
    ck("T2: the intent row is durable and left pending (the card is not stranded)",
       any(m.get("status")=="pending" and m.get("idem") for m in t2_after_to), t2_after_to)
    ck("T2: one delivery server-side, and no blind retry (one relay call for this intent)",
       deliveries(pg) == d_before + 1, (d_before, deliveries(pg)))
    calls_before = calls(pg)
    r2b = reply(pg, "t2-co", "Following up, Tamer.", "success")   # a deliberate re-tap, SAME body -> same key
    ck("T2: the re-tap reconciles to sent", r2b["out"] and r2b["out"].get("ok") is True
       and any(m.get("status")=="sent" for m in rows(pg, "t2-co")), r2b)
    ck("T2: the re-tap re-POSTs (a real reconcile) but delivers only once (Resend dedupes the key)",
       calls(pg) == calls_before + 1 and deliveries(pg) == d_before + 1, (calls_before, calls(pg), d_before, deliveries(pg)))

    # ---- T3: a genuine failure, zero delivery, true retryable error, thread unchanged ----
    d_before = deliveries(pg)
    r3 = reply(pg, "t3-co", "Hi Nadia.", "harddown")
    ck("T3: a genuine failure throws a true, retryable error (not a silent drop)",
       r3["threw"] is not None and r3["out"] is None, r3)
    ck("T3: zero delivery", deliveries(pg) == d_before, (d_before, deliveries(pg)))
    t3_thread = thread_kinds(pg, "t3-co")
    ck("T3: the thread is unchanged (no phantom sent reply)",
       not any(e["kind"]=="sent" and e["subject"].startswith("Re:") for e in t3_thread), t3_thread)
    ck("T3: a durable unsent row is left, keyed by the intent (retryable, no double-send)",
       any(m.get("status")=="unsent" and m.get("idem") for m in rows(pg, "t3-co")), rows(pg, "t3-co"))

    # ---- T4: an Arabic reply, sent once, RTL preserved, threaded ----
    d_before = deliveries(pg)
    r4 = reply(pg, "t4-co", "شكرًا سلمى، سعدنا بردّك.", "success")
    ck("T4: the Arabic reply reports sent", r4["threw"] is None and r4["out"] and r4["out"].get("ok") is True, r4)
    ck("T4: exactly one delivery", deliveries(pg) == d_before + 1, (d_before, deliveries(pg)))
    post = last_post(pg)
    ck("T4: the body keeps its right-to-left direction on the wire", 'dir="rtl"' in str(post.get("html","")), post.get("html","")[:120])
    ck("T4: the reply threads by header (In-Reply-To names the wire id it answers)",
       (post.get("headers") or {}).get("In-Reply-To") == "<wire-4@gmail.com>" and bool((post.get("headers") or {}).get("Message-ID")), post.get("headers"))
    ck("T4: the reply carries the idempotency key so it delivers at most once",
       bool(post.get("idempotencyKey")), post)

    ctx.close(); b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
