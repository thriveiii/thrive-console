"""The durable send queue's WORKER, in the relay (P8 / D6 + R3). Engine-independent; Thyab deploys the relay.

The relay is Apps Script and cannot run in this sandbox, but its queue logic is plain JavaScript. This test
(1) reads the relay source to hold the invariants structurally, and (2) EXTRACTS the outbox functions and
runs them in Node against a mock store + mock Resend, to prove the ones that matter behaviourally:
  - the claim is idempotent (update-where-status-queued under the lock): two overlapping ticks never
    double-send one row, so the row count still equals the recipient count (Evidence 5);
  - one message per recipient (single To), the row id is the at-most-once idempotency key;
  - a row flips to sent only after the provider accepts, and to failed (with the reason) on a throw;
  - pause holds the un-sent tail; resume re-queues it.
"""
import os, re, subprocess, tempfile
ROOT = "/home/user/thrive-console"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

relay = open(os.path.join(ROOT, "relay/thrive-relay.gs")).read()

# ---- structural invariants (the source is the record; Thyab deploys it) ----
ck("the relay declares v6 (the queue changed the request/response shape)", "RELAY_VERSION = 6" in relay)
ck("the queue is a relay-owned store key (store.outbox), like store.inbound", "store.outbox" in relay)
ck("outbox_push is idempotent by mid (a retried push never duplicates a row)",
   "function outboxPush_" in relay and "seen[r.mid]" in relay and "continue" in relay[relay.index("function outboxPush_"):])
send = relay[relay.index("function sendMail_"): relay.index("function json_")] if "function sendMail_" in relay else ""
worker = relay[relay.index("function sendQueue_"): relay.index("function installSendTrigger")]
ck("the claim flips queued->sending INSIDE withStore_ (the lock serializes every tick)",
   "withStore_(function" in worker and "status = 'sending'" in worker and "status === 'queued'" in worker)
ck("the worker sends one single-To message per row (no BCC, no multi-recipient To)",
   "to: [d.to]" in send)
ck("each row carries its id as the Resend idempotency key (at most once on a re-claim)",
   "idempotencyKey: row.mid" in worker and "d.idempotencyKey" in relay)
ck("a row flips to sent only after sendMail_ returns; a throw flips it to failed with the reason",
   "flipOutbox_(row.mid, { status: 'sent'" in worker and "status: 'failed', error:" in worker)
ck("a stuck 'sending' row is re-claimed (a dead worker never strands a recipient)",
   "OUTBOX_STUCK_MS" in worker and "status = 'queued'" in worker)
ck("the send trigger installs like the scan trigger (removed first, then created)",
   "function installSendTrigger" in relay and "newTrigger('sendQueue_')" in relay)
ck("the ops are registered in doPost (push / status / control / run)",
   all(op in relay for op in ["'outbox_push'","'outbox_status'","'outbox_control'","'outbox_run'"]))

# ---- behavioural: extract the outbox functions and run them in Node ----
start = relay.index("var OUTBOX_BATCH")
end = relay.index("/* ===================== HTTP")
outbox_src = relay[start:end]

HARNESS = r"""
// ---- mocks that stand in for the Apps Script runtime ----
var __store = { outbox: [] };
function storeRead_(){ return __store; }
function withStore_(fn){ return fn(__store); }        // synchronous + atomic: models the LockService serialization
var __sent = [];
var __reentered = false;
function sendMail_(d){
  // Model an overlapping tick: while tick 1 is mid-send (its rows already flipped to 'sending'), a second
  // tick fires. If the claim is idempotent, tick 2 sees no 'queued' rows and sends nothing.
  if(!__reentered){ __reentered = true; sendQueue_(); }
  __sent.push({ to: d.to, idem: d.idempotencyKey });
  if(d.__fail) throw new Error("provider refused");
  return { ok:true, id:"id_"+d.idempotencyKey };
}
var ScriptApp = { getProjectTriggers:function(){return[];},
  newTrigger:function(){return{timeBased:function(){return{everyMinutes:function(){return{create:function(){}};}};}};} };

__OUTBOX__

// ---- scenario: 3 recipients due now, 2 due far in the future ----
var now = new Date().getTime();       // the worker reads the real clock, so the dues are relative to it
function iso(ms){ return new Date(ms).toISOString(); }
var rows = [];
for (var i=0;i<3;i++) rows.push({ mid:"m"+i, opp:"camp1", to:"r"+i+"@x.example", subject:"Hi", html:"<p>h</p>", text:"h", due:iso(now-1000) });
for (var j=3;j<5;j++) rows.push({ mid:"m"+j, opp:"camp1", to:"r"+j+"@x.example", subject:"Hi", html:"<p>h</p>", text:"h", due:iso(now+3600000) });
outboxPush_(rows);
outboxPush_(rows);                    // a retried push: must not duplicate

var out = [];
out.push(["outbox holds exactly 5 rows after a duplicate push", storeRead_().outbox.length === 5, storeRead_().outbox.length]);

// one tick. With the re-entrant overlapping tick inside sendMail_, a broken claim would double-send.
var res = sendQueue_();
var mids = __sent.map(function(s){ return s.idem; });
var uniq = {}; mids.forEach(function(m){ uniq[m]=(uniq[m]||0)+1; });
var anyDouble = Object.keys(uniq).some(function(k){ return uniq[k] > 1; });
out.push(["a tick sends the 3 due rows, one message each (single To)", __sent.length === 3, __sent.length]);
out.push(["overlapping ticks never double-send a row (idempotent claim, Evidence 5)", !anyDouble, uniq]);
out.push(["the 2 future rows stay queued (not yet due)",
          storeRead_().outbox.filter(function(r){return r.status==='queued';}).length === 2, null]);
out.push(["the 3 due rows are now sent (only after the provider accepted)",
          storeRead_().outbox.filter(function(r){return r.status==='sent';}).length === 3, null]);

// pause holds the un-sent tail; resume re-queues it
outboxControl_("camp1", "pause");
out.push(["pause holds the queued tail", storeRead_().outbox.filter(function(r){return r.status==='held';}).length === 2, null]);
outboxControl_("camp1", "resume", { m3: iso(now-500), m4: iso(now-500) });
out.push(["resume re-queues the held tail with the fresh dues",
          storeRead_().outbox.filter(function(r){return r.status==='queued';}).length === 2, null]);

// a failed send is visible, never silent
__store.outbox.forEach(function(r){ if(r.status==='queued'){ r.due = iso(now-1000); } });
__store.outbox[3].__fail = true;      // mark m3 to fail at the provider
// (sendMail_ reads d.__fail from the row we pass; copy the flag onto the send call)
var realSend = sendMail_;
sendMail_ = function(d){ var row = storeRead_().outbox.filter(function(x){return x.mid===d.idempotencyKey;})[0]; if(row&&row.__fail) d.__fail=true; return realSend(d); };
sendQueue_();
out.push(["a provider refusal flips the row to failed with a reason, never silently",
          storeRead_().outbox.filter(function(r){return r.status==='failed' && r.error;}).length >= 1, null]);

out.forEach(function(o){ console.log((o[1]?"PASS ":"FAIL ")+o[0]+(o[1]?"":("  <"+JSON.stringify(o[2])+">"))); });
"""

harness = HARNESS.replace("__OUTBOX__", outbox_src)
with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, dir="/tmp/claude-0") as f:
    f.write(harness); path = f.name
try:
    r = subprocess.run(["node", path], capture_output=True, text=True, timeout=60)
    print(r.stdout.strip())
    if r.returncode != 0:
        ck("the extracted worker runs in Node", False, r.stderr[-500:])
    else:
        for line in r.stdout.strip().splitlines():
            if line.startswith("FAIL "): fails.append(line[5:])
finally:
    try: os.unlink(path)
    except OSError: pass

print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL QUEUE RELAY CHECKS PASS"))
raise SystemExit(1 if fails else 0)
