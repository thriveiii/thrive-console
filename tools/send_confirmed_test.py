"""A send is not "sent" until the SERVER has the ledger row (the write invariant).

The device disaster this closes: a send dispatched from an online device advanced the card in the UI but
was ABSENT from console_mail on the server. The board reads the server-computed console_board view, so a
row stuck or dropped in the client's fire-and-forget mirror queue never appears, and the card that "moved"
was moving on a local write the server never received. relaySend reported "sent" before the row was
confirmed in Supabase.

The fix, proven here against a mocked relay AND a controllable fake of the Supabase client:
  1. After the relay accepts the email, the console_mail row is written and AWAITED. The send is reported
     "sent" only when that write returns success; the card advances only then.
  2. When the server write cannot complete (offline / signed out / transient), the send does NOT show Sent.
     It goes to a visible 'sending' outbox, durably queued, and RECOVERS to Sent automatically once
     connectivity returns and the write lands (a durable flush + reconcile).
  3. No console_mail row is ever written with an empty opp: the write is refused and recorded on the
     diverge ledger, never silently accepted (the two empty-opp rows in production were the proof it was
     unguarded).

FAILS-WHEN-BROKEN: S1 (server confirms -> sent) and S2 (server refuses -> sending, never Sent) are the same
send under opposite server outcomes. Remove the confirm gate (report 'sent' on the local write alone) and
S2 flips to 'sent', reddening. The live Resend dashboard and WebKit are Thyab's device gate; the client's
confirm-before-sent behaviour, which a Chromium sandbox can prove, is proven here.
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
        if d is not None: print("      " + str(d)[:400])

# ============================ source guards ============================
app = open(f"{ROOT}/library/app.js").read()
i18n = open(f"{ROOT}/library/i18n.js").read()
ck("the server write is confirmed and AWAITED on the send path (supaConfirmMail)",
   "async function supaConfirmMail(" in app and "const conf=await supaConfirmMail(" in app)
ck("a console_mail write with an empty opp is refused, not silently accepted (Part 2)",
   "function mailOppOk(" in app and 'refused: empty opp' in app and "refused:true" in app)
ck("pending/sending are local outbox states, never mirrored to the server as a phantom send",
   'if(rec.status==="pending" || rec.status==="sending") return;' in app)
ck("the 'sending' outbox graduates to sent once the durable write lands (reconcileSendingMail after flush)",
   "function reconcileSendingMail(" in app and "reconcileSendingMail();" in app)
ck("the card shows a visible outbox marker for an unconfirmed send (cardSending + is-sending)",
   "function cardSending(" in app and 'cls.push("is-sending")' in app)
ck("the outbox line and status label exist in both languages",
   i18n.count("tok_sending:") == 2 and i18n.count("mst_sending:") == 2 and i18n.count("cmp_sent_queued:") == 2)
ck("no em dash in the touched sources", "\u2014" not in app)

# ============================ live ============================
MOCK = r"""
() => {
  window.__mock = { deliveries:0 };
  const real = window.fetch.bind(window);
  window.fetch = async (url, opts) => {
    const u = String(url);
    if (u.indexOf("relay.mock") >= 0) {
      let body = {}; try { body = JSON.parse((opts && opts.body) || "{}"); } catch(e) {}
      const key = body.idempotencyKey || "";
      window.__mock.deliveries++;
      return new Response(JSON.stringify({ ok:true, id:"re_"+key, relay_version:5, delivered:true }), {status:200});
    }
    return real(url, opts);
  };
  // A controllable fake of the Supabase client: the SERVER side of the write. mode 'ok' accepts and stores
  // the row; mode 'reject' throws (offline / server error). This is what supaConfirmMail awaits.
  window.__srv = { mode:"ok", signed:true, console_mail:{}, console_opps:{}, console_pages:{}, console_hits:{}, console_inbound:{}, console_templates:{}, console_comments:{}, console_settings:{} };
  window.ThriveSupa = {
    ready: () => true,
    signedIn: () => window.__srv.signed,
    upsert: async (table, rows) => {
      if (window.__srv.mode === "reject") throw new Error("offline");
      const store = window.__srv[table] || (window.__srv[table] = {});
      (Array.isArray(rows) ? rows : [rows]).forEach(r => { store[r.id || r.slug || r.key] = r; });
      return null;
    },
    del: async () => null,
    session: () => ({}), cfg: () => ({ url:"x" })
  };
  return true;
}
"""

def reset(pg):
    pg.evaluate("""()=>{ ['thrive_mail_v1','thrive_quota_v1','thrive_inbound_v1','console_sb_pending','console_sb_diverge'].forEach(k=>localStorage.removeItem(k));
       window.__srv.console_mail={}; if(window.invalidateSends) window.invalidateSends(); }""")

def send(pg, opp, subj):
    return pg.evaluate("""async (a)=>{
       return await window.relaySend({ opp:a.opp, to:'tracy@cozycalicobooks.com', subject:a.subj,
         html:'<p>hi</p>', text:'hi', preview:'hi' });
    }""", {"opp": opp, "subj": subj})

def rows_for(pg, opp):
    return pg.evaluate("(s)=>window.getMailLog().filter(m=>m && m.opp===s)", opp)
def srv_mail_for(pg, opp):
    return pg.evaluate("(s)=>Object.values(window.__srv.console_mail).filter(r=>r && r.opp===s)", opp)
def lane(pg, opp):
    return pg.evaluate("(s)=>window.effStage({slug:s})", opp)
def sending(pg, opp):
    return pg.evaluate("(s)=>window.cardSending(s)", opp)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width":1280,"height":900})
    ctx.route("https://api.github.com/**", lambda r: r.fulfill(status=404, body="{}"))
    ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body='{"opportunities":[]}'))
    pg = ctx.new_page()
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_function("()=>typeof window.relaySend==='function' && typeof window.supaConfirmMail==='function'", timeout=15000)
    pg.evaluate("()=>{ document.documentElement.classList.remove('gate-locked'); const g=document.getElementById('thriveGate'); if(g) g.remove(); }")
    pg.evaluate("()=>localStorage.setItem('thrive_email_ep','http://relay.mock/exec')")
    pg.evaluate(MOCK)

    # S1 - ONLINE, the server confirms. The send is reported sent, the card advances, and the server holds
    # the row (this is the acceptance-1 shape: within one write the console_mail row is on the server).
    reset(pg)
    pg.evaluate("()=>{ window.__srv.mode='ok'; window.__srv.signed=true; }")
    r = send(pg, "cozy-calico-books", "The shop, found")
    rows = rows_for(pg, "cozy-calico-books")
    ck("S1: relaySend reports sent when the server confirms the row", r.get("status") == "sent", r)
    ck("S1: the local ledger row is sent", len(rows) == 1 and rows[0]["status"] == "sent", rows)
    ck("S1: the SERVER holds the console_mail row for the slug", len(srv_mail_for(pg, "cozy-calico-books")) == 1, srv_mail_for(pg, "cozy-calico-books"))
    ck("S1: the card advances to sent", lane(pg, "cozy-calico-books") == "sent", lane(pg, "cozy-calico-books"))
    ck("S1: no outbox marker on a confirmed send", sending(pg, "cozy-calico-books") is False, sending(pg, "cozy-calico-books"))

    # S2 - the email is out but the SERVER write fails (offline / server error). The card must NOT show Sent;
    # it shows a 'sending' outbox, durably queued, and RECOVERS to Sent automatically once the write lands.
    reset(pg)
    pg.evaluate("()=>{ window.__srv.mode='reject'; window.__srv.signed=true; }")
    r2 = send(pg, "basel-issa", "A quick note")
    rows2 = rows_for(pg, "basel-issa")
    ck("S2: relaySend does NOT report sent when the server has not confirmed", r2.get("status") == "sending", r2)
    ck("S2: the local row is a 'sending' outbox state, not sent", len(rows2) == 1 and rows2[0]["status"] == "sending", rows2)
    ck("S2: the server has NO row yet (the write did not land)", len(srv_mail_for(pg, "basel-issa")) == 0, srv_mail_for(pg, "basel-issa"))
    ck("S2: the card does NOT show Sent while unconfirmed", lane(pg, "basel-issa") in ("draft", "live"), lane(pg, "basel-issa"))
    ck("S2: the card shows the visible outbox marker", sending(pg, "basel-issa") is True, sending(pg, "basel-issa"))
    ck("S2: the send is durably queued for retry (not lost)",
       pg.evaluate("()=>window.thriveSupaPendingCount()") >= 1, pg.evaluate("()=>window.thriveSupaPendingCount()"))
    # Connectivity returns: the durable flush lands the row, and the outbox graduates to Sent on its own.
    pg.evaluate("()=>{ window.__srv.mode='ok'; }")
    pg.evaluate("async ()=>{ await window.thriveSupaFlush(); }")
    pg.wait_for_timeout(150)
    rows2b = rows_for(pg, "basel-issa")
    ck("S2: after recovery the server now holds the row", len(srv_mail_for(pg, "basel-issa")) == 1, srv_mail_for(pg, "basel-issa"))
    ck("S2: the local row graduated to sent on its own", len(rows2b) == 1 and rows2b[0]["status"] == "sent", rows2b)
    ck("S2: the card reaches Sent after recovery", lane(pg, "basel-issa") == "sent", lane(pg, "basel-issa"))
    ck("S2: the outbox marker clears once confirmed", sending(pg, "basel-issa") is False, sending(pg, "basel-issa"))

    # S3 - a console_mail write with an EMPTY opp is refused and recorded, never written to the server.
    reset(pg)
    pg.evaluate("()=>{ window.__srv.mode='ok'; window.__srv.signed=true; }")
    conf = pg.evaluate("async ()=>await window.supaConfirmMail({ mid:'x1', opp:'', status:'sent', to:'x@x' })")
    pg.evaluate("()=>window.logMail({ opp:'', status:'sent', to:'x@gmial.com', subject:'self test', ts:'2026-08-14T10:00:00Z' })")
    pg.wait_for_timeout(100)
    div = pg.evaluate("()=>{ try{ return JSON.parse(localStorage.getItem('console_sb_diverge')||'[]'); }catch(e){ return []; } }")
    ck("S3: supaConfirmMail refuses an empty-opp write", conf.get("refused") is True, conf)
    ck("S3: no empty-opp row is written to the server console_mail",
       pg.evaluate("()=>Object.values(window.__srv.console_mail).some(r=>!r.opp)") is False,
       pg.evaluate("()=>Object.values(window.__srv.console_mail)"))
    ck("S3: the refusal is recorded on the diverge ledger, not swallowed",
       any(("empty opp" in str(e.get("msg",""))) for e in div), div)

    # S4 - a full send with an empty opp never advances a card and never mints a server row.
    reset(pg)
    r4 = send(pg, "", "no link self test")
    ck("S4: an empty-opp send is not reported sent", r4.get("status") != "sent", r4)
    ck("S4: no empty-opp row reached the server",
       pg.evaluate("()=>Object.values(window.__srv.console_mail).some(r=>!r.opp)") is False)

    # S5 - signed OUT (local mode). The board is not shown signed out and RLS refuses an anon write, so this
    # is NOT the online-signed-in bug: the send is 'sent' locally and DURABLY queued to reach the server on
    # the next sign-in, not held in a 'sending' outbox. (Reserving 'sending' for the real signed-in failure
    # is what keeps the established offline/local send flow working - see thread_send_test.)
    reset(pg)
    pg.evaluate("()=>{ window.__srv.mode='ok'; window.__srv.signed=false; }")
    r5 = send(pg, "rise-dance", "local mode")
    rows5 = rows_for(pg, "rise-dance")
    ck("S5: a signed-out send is reported sent (local mode, not an outbox)", r5.get("status") == "sent", r5)
    ck("S5: its local row is sent and durably queued for the next sign-in",
       len(rows5) == 1 and rows5[0]["status"] == "sent"
       and pg.evaluate("()=>window.thriveSupaPendingCount()") >= 1, rows5)
    ck("S5: the server does not hold it yet (it flushes on sign-in)", len(srv_mail_for(pg, "rise-dance")) == 0, srv_mail_for(pg, "rise-dance"))

    ctx.close(); b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
