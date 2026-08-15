"""A send goes out exactly once, reports the truth, and moves the card (LAUNCH BLOCKER).

The device disaster: sending Cozy Calico reported a confirmed FAILURE, yet Resend delivered TWICE to the
real prospect and the card never advanced. Three faults compounded: the prospect was hit twice, the
console lied about the outcome, and the state never moved. Root cause, from the code: the ledger row and
the card advance were written only inside the try, after a clean parse; a relay TIMEOUT (fetchT aborts at
15s) that had already delivered server-side fell to the catch, which wrote NO row and advanced NOTHING, so
the operator saw "failed" and re-tapped, and the guard, which keyed on a "sent" row the timeout never
wrote, did not fire, and a second delivery went out.

The fix, proven here against a mocked relay that reproduces the real failure shapes (slow ack, delivered-
then-error, hard failure): a stable per-intent idempotency key, forwarded to the relay (Resend dedupes on
it); a DURABLE pending row written BEFORE the POST so a delivered send always carries a record and moves
the card; a response that resolves that one row to sent, stays pending on an unknown outcome (never a
false failure, never a blind retry, reconciled by re-tap under the same key), or marks it unsent only on a
KNOWN failure; and the quota counted once per real delivery.

The live Resend dashboard and WebKit are Thyab's device gate. What a Chromium sandbox can prove, the
client's exactly-once behaviour against every relay outcome, is proven here.
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

# ---- Source guards: the fix is in the code, not only in the harness ----------
app = open(f"{ROOT}/library/app.js").read()
relay = open(f"{ROOT}/relay/thrive-relay.gs").read()
ck("the send path carries a per-intent idempotency key (not per-click)",
   "function sendIdem(" in app and "idempotencyKey:idem" in app)
ck("a durable pending row is written BEFORE the response resolves it",
   'status:"pending", idem:idem' in app and 'updateMailByIdemLocal(idem, { status:"sent"' in app)
ck("the send is not reported sent until the SERVER confirms the row (the write invariant)",
   "async function supaConfirmMail(" in app and "const conf=await supaConfirmMail(" in app
   and 'status:"sending"' in app)
ck("an unknown outcome (timeout) stays pending and is not reported as a failure",
   "e.timeout" in app and 'toast(t("cmp_sent_confirming"))' in app)
ck("a known failure marks the row unsent so the card does not advance",
   'status:"unsent"' in app)
ck("the double-send guard still exists by name on the send path (#111)",
   "cmp_dupe_block" in app and "getMailLog().some" in app)
ck("the relay forwards the idempotency key to Resend so a retry delivers at most once",
   "d.idempotencyKey" in relay and "'Idempotency-Key'" in relay)

MOCK = r"""
() => {
  window.__mock = { mode:"success", deliveries:0, keys:{}, ids:{}, calls:0, lastKey:"" };
  const real = window.fetch.bind(window);
  window.fetch = async (url, opts) => {
    const u = String(url);
    if (u.indexOf("relay.mock") >= 0) {
      const M = window.__mock; M.calls++;
      let body = {}; try { body = JSON.parse((opts && opts.body) || "{}"); } catch(e) {}
      const key = body.idempotencyKey || ""; M.lastKey = key;
      const already = !!(key && M.keys[key]);
      const deliver = () => { if (key && !M.keys[key]) { M.keys[key] = 1; M.deliveries++; M.ids[key] = "re_" + M.deliveries; } };
      if (M.mode === "timeout") {            // delivered server-side, but the client's request aborts (the real bug shape)
        deliver(); const e = new Error("The relay is taking too long."); e.name = "AbortError"; throw e;
      }
      if (M.mode === "harddown") { throw new Error("Failed to fetch"); }             // relay unreachable: nothing delivered
      if (M.mode === "okfalse")  { return new Response(JSON.stringify({ ok:false, error:"invalid address", relay_version:5 }), {status:200}); }
      deliver();                                                                     // success: deduped by key
      const id = M.ids[key] || "re_x";
      return new Response(JSON.stringify({ ok:true, id:id, relay_version:5, delivered:true }), {status:200});
    }
    return real(url, opts);
  };
  window.pageSendable = async () => ({ ok:true, reason:"" });    // the live-page gate is a device concern; pass it here
  return true;
}
"""

def prep(pg, slug, subject, bodytext):
    # oppOf() reads the slug from an /opp/<slug> link in the body, so each scenario is its own opportunity.
    pg.evaluate("""(a)=>{
      document.getElementById('eto').value = a.to;
      document.getElementById('esubject').value = a.subject;
      const b = document.getElementById('ebody');
      b.innerHTML = '<a href=\"/opp/'+a.slug+'\">x</a> ' + a.body;
      if (window.thriveComposeRecordBody) try{ window.thriveComposeRecordBody(); }catch(e){}
    }""", {"to":"tracy@cozycalicobooks.com", "subject":subject, "slug":slug, "body":bodytext})

def send(pg, mode):
    pg.evaluate("(m)=>{ window.__mock.mode = m; }", mode)
    pg.eval_on_selector("#eSend", "e=>e.click()")
    pg.wait_for_timeout(700)

def rows_for(pg, slug):
    return pg.evaluate("(s)=>window.getMailLog().filter(m=>m && m.opp===s)", slug)
def lane(pg, slug):
    return pg.evaluate("""async (s)=>{ const opps=await window.mergedOpps(); let o=opps.find(x=>x.slug===s);
      if(!o){ o={slug:s}; } return window.effStage(o); }""", slug)
def quota_used(pg):
    return pg.evaluate("()=>{ try{ return window.quotaUsage().day; }catch(e){ return null; } }")
def deliveries(pg):
    return pg.evaluate("()=>window.__mock.deliveries")
def calls(pg):
    return pg.evaluate("()=>window.__mock.calls")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width":1280,"height":900})
    ctx.route("https://api.github.com/**", lambda r: r.fulfill(status=404, body="{}"))
    pg = ctx.new_page()
    # No ?slug: the composer's live-page gate (a device concern) short-circuits when there is no page slug,
    # so the send path runs in the sandbox. The opportunity each send belongs to is derived from the /opp/
    # link in the body (oppOf), exactly as it is in the product, so the card still advances by its real slug.
    pg.goto(f"{base}/library/compose.html")
    pg.wait_for_timeout(500)
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(700)
    pg.evaluate("()=>{ document.documentElement.classList.remove('gate-locked'); const g=document.getElementById('thriveGate'); if(g) g.remove(); }")
    pg.wait_for_selector("#eSend", timeout=15000)
    # A configured relay endpoint (intercepted by the mock) and a clean ledger/quota.
    pg.evaluate("""()=>{ localStorage.setItem('thrive_email_ep','http://relay.mock/exec');
        ['thrive_mail_v1','thrive_quota_v1','thrive_inbound_v1'].forEach(k=>localStorage.removeItem(k)); }""")
    pg.evaluate(MOCK)

    # D1 - relay acks and the send succeeds: one delivery, the card advances, no retry, UI shows sent.
    prep(pg, "cc-d1", "The shop, found", "Hello Tracy, a quick note about your books.")
    send(pg, "success")
    r1 = rows_for(pg, "cc-d1")
    ck("D1: exactly one delivery for one send", deliveries(pg) == 1, deliveries(pg))
    ck("D1: exactly one ledger row, status sent", len(r1) == 1 and r1[0]["status"] == "sent", r1)
    ck("D1: the card advances out of Ready (derives to sent)", lane(pg, "cc-d1") == "sent", lane(pg, "cc-d1"))
    ck("D1: the quota counted one real delivery", quota_used(pg) == 1, quota_used(pg))

    # D2 - the relay delivered but the client's request timed out (the exact Cozy Calico shape). The console
    # must NOT report a failure and must NOT send again; the row stays pending (the card already advanced),
    # and a reconcile (re-tap, same intent) resolves it to sent with NO second delivery.
    prep(pg, "cc-d2", "A second look", "Hello again Tracy, following up.")
    send(pg, "timeout")
    r2 = rows_for(pg, "cc-d2")
    ck("D2: the timed-out send delivered exactly once", deliveries(pg) == 2, deliveries(pg))
    ck("D2: its row is pending, never a false failure", len(r2) == 1 and r2[0]["status"] == "pending", r2)
    ck("D2: the card still advanced on the delivered (pending) send", lane(pg, "cc-d2") == "sent", lane(pg, "cc-d2"))
    ck("D2: no unsent/failed row was written for a delivered send",
       not any(x["status"] in ("unsent","failed") for x in r2), r2)
    calls_before = calls(pg)
    send(pg, "success")                                   # reconcile: same content -> same key -> Resend dedupes
    r2b = rows_for(pg, "cc-d2")
    ck("D2: the reconcile did not deliver a second time", deliveries(pg) == 2, deliveries(pg))
    ck("D2: the reconcile resolved the one row to sent", len(r2b) == 1 and r2b[0]["status"] == "sent", r2b)
    ck("D2: the quota still counts one delivery for this intent", quota_used(pg) == 2, quota_used(pg))

    # D3 - a re-tap of a completed send is refused by the guard; no second POST, no second delivery.
    prep(pg, "cc-d3", "Third time", "Hello Tracy, one more note.")
    send(pg, "success")
    d_after_first = deliveries(pg); calls_after_first = calls(pg)
    send(pg, "success")                                   # identical re-tap
    r3 = rows_for(pg, "cc-d3")
    ck("D3: a re-tap of a completed send makes no second relay call", calls(pg) == calls_after_first, (calls_after_first, calls(pg)))
    ck("D3: a re-tap delivers nothing new", deliveries(pg) == d_after_first, (d_after_first, deliveries(pg)))
    ck("D3: still exactly one row, status sent", len(r3) == 1 and r3[0]["status"] == "sent", r3)

    # D4 - a genuine hard failure: the relay answers that it did not send. Zero delivery, a TRUE failure,
    # the card stays in Ready, and a retry is allowed.
    prep(pg, "cc-d4", "Hard fail", "Hello Tracy, testing a failure.")
    d_before = deliveries(pg)
    send(pg, "okfalse")
    r4 = rows_for(pg, "cc-d4")
    ck("D4: a hard failure delivered nothing", deliveries(pg) == d_before, (d_before, deliveries(pg)))
    ck("D4: its row is unsent (a true failure, not a false success)", len(r4) == 1 and r4[0]["status"] == "unsent", r4)
    ck("D4: the card stays in Ready (does not advance on a failure)", lane(pg, "cc-d4") in ("draft","live"), lane(pg, "cc-d4"))
    # Three real deliveries so far (D1, D2, D3); the D4 failure adds none.
    ck("D4: the quota did not count a non-delivery", quota_used(pg) == 3, quota_used(pg))

    # D5 - a retry after a genuine failure: exactly one delivery on the successful attempt, idempotency holds.
    send(pg, "success")                                   # retry the same intent (cc-d4), now the relay is up
    r5 = rows_for(pg, "cc-d4")
    ck("D5: the retry delivered exactly once", deliveries(pg) == d_before + 1, (d_before, deliveries(pg)))
    ck("D5: the one row is now sent (no duplicate row)", len(r5) == 1 and r5[0]["status"] == "sent", r5)
    ck("D5: the card now advances", lane(pg, "cc-d4") == "sent", lane(pg, "cc-d4"))

    # D6 - across the whole run the quota counted once per REAL delivery, never per attempt. Three real
    # deliveries so far (D1, D2, D3) plus D5's one, and D4's failure counted nothing.
    ck("D6: the quota equals the number of real deliveries, counted once each",
       quota_used(pg) == deliveries(pg), (quota_used(pg), deliveries(pg)))
    ck("D6: four intents delivered, one failure delivered nothing", deliveries(pg) == 4, deliveries(pg))

    ctx.close(); b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
