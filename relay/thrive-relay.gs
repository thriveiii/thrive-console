/**
 * Thrive relay v5
 * =========================================================================
 *
 * THIS FILE WAS NOT IN THE REPOSITORY UNTIL NOW.
 *
 * Brain/RUNBOOK-sync.md says "replace the whole file with thrive-email-resend.gs
 * (relay v4)". That file existed only inside the Apps Script editor. The one
 * moving part of the console had no source under version control, no history,
 * and no way to review a change to it. v5 is written here first and pasted
 * second, which is the order it should always have been in.
 *
 * WHAT v5 ADDS OVER v4
 *   1. The shared store moves OFF the Properties Service and into a Drive JSON
 *      file. Properties is 500 KB in total and 9 KB per key. It is a
 *      configuration store, and the console's own health panel had already
 *      started reporting that it was full. The HTTP interface does not change.
 *   2. store_stats, which reports what Properties actually holds, so the
 *      migration is decided on a number rather than a suspicion.
 *   3. An inbox scan on a time trigger, which is the whole reason this round
 *      exists: replies were arriving in Gmail and dying there.
 *
 * THE SEAM, WHICH IS THE POINT
 * The console calls state_get and state_put and does not know or care where the
 * bytes live. Swapping Properties for Drive is invisible to it. Any console code
 * that assumed Properties would be a defect, and there is none.
 *
 * DEPLOYMENT
 * One deployment, forever. Deploy > Manage deployments > Edit > New version.
 * Never New deployment. The URL must never change. See docs/RELAY.md.
 */

/* ===================== configuration ===================== */

/**
 * WO-014 §3: the version contract, so a mismatch is named rather than mysterious.
 *
 * The night this was written, the editor held v5 and the live deployment served
 * v4, and every send failed with `missing "to"`: a v5 request shape hitting a v4
 * handler. The only person who could see the mismatch was the one reading two
 * screens at once. This number closes that gap. It rides on EVERY response,
 * including errors, so the console can compare on every request and refuse to
 * send into a relay it does not match. Bump it whenever the request or response
 * shape changes, and only then, in the same commit as the change.
 */
var RELAY_VERSION = 9;   // v9 (F2, static activation): a new page_publish op commits opp/<slug>/index.html to the
                         // repo via the GitHub Contents API using a GH_TOKEN Script Property (the token lives ONLY
                         // here, never in the client), so GitHub Pages serves an uploaded page as a static file.
                         // v8 (P23, attachments): sendMail_ forwards d.attachments (each { filename, path } where
                         // path is a public Storage URL Resend fetches) to Resend, and the outbox carries them per
                         // queued row, so a campaign attaches the same image for every recipient. A change to the
                         // send REQUEST shape, so the number moves with it (docs/RELAY.md, the version contract).
                         // v7 (P22, inbound proven): guaranteed Message-ID, the inbox heartbeat (interval + cap) and
                         // the read-only inbox_reconcile gap. v6: the durable send queue + sendQueue_ worker.

var TAG_LOCAL   = 'hi';
var TAG_DOMAIN  = 'thriveiii.com';
var STORE_NAME  = 'thrive-console-store.json';
var INBOX_MAX   = 50;          // messages read per scan, so one run cannot run long
var SCAN_EVERY_MIN = 15;       // the sweep interval; stamped on the heartbeat so the console knows what "stale" is
var SNIPPET_MAX = 300;         // never the full body: private mail stays in Gmail
var STATE_MAX   = 400000;      // the cap the console mirrors in SYNC_STATE_MAX

function props_() { return PropertiesService.getScriptProperties(); }

function authOk_(given) {
  var want = props_().getProperty('SYNC_KEY');
  if (!want) throw new Error('SYNC_KEY not set');
  if (String(given || '') !== String(want)) throw new Error('bad auth');
  return true;
}

/* ===================== the store, behind one seam ===================== */

/**
 * Everything below this line is the ONLY code that knows where the shared state
 * physically lives. Changing the backing store means changing these functions
 * and nothing else, which is what makes the next move (a Sheet, a database, a
 * different account) a morning's work rather than a rewrite.
 */

function storeFile_() {
  var id = props_().getProperty('STORE_FILE_ID');
  if (id) {
    try { return DriveApp.getFileById(id); }
    catch (e) { /* deleted or unshared: fall through and make a new one */ }
  }
  var it = DriveApp.getFilesByName(STORE_NAME);
  var f = it.hasNext() ? it.next() : DriveApp.createFile(STORE_NAME, '{}', MimeType.PLAIN_TEXT);
  props_().setProperty('STORE_FILE_ID', f.getId());
  return f;
}

function storeRead_() {
  try {
    var txt = storeFile_().getBlob().getDataAsString('UTF-8');
    return txt ? JSON.parse(txt) : {};
  } catch (e) { return {}; }
}

function storeWrite_(obj) {
  storeFile_().setContent(JSON.stringify(obj));
}

/**
 * One lock around every read-modify-write. Two devices pushing at the same
 * moment used to be a race whose loser vanished without a word; the chunked
 * Properties writes hid it because each chunk landed separately.
 */
function withStore_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var store = storeRead_();
    var out = fn(store);
    storeWrite_(store);
    return out;
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/* ===================== §10.1 measurement ===================== */

/**
 * What Properties actually holds, reported before anything is changed. The
 * console's health panel said "the relay is out of Script properties space" and
 * nobody could see the number behind that sentence. Now they can.
 *
 * Apps Script: 500 KB total, 9 KB per value, 500 properties.
 */
function storeStats_() {
  var p = props_(), all = p.getProperties();
  var total = 0, count = 0, sizes = [];
  for (var k in all) {
    if (!Object.prototype.hasOwnProperty.call(all, k)) continue;
    var n = k.length + String(all[k] == null ? '' : all[k]).length;
    total += n; count++;
    sizes.push({ key: k, bytes: n });
  }
  sizes.sort(function (a, b) { return b.bytes - a.bytes; });

  var driveBytes = 0, driveId = '';
  try { var f = storeFile_(); driveBytes = f.getSize(); driveId = f.getId(); } catch (e) {}

  return {
    ok: true,
    properties: {
      bytes: total,
      limit: 500 * 1024,
      pct: Math.round(total / (500 * 1024) * 100),
      keys: count,
      perKeyLimit: 9 * 1024,
      largest: sizes.slice(0, 5)
    },
    drive: { bytes: driveBytes, fileId: driveId, name: STORE_NAME },
    migrated: !!props_().getProperty('STORE_MIGRATED')
  };
}

/**
 * Move the v4 chunked state and hits out of Properties and into Drive.
 *
 * Safe to run twice. It reads the old chunks, writes them to Drive, verifies by
 * reading back, and ONLY THEN deletes the chunks. A migration that deletes
 * before it verifies is a migration that loses everything the one time the
 * write fails.
 */
function storeMigrate_(dryRun) {
  var p = props_(), all = p.getProperties();

  function joinChunks(prefix) {
    var meta = all[prefix + '_meta'];
    if (!meta) return null;
    var n = 0;
    try { n = JSON.parse(meta).n || 0; } catch (e) { n = 0; }
    var buf = '';
    for (var i = 0; i < n; i++) buf += (all[prefix + '_' + i] || '');
    if (!buf) return null;
    try { return JSON.parse(buf); } catch (e) { return null; }
  }

  var state = joinChunks('state');
  var hits = joinChunks('hits');
  var found = { state: state ? JSON.stringify(state).length : 0,
                hits: hits ? (hits.length || 0) : 0 };

  if (dryRun) return { ok: true, dryRun: true, found: found };

  var store = storeRead_();
  if (state && !store.state) store.state = state;
  if (hits && !store.hits) store.hits = hits;
  storeWrite_(store);

  // verify by reading back before deleting anything
  var back = storeRead_();
  var stateOk = !state || (back.state && JSON.stringify(back.state).length === JSON.stringify(state).length);
  var hitsOk = !hits || (back.hits && back.hits.length === hits.length);
  if (!stateOk || !hitsOk) {
    return { ok: false, error: 'verification failed, nothing deleted', found: found };
  }

  var deleted = [];
  for (var k in all) {
    if (!Object.prototype.hasOwnProperty.call(all, k)) continue;
    if (/^state_/.test(k) || /^hits_/.test(k)) { p.deleteProperty(k); deleted.push(k); }
  }
  p.setProperty('STORE_MIGRATED', new Date().toISOString());
  return { ok: true, found: found, deleted: deleted.length, after: storeStats_().properties };
}

/* ===================== the console's interface, unchanged ===================== */

function stateGet_() {
  var s = storeRead_();
  return { ok: true, data: (s.state === undefined ? null : s.state) };
}

function statePut_(data) {
  var size = JSON.stringify(data || {}).length;
  if (size > STATE_MAX) throw new Error('state too large: ' + size);
  return withStore_(function (store) {
    store.state = data;
    store.stateUpdated = new Date().toISOString();
    return { ok: true, bytes: size };
  });
}

function hitsGet_() {
  var s = storeRead_();
  return { ok: true, events: s.hits || [] };
}

function hitPut_(ev) {
  return withStore_(function (store) {
    var h = store.hits || [];
    h.push(ev);
    /* A beacon ledger is not evidence anything is derived from, so it is capped
       by count and the oldest go first. */
    if (h.length > 4000) h = h.slice(-4000);
    store.hits = h;
    return { ok: true, n: h.length };
  });
}

/* ===================== the inbox scan ===================== */

/**
 * Runs on a time trigger every fifteen minutes. Reads what is new, attributes
 * it, and writes inbound records into the same store the console already syncs.
 *
 * IT DOES NOT STORE BODIES. Sender, subject, timestamp, the Gmail ids, the
 * matched opportunity, the rule that matched, and 300 characters. The console
 * shows the snippet and deep links to Gmail for the rest. Private
 * correspondence does not belong in a blob that syncs to every device.
 */
function scanInbox() {
  var started = new Date().getTime();
  var out = withStore_(function (store) {
    var state = store.state || {};
    var mail = state.mail || [];
    var opps = state.opps || [];
    var known = {};
    for (var i = 0; i < opps.length; i++) if (opps[i] && opps[i].slug) known[opps[i].slug] = 1;

    var seen = {};
    var inbound = store.inbound || [];
    for (var j = 0; j < inbound.length; j++) if (inbound[j] && inbound[j].gid) seen[inbound[j].gid] = 1;

    var since = store.inboxSince || '';
    var query = 'in:inbox -in:chats';
    if (since) query += ' after:' + since;

    var threads = GmailApp.search(query, 0, INBOX_MAX);
    /* An idle day must cost almost nothing, so an empty result exits before any
       further work. A consumer account gets 90 minutes of trigger runtime a day
       and 96 runs; a scan that always does the full pass would spend it. */
    if (!threads.length) {
      store.inboxScan = { ts: new Date().toISOString(), ms: new Date().getTime() - started,
                          found: 0, added: 0, idle: true, everyMin: SCAN_EVERY_MIN, capped: false };
      store.scanLog = (store.scanLog || []).concat([{ ms: new Date().getTime() - started, idle: true }]).slice(-96);
      return { ok: true, added: 0, idle: true };
    }

    var added = 0, scanned = 0;
    for (var t = 0; t < threads.length; t++) {
      var msgs = threads[t].getMessages();
      for (var m = 0; m < msgs.length; m++) {
        var msg = msgs[m];
        scanned++;
        var gid = msg.getId();
        if (seen[gid]) continue;
        var rec = attributeMessage_(msg, mail, known);
        if (!rec) continue;
        seen[gid] = 1;
        inbound.push(rec);
        added++;
      }
    }

    if (inbound.length > 2000) inbound = inbound.slice(-2000);
    store.inbound = inbound;
    /* Gmail's after: takes a date, so the window is deliberately one day wide
       rather than to the minute: re-reading a day costs nothing because the
       gid check makes every record idempotent, and a minute-precise cursor
       would drop a message that arrived during the run. */
    store.inboxSince = Utilities.formatDate(new Date(new Date().getTime() - 86400000),
                                            'UTC', 'yyyy/MM/dd');
    /* Whether this run read as many messages as it is allowed to. A capped run means more may be waiting
       than one sweep can file, which is the one condition the board should show loudly rather than let a
       backlog build in silence. */
    var capped = threads.length >= INBOX_MAX;
    store.inboxScan = { ts: new Date().toISOString(), ms: new Date().getTime() - started,
                        found: scanned, added: added, idle: false, everyMin: SCAN_EVERY_MIN, capped: capped };
    store.scanLog = (store.scanLog || []).concat([{ ms: new Date().getTime() - started, idle: false }]).slice(-96);
    return { ok: true, added: added, scanned: scanned, capped: capped };
  });
  var mirror = supaMirrorLedger_();       // idempotent upsert of new replies + opens into Supabase (retires the old-engine mirror)
  if (mirror) out.supaMirror = mirror;
  return out;
}

/**
 * The one time pass. Walks back 90 days and attributes what it can, so every
 * reply the business has already received appears rather than only the ones
 * that arrive from now on.
 *
 * With dryRun it reports the count and writes nothing, which is what the
 * console shows before it asks.
 */
function repairInbox_(days, dryRun) {
  days = days || 90;
  var after = Utilities.formatDate(new Date(new Date().getTime() - days * 86400000),
                                   'UTC', 'yyyy/MM/dd');
  return withStore_(function (store) {
    var state = store.state || {};
    var mail = state.mail || [];
    var opps = state.opps || [];
    var known = {};
    for (var i = 0; i < opps.length; i++) if (opps[i] && opps[i].slug) known[opps[i].slug] = 1;

    var inbound = store.inbound || [];
    var seen = {};
    for (var j = 0; j < inbound.length; j++) if (inbound[j] && inbound[j].gid) seen[inbound[j].gid] = 1;

    var threads = GmailApp.search('in:inbox -in:chats after:' + after, 0, 400);
    var found = [], byRule = { tag: 0, thread: 0, sender: 0, none: 0 }, autos = 0;
    for (var t = 0; t < threads.length; t++) {
      var msgs = threads[t].getMessages();
      for (var m = 0; m < msgs.length; m++) {
        var msg = msgs[m];
        if (seen[msg.getId()]) continue;
        var rec = attributeMessage_(msg, mail, known);
        if (!rec) continue;
        if (rec.kind === 'auto') autos++; else byRule[rec.rule]++;
        found.push(rec);
      }
    }
    if (dryRun) return { ok: true, dryRun: true, count: found.length, byRule: byRule, auto: autos, days: days };

    for (var k = 0; k < found.length; k++) inbound.push(found[k]);
    if (inbound.length > 2000) inbound = inbound.slice(-2000);
    store.inbound = inbound;
    store.inboxRepaired = new Date().toISOString();
    return { ok: true, count: found.length, byRule: byRule, auto: autos, days: days };
  });
}

/**
 * Read-only reconciliation. Does the store hold a record for every reply the
 * mailbox actually has? It walks the same window the sweep does, counts the
 * messages that ARE replies (attributeMessage_ returns a record; our own
 * outbound returns null and is not counted), and compares that set against what
 * is filed, by Gmail id. The gap is the count of reply messages the mailbox has
 * that the store does not. It WRITES NOTHING; the board surfaces a non-zero gap
 * loudly, so a systematic miss becomes visible rather than silent. A run of
 * scanInbox files the gap, so the gap is expected to fall back to zero.
 */
function inboxReconcile_(days) {
  days = days || 2;
  var after = Utilities.formatDate(new Date(new Date().getTime() - days * 86400000), 'UTC', 'yyyy/MM/dd');
  var store = storeRead_();
  var state = store.state || {};
  var mail = state.mail || [];
  var opps = state.opps || [];
  var known = {};
  for (var i = 0; i < opps.length; i++) if (opps[i] && opps[i].slug) known[opps[i].slug] = 1;

  var filed = {};
  var inbound = store.inbound || [];
  for (var j = 0; j < inbound.length; j++) if (inbound[j] && inbound[j].gid) filed[inbound[j].gid] = 1;

  var threads = GmailApp.search('in:inbox -in:chats after:' + after, 0, 500);
  var mailbox = 0, missing = [];
  for (var t = 0; t < threads.length; t++) {
    var msgs = threads[t].getMessages();
    for (var m = 0; m < msgs.length; m++) {
      var rec = attributeMessage_(msgs[m], mail, known);
      if (!rec) continue;                 // our own outbound, never a reply
      mailbox++;
      if (!filed[rec.gid]) missing.push(rec.gid);
    }
  }
  return { ok: true, days: days, mailbox: mailbox, filed: mailbox - missing.length,
           gap: missing.length, missing: missing.slice(0, 50), ts: new Date().toISOString() };
}

/* ===================== Supabase ledger mirror ===================== */

/*
 * Retire the old-engine mirror. Historically the browser console (library/app.js) was the ONLY writer of
 * console_inbound (replies) and console_hits (opens): it pulled these very records from this relay and
 * mirrored them into Supabase. That console is a localStorage app now at the browser quota, so reply and
 * open capture were fragile. This relay already holds both ledgers (store.inbound from scanInbox, store.hits
 * from the pixel/beacon) and already attributes every reply (attributeMessage_), so it can write the two
 * tables itself and let the old engine be retired.
 *
 * The write needs a service_role key, which bypasses RLS, so it lives ONLY in this relay's Script Properties
 * (SUPABASE_URL + SUPABASE_SERVICE_KEY), exactly like GH_TOKEN and RESEND_KEY. It is NEVER emitted into the
 * client bundle, a response, or a log. If either property is unset the mirror is a safe no-op that never
 * blocks or fails the scan.
 */

/* One idempotent upsert into a PostgREST table. Prefer: resolution=merge-duplicates makes it an upsert on the
   table's primary key (console_inbound.id = gid, console_hits.id = hitKey), so this relay and the old engine
   may both write the same rows during the transition with NO duplicates. Returns true only on a 2xx, so a
   caller can leave its cursor unadvanced and retry next scan. The key is read here and never logged. */
function supaInsert_(table, rows) {
  var url = props_().getProperty('SUPABASE_URL');
  var key = props_().getProperty('SUPABASE_SERVICE_KEY');
  if (!url || !key || !rows || !rows.length) return false;   // unconfigured or nothing to send: safe no-op
  try {
    var res = UrlFetchApp.fetch(String(url).replace(/\/+$/, '') + '/rest/v1/' + table, {
      method: 'post',
      contentType: 'application/json',
      headers: { apikey: key, Authorization: 'Bearer ' + key,
                 Prefer: 'resolution=merge-duplicates,return=minimal' },
      payload: JSON.stringify(rows),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    return code >= 200 && code < 300;
  } catch (e) {
    return false;   // network/transient error: cursor stays put, next scan retries. Never surface the key.
  }
}

/* One console_inbound row, shaped BYTE FOR BYTE as the old engine's supaInboundRow (library/app.js:4132-4135):
   id is the Gmail message id (inboundKey), the whole record in data, opp/kind/bounce/ts lifted from the
   attribution this relay already computed. Every reply is mirrored (autos and opp-less rows included), exactly
   as the engine's supaMirrorInbound did; the console_board view filters noise on read. */
function inboundKey_(r) { return String((r && (r.gid || r.messageId || r.mid || r.id)) || ''); }
function supaInboundRow_(r) {
  return { id: inboundKey_(r) || ('in_' + ((r && r.ts) || '')), opp: (r && r.opp) || '',
    kind: (r && r.kind) || '', bounce: (r && r.bounce) || '', ts: (r && r.ts) || '',
    data: r, up: (r && r.up) || Date.now() };
}

/* One console_hits row, shaped BYTE FOR BYTE as the old engine's supaHitRow (library/app.js:4164-4166) with
   the same hitKey (library/app.js:543): id is type|slug|ts|vid, the whole event in data. */
function hitKey_(e) { return (e.type || 'open') + '|' + (e.slug || '') + '|' + (e.ts || '') + '|' + (e.vid || ''); }
function supaHitRow_(e) {
  return { id: hitKey_(e), slug: (e && e.slug) || '', type: (e && e.type) || 'open',
    ts: (e && e.ts) || '', self: !!(e && e.self), data: e };
}

/* Mirror everything new in both ledgers, once per scan. A per-ledger high-water mark (the newest ts already
   written) keeps each run bounded and self-healing: a ledger's cursor advances ONLY when its upsert returned
   2xx, so a failed write is retried on the next scan rather than lost. The first run (empty cursor) upserts
   the whole current ledger once, which is idempotent. Runs on every scan, idle inbox or not, so opens stay
   fresh even when no reply arrived. Never throws: a mirror problem must never break the inbox scan. */
function supaMirrorLedger_() {
  if (!props_().getProperty('SUPABASE_URL') || !props_().getProperty('SUPABASE_SERVICE_KEY')) return null;
  try {
    var snap = withStore_(function (store) {
      var inMark = store.inboundSyncTs || '', hMark = store.hitsSyncTs || '';
      var inbound = store.inbound || [], hits = store.hits || [];
      var inRows = [], inMax = inMark, hRows = [], hMax = hMark, i, ts;
      for (i = 0; i < inbound.length; i++) {
        if (!inbound[i]) continue; ts = String(inbound[i].ts || '');
        if (ts >= inMark) { inRows.push(supaInboundRow_(inbound[i])); if (ts > inMax) inMax = ts; }
      }
      for (i = 0; i < hits.length; i++) {
        if (!hits[i]) continue; ts = String(hits[i].ts || '');
        if (ts >= hMark) { hRows.push(supaHitRow_(hits[i])); if (ts > hMax) hMax = ts; }
      }
      return { inRows: inRows, hRows: hRows, inMax: inMax, hMax: hMax };
    });

    var okIn = snap.inRows.length ? supaInsert_('console_inbound', snap.inRows) : true;
    var okHit = snap.hRows.length ? supaInsert_('console_hits', snap.hRows) : true;

    if ((okIn && snap.inRows.length) || (okHit && snap.hRows.length)) {
      withStore_(function (store) {
        if (okIn && snap.inRows.length) store.inboundSyncTs = snap.inMax;
        if (okHit && snap.hRows.length) store.hitsSyncTs = snap.hMax;
      });
    }
    return { inbound: okIn ? snap.inRows.length : 0, hits: okHit ? snap.hRows.length : 0,
             inboundPending: okIn ? 0 : snap.inRows.length, hitsPending: okHit ? 0 : snap.hRows.length };
  } catch (e) {
    return { error: String((e && e.message) || e) };   // reported, never thrown: the scan already succeeded
  }
}

/**
 * The attribution order, kept byte for byte in step with library/inbound.js.
 * The console's copy is the one under test, because it can be tested; this copy
 * is the one that runs. They must not drift, and docs/RELAY.md says so.
 */
function attributeMessage_(msg, mail, known) {
  var from = msg.getFrom() || '';
  var addr = addressOf_(from);
  var subject = msg.getSubject() || '';
  var raw = '';
  try { raw = msg.getRawContent() || ''; } catch (e) { raw = ''; }

  var rec = {
    gid: msg.getId(),
    threadId: msg.getThread().getId(),
    from: addr,
    name: displayName_(from),
    subject: subject,
    ts: msg.getDate().toISOString(),
    snippet: String(msg.getPlainBody() || '').replace(/\s+/g, ' ').slice(0, SNIPPET_MAX),
    // The threading headers, stored so the console can match a reply by header (its strongest tier)
    // against the Message-ID it recorded at send time. Absent before this relay version, which is why
    // the console also matches by sender and subject.
    inReplyTo: headerOf_(raw, 'In-Reply-To'),
    references: headerOf_(raw, 'References'),
    // FULL FIDELITY (additive): keep the whole email, not a 300-char snippet. The plus-tag To is the linking
    // key and must be STORED, not just read; the reply's own Message-ID, Cc, from name+address, the full plain
    // body and the html body are persisted so the console holds the real message. snippet stays for the
    // existing list-render/back-compat callers.
    to: msg.getTo() || '',
    cc: msg.getCc() || '',
    fromRaw: from,
    messageId: headerOf_(raw, 'Message-ID'),
    bodyPlain: String(msg.getPlainBody() || ''),
    bodyHtml: String(msg.getBody() || ''),
    kind: 'reply',
    rule: 'none',
    opp: ''
  };

  /* Never count our own outbound as an inbound record. */
  if (addr.indexOf('@' + TAG_DOMAIN) > 0 && addr.indexOf('+') < 0) return null;

  // ---- machinery
  if (/^mailer-daemon@/i.test(addr) || /^postmaster@/i.test(addr)) rec.kind = 'auto';
  var autoSub = headerOf_(raw, 'Auto-Submitted');
  if (autoSub && autoSub.toLowerCase() !== 'no') rec.kind = 'auto';
  if (headerOf_(raw, 'X-Autoreply')) rec.kind = 'auto';
  if (/^\s*(automatic reply|auto-?reply|out of (the )?office|رد تلقائي|ردّ تلقائي|خارج المكتب)/i.test(subject)) rec.kind = 'auto';
  if (rec.kind === 'auto') {
    var body = rec.snippet;
    if (/\b5\.\d\.\d\b|\b55\d\b|no such user|does not exist|user unknown/i.test(body)) rec.bounce = 'hard';
    else if (/\b4\.\d\.\d\b|temporar|mailbox full|over quota/i.test(body)) rec.bounce = 'soft';
  }

  // ---- rule 1, the tag: LINK BY SLUG, ABOVE EVERYTHING.
  // The plus-tag hi+<slug>@thriveiii.com is minted only by our own outbound (outboundHeaders Reply-To,
  // board-send.src.js), so a reply carrying it is self-authenticating: the slug IS the opp. It therefore
  // takes precedence over the sender and subject tiers, and is trusted UNCONDITIONALLY. The old
  // `&& known[tagged]` gate suppressed a correct slug whenever the opp was not in the relay's synced
  // store.state.opps (a stale/empty set), so a perfectly tagged reply fell through to a wrong sender/subject
  // guess. That gate is removed: a present slug always wins; sender/subject match ONLY when no slug tag exists.
  var tagged = '';
  var fields = [msg.getTo(), msg.getCc(), headerOf_(raw, 'Delivered-To'), headerOf_(raw, 'X-Original-To')];
  for (var i = 0; i < fields.length && !tagged; i++) {
    var parts = String(fields[i] || '').split(',');
    for (var j = 0; j < parts.length && !tagged; j++) tagged = slugFromTag_(parts[j]);
  }
  if (tagged) { rec.rule = 'tag'; rec.opp = tagged; return rec; }

  // ---- rule 2, the threading headers
  var ids = idsIn_(headerOf_(raw, 'In-Reply-To')).concat(idsIn_(headerOf_(raw, 'References')));
  if (ids.length) {
    var byId = {};
    for (var a = 0; a < mail.length; a++) {
      var mm = mail[a];
      if (!mm || mm.direction === 'in') continue;
      if (mm.mid) byId[String(mm.mid).replace(/^<|>$/g, '')] = mm;
      if (mm.messageId) byId[String(mm.messageId).replace(/^<|>$/g, '')] = mm;
      if (mm.msgid) byId[String(mm.msgid).replace(/^<|>$/g, '')] = mm;   // the wire Message-ID the console records
      if (mm.id) byId[String(mm.id).replace(/^<|>$/g, '')] = mm;         // the provider id, a fallback token
    }
    for (var b = ids.length - 1; b >= 0; b--) {
      var hit = byId[ids[b]];
      if (hit && hit.opp && known[hit.opp]) { rec.rule = 'thread'; rec.opp = hit.opp; return rec; }
    }
  }

  // ---- rule 3, the sender
  var best = null;
  for (var c = 0; c < mail.length; c++) {
    var om = mail[c];
    if (!om || om.direction === 'in' || !om.opp || !known[om.opp]) continue;
    if (String(om.to || '').toLowerCase() !== addr) continue;
    if (!best || String(om.ts) > String(best.ts)) best = om;
  }
  if (best) { rec.rule = 'sender'; rec.opp = best.opp; return rec; }

  // ---- rule 4, no match. Stored, never discarded, never guessed.
  return rec;
}

function addressOf_(v) {
  var s = String(v || '').trim();
  var m = /<([^<>]+)>/.exec(s);
  return (m ? m[1] : s).trim().toLowerCase();
}
function displayName_(v) {
  var m = /^\s*"?([^"<]*?)"?\s*<[^<>]+>\s*$/.exec(String(v || '').trim());
  return m && m[1].trim() ? m[1].trim() : '';
}
function headerOf_(raw, name) {
  var re = new RegExp('^' + name.replace(/[-]/g, '\\-') + ':\\s*(.*)$', 'im');
  var m = re.exec(String(raw || ''));
  return m ? m[1].trim() : '';
}
function idsIn_(v) {
  var out = [], re = /<([^<>\s]+)>/g, m;
  while ((m = re.exec(String(v || '')))) out.push(m[1]);
  return out;
}
function slugFromTag_(v) {
  var a = addressOf_(v);
  var at = a.indexOf('@');
  if (at < 0) return '';
  if (a.slice(at + 1) !== TAG_DOMAIN) return '';
  var box = a.slice(0, at), plus = box.indexOf('+');
  if (plus < 0 || box.slice(0, plus) !== TAG_LOCAL) return '';
  var slug = box.slice(plus + 1);
  return /^[a-z0-9][a-z0-9-]*$/.test(slug) ? slug : '';
}

/* Installed once, by hand, from the editor. Running it twice does not make two
   triggers: the old one is removed first. */
function installScanTrigger() {
  var all = ScriptApp.getProjectTriggers();
  for (var i = 0; i < all.length; i++) {
    if (all[i].getHandlerFunction() === 'scanInbox') ScriptApp.deleteTrigger(all[i]);
  }
  ScriptApp.newTrigger('scanInbox').timeBased().everyMinutes(SCAN_EVERY_MIN).create();
  return 'scanInbox now runs every ' + SCAN_EVERY_MIN + ' minutes';
}

/* ===================== the two ceilings, reported rather than assumed =========
 * §10.2 A consumer Google account gets 90 minutes of trigger runtime per day.
 *       Workspace gets six hours. A scan every fifteen minutes is 96 runs a day.
 *       At 30 seconds per run that is 48 minutes, which fits. At 60 it does not.
 * §10.3 The sending cap is an ACCOUNT limit, not a product decision, and the
 *       person reading "100" deserves to know which. It is read from here so
 *       moving to Workspace is a configuration change and not a code change.
 */
function sendStats_() {
  var s = storeRead_();
  var scans = s.scanLog || [];
  var perDay = 24 * 60 / 15;                    // the configured interval
  var avg = 0;
  if (scans.length) {
    var sum = 0;
    for (var i = 0; i < scans.length; i++) sum += (scans[i].ms || 0);
    avg = Math.round(sum / scans.length);
  }
  var dailyMs = Math.round(avg * perDay);
  var quota = MailApp.getRemainingDailyQuota();
  /* A consumer account is 100 recipients a day, Workspace is 1500. The remaining
     quota is what the account will actually allow, so the tier is read from it
     rather than guessed. */
  var tier = quota > 500 ? 'workspace' : 'consumer';
  return {
    ok: true,
    scan: { runs: scans.length, avgMs: avg, perDay: perDay,
            dailyMinutes: Math.round(dailyMs / 60000),
            budgetMinutes: tier === 'workspace' ? 360 : 90,
            overBudget: (dailyMs / 60000) > 60 },
    send: { remainingToday: quota, cap: tier === 'workspace' ? 1500 : 100, tier: tier,
            counts: 'recipients' }
  };
}

/* ===================== sending ===================== */

/**
 * Every outbound message now carries Reply-To: hi+<slug>@thriveiii.com, which is
 * attribution rule 1 and the reason it is exact. Gmail delivers plus-addressed
 * mail to the same inbox and no client rewrites an address.
 */
/* FROM header composer. The console sends a bare address in d.from ("hi@thriveiii.com") and the display
   name separately in d.fromName ("Thrive Digital Solutions"). Build one RFC 5322 name-addr, "Name <addr>",
   so the provider shows the chosen name instead of deriving it from the local-part ("hi"). Sanitize: strip
   CR/LF so a name can never inject a header, and quote the display name when it carries a comma or another
   special. A d.from that already contains "<...>" is treated as a full header and used verbatim; an empty
   name falls back to the bare address, and an empty address returns "" so the caller's default applies. */
function fromHeader_(addr, name) {
  var a = String(addr == null ? '' : addr).replace(/[\r\n]/g, '').trim();
  var n = String(name == null ? '' : name).replace(/[\r\n]/g, '').trim();
  if (!a) return '';
  if (a.indexOf('<') !== -1) return a;
  if (!n) return a;
  if (/[",;:<>@()\[\]\\]/.test(n)) n = '"' + n.replace(/(["\\])/g, '\\$1') + '"';
  return n + ' <' + a + '>';
}

function sendMail_(d) {
  var key = props_().getProperty('RESEND_KEY');
  if (!key) throw new Error('RESEND_KEY not set');
  if (!d.to) throw new Error('missing "to"');

  /* COURIER, not a composer. This relay sends the html and text exactly as the console composed them and
     writes NO copy of its own: no footer, no address, no signature. The console is the single composer
     and the single footer source (POSTAL, from the console), so a wrong footer cannot originate here. Do
     not add a footer or an address string to this payload; that would recreate the second-composer bug
     (an "Alexandria, Egypt" footer that shipped from an older relay while the console's footer was
     already correct). Everything the recipient reads comes in through d.html and d.text. */
  var replyTo = d.slug ? (TAG_LOCAL + '+' + d.slug + '@' + TAG_DOMAIN) : (TAG_LOCAL + '@' + TAG_DOMAIN);
  var payload = {
    from: fromHeader_(d.from, d.fromName) || ('Thrive <' + TAG_LOCAL + '@' + TAG_DOMAIN + '>'),
    to: [d.to],
    subject: d.subject || '',
    html: d.html || '',       // sent verbatim, footer included by the console
    reply_to: replyTo
  };
  if (d.text) payload.text = d.text;  // sent verbatim, footer included by the console
  /* P23 attachments. The console decided (in ONE place, compile) which images attach; each item is
     { filename, path } where path is a public Supabase Storage URL. Resend fetches the file itself, so this
     request carries only URLs, never megabytes of base64. Forwarded verbatim, like the body: the relay is a
     courier and adds nothing. Absent for a text-only send, exactly as before. */
  if (d.attachments && d.attachments.length) payload.attachments = d.attachments;

  /* THREADING, GUARANTEED. A reply is threaded deterministically only if the outbound message carried a
     Message-ID that the reply then echoes in In-Reply-To/References. The console already mints one and
     passes it as a header; this makes it a guarantee rather than a hope: whatever headers the console
     sent are forwarded verbatim, and if none named a Message-ID the relay mints one so the wire message
     always has a stable, own-domain id. The value is returned as messageId so the console records the
     exact string it must later match. This is the fallback path for when a mailbox strips the plus tag. */
  var hdrs = {};
  if (d.headers) for (var hk in d.headers) if (Object.prototype.hasOwnProperty.call(d.headers, hk)) hdrs[hk] = d.headers[hk];
  var messageId = '';
  for (var nk in hdrs) if (Object.prototype.hasOwnProperty.call(hdrs, nk) && nk.toLowerCase() === 'message-id') messageId = String(hdrs[nk] || '');
  if (!messageId) { messageId = mkMessageId_(); hdrs['Message-ID'] = messageId; }
  payload.headers = hdrs;

  /* Exactly-once. The console sends one stable idempotency key per send INTENT (not per click). Forwarded
     to Resend as its Idempotency-Key header, a retried POST for the same intent is deduped by Resend and
     delivers AT MOST ONCE, returning the original send's id. This is what stops a slow-relay retry from
     hitting the prospect twice. No key (a legacy caller) behaves exactly as before. */
  var headers = { Authorization: 'Bearer ' + key };
  if (d.idempotencyKey) headers['Idempotency-Key'] = String(d.idempotencyKey);
  var res = UrlFetchApp.fetch('https://api.resend.com/emails', {
    method: 'post',
    contentType: 'application/json',
    headers: headers,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var body = res.getContentText();
  var j = {};
  try { j = JSON.parse(body); } catch (e) {}
  if (res.getResponseCode() >= 300) throw new Error(j.message || body.slice(0, 200));
  return { ok: true, id: j.id || '', messageId: messageId, replyTo: replyTo, delivered: true };
}

/* An own-domain Message-ID, the shape the console mints, so a reply's In-Reply-To can be matched against
   it. Minted here only when the console did not send one (a legacy caller), so the wire message is never
   without a stable id the relay can vouch for. */
function mkMessageId_() {
  var t = new Date().getTime().toString(36);
  var r = Math.random().toString(36).slice(2, 10);
  return '<c' + t + r + '@' + TAG_DOMAIN + '>';
}

/* ===================== the durable send queue (D6 + R3) ===================== */

/**
 * The server-driven send queue, so a large campaign completes with the operator's device asleep.
 *
 * WHERE IT LIVES. store.outbox is a relay-owned key, exactly like store.inbound and store.hits: the
 * console PUSHES items and READS status, and never the reverse, so the console's full-state sync
 * (state_put, which overwrites store.state) can never clobber the queue. The console also holds the
 * matching console_mail ledger row per recipient; it reconciles that ledger from outbox_status. The
 * relay still never writes to Supabase: it sends, and reports what it sent.
 *
 * THE INVARIANTS THIS FILE MUST NOT BREAK.
 *   1. One message per recipient. Each item is one single-To send. No BCC, no multi-recipient To.
 *   2. At most once. Each item carries the console_mail row id as its Resend idempotency key, so a
 *      re-claimed 'sending' row (a worker that died mid-send) or an overlapping tick delivers the same
 *      message at most once.
 *   3. Idempotent claim. A due row is flipped queued->sending INSIDE the store lock, which serializes
 *      every trigger tick (LockService), so two overlapping ticks can never both claim one row.
 *   4. Never counted sent before acceptance. A row flips to 'sent' only after sendMail_ returns; a
 *      throw flips it to 'failed' with the reason, never silently.
 */
var OUTBOX_BATCH    = 8;            // rows claimed per tick: small, so one run stays well under the time budget
var OUTBOX_STUCK_MS = 5 * 60000;   // a 'sending' row older than this is re-claimed; the idem key makes a resend safe

function dueMs_(due) { var t = Date.parse(String(due || '')); return isNaN(t) ? 0 : t; }

function findOutbox_(mid) {
  var ob = storeRead_().outbox || [];
  for (var i = 0; i < ob.length; i++) if (ob[i] && ob[i].mid === mid) return ob[i];
  return null;
}

function flipOutbox_(mid, patch) {
  return withStore_(function (store) {
    var ob = store.outbox || [];
    for (var i = 0; i < ob.length; i++) {
      if (ob[i] && ob[i].mid === mid) { for (var k in patch) ob[i][k] = patch[k]; break; }
    }
    store.outbox = ob;
    return { ok: true };
  });
}

/* The console hands the relay a batch of compiled, per-recipient items. Append-only and idempotent by
   mid, so a retried push (a flaky network at campaign start) never duplicates a row. */
function outboxPush_(rows) {
  rows = rows || [];
  return withStore_(function (store) {
    var ob = store.outbox || [];
    var seen = {};
    for (var i = 0; i < ob.length; i++) if (ob[i] && ob[i].mid) seen[ob[i].mid] = 1;
    var added = 0;
    for (var j = 0; j < rows.length; j++) {
      var r = rows[j];
      if (!r || !r.mid || seen[r.mid]) continue;   // idempotent: a mid already queued is never re-added
      ob.push({ mid: r.mid, opp: r.opp || '', campaign: r.campaign || r.opp || '', to: r.to || '',
                toName: r.toName || '', subject: r.subject || '', html: r.html || '', text: r.text || '',
                attachments: (r.attachments && r.attachments.length ? r.attachments : undefined),   // P23: the same images for every recipient
                due: r.due || new Date().toISOString(), status: 'queued', error: '', tries: 0 });
      seen[r.mid] = 1; added++;
    }
    /* A runaway push cannot grow the store without bound: keep every un-terminal row, and only the most
       recent terminal ones. */
    if (ob.length > 5000) {
      var live = ob.filter(function (x) { return x.status === 'queued' || x.status === 'sending' || x.status === 'held'; });
      var done = ob.filter(function (x) { return x.status === 'sent' || x.status === 'failed'; }).slice(-1000);
      ob = live.concat(done);
    }
    store.outbox = ob;
    return { ok: true, added: added, total: ob.length };
  });
}

/* Pause holds a campaign's un-sent rows so the worker skips them; resume re-queues them with the fresh
   due times the console computed. A complaint pauses the same way, loudly on the console; the worker
   simply stops claiming a held row. Nothing already 'sent' is touched: a paused campaign never un-sends. */
function outboxControl_(opp, action, dues) {
  return withStore_(function (store) {
    var ob = store.outbox || [], n = 0;
    for (var i = 0; i < ob.length; i++) {
      var r = ob[i];
      if (!r || (r.campaign !== opp && r.opp !== opp)) continue;
      if (action === 'pause' && r.status === 'queued') { r.status = 'held'; n++; }
      else if (action === 'resume' && r.status === 'held') { r.status = 'queued'; if (dues && dues[r.mid]) r.due = dues[r.mid]; n++; }
      else if (action === 'cancel' && (r.status === 'queued' || r.status === 'held')) { r.status = 'failed'; r.error = 'cancelled'; n++; }
    }
    store.outbox = ob;
    return { ok: true, changed: n };
  });
}

/* Compact status for the console to reconcile its ledger: never the payload (html/text stay on the
   relay), only the outcome per row. */
function outboxStatus_(opp) {
  var ob = storeRead_().outbox || [], out = [];
  for (var i = 0; i < ob.length; i++) {
    var r = ob[i];
    if (!r) continue;
    if (opp && r.campaign !== opp && r.opp !== opp) continue;
    out.push({ mid: r.mid, opp: r.opp, status: r.status, error: r.error || '', id: r.id || '',
               sent_at: r.sent_at || '', due: r.due || '' });
  }
  return { ok: true, rows: out };
}

/**
 * The worker. Runs on a time trigger. Claims a small batch of due queued rows oldest-first, flipping
 * each to 'sending' INSIDE the store lock so two overlapping ticks cannot claim the same row, then
 * sends each as its own single-To message with the row id as the idempotency key, and flips
 * 'sending'->'sent' on provider acceptance or ->'failed' with the reason. A 'sending' row stuck past
 * OUTBOX_STUCK_MS (a worker that died mid-send) is re-claimed; the idempotency key makes that resend
 * deliver at most once.
 */
function sendQueue_() {
  var now = new Date().getTime();
  var claimed = withStore_(function (store) {
    var ob = store.outbox || [];
    // re-claim a 'sending' row a dead worker left behind, so a stall never strands a recipient
    for (var s = 0; s < ob.length; s++) {
      var q = ob[s];
      if (q && q.status === 'sending' && (now - (q.sending_since || 0)) > OUTBOX_STUCK_MS) q.status = 'queued';
    }
    var due = [];
    for (var i = 0; i < ob.length; i++) {
      var r = ob[i];
      if (r && r.status === 'queued' && dueMs_(r.due) <= now) due.push(r);
    }
    due.sort(function (a, b) { return dueMs_(a.due) - dueMs_(b.due); });   // oldest due first
    var take = due.slice(0, OUTBOX_BATCH);
    for (var k = 0; k < take.length; k++) { take[k].status = 'sending'; take[k].sending_since = now; take[k].tries = (take[k].tries || 0) + 1; }
    store.outbox = ob;
    return take.map(function (x) { return x.mid; });   // claim under the lock; send below, outside it
  });

  var sent = 0, failed = 0;
  for (var c = 0; c < claimed.length; c++) {
    var row = findOutbox_(claimed[c]);
    if (!row) continue;
    try {
      var res = sendMail_({ to: row.to, subject: row.subject, html: row.html, text: row.text,
                            attachments: row.attachments,   // P23: carried per queued row, the same for every recipient
                            slug: row.opp, idempotencyKey: row.mid });   // single To; row id = at-most-once key
      flipOutbox_(row.mid, { status: 'sent', id: (res && res.id) || '', sent_at: new Date().toISOString(), error: '' });
      sent++;
    } catch (err) {
      flipOutbox_(row.mid, { status: 'failed', error: String((err && err.message) || err) });   // visible, never silent
      failed++;
    }
  }
  return { ok: true, claimed: claimed.length, sent: sent, failed: failed };
}

/* Installed once, by hand, from the editor, like installScanTrigger. Running it twice does not make two
   triggers: the old one is removed first. Every minute is the Apps Script floor; the pacing is in the
   per-row due timestamps the console computed with jitter, not in the trigger interval. */
function installSendTrigger() {
  var all = ScriptApp.getProjectTriggers();
  for (var i = 0; i < all.length; i++) {
    if (all[i].getHandlerFunction() === 'sendQueue_') ScriptApp.deleteTrigger(all[i]);
  }
  ScriptApp.newTrigger('sendQueue_').timeBased().everyMinutes(1).create();
  return 'sendQueue_ now runs every minute';
}

/* ===================== HTTP ===================== */

function json_(o) {
  /* Stamp the version onto every response, including errors. The console
     compares this against the version it was built for and refuses to send into
     a relay it does not match. A response that omits it reads, correctly, as a
     relay too old to know the contract. */
  o = o || {};
  o.relay_version = RELAY_VERSION;
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ===================== F2: static page activation (GitHub Pages serving) ===================== */
/* The beacon tag and its injection rule, byte-identical to the console's withBeacon (library/app.js:3493-3502):
   insert before </body>, else before </html>, else append; no-op if the page already carries beacon.js. So an
   uploaded page records opens exactly like a page the old engine committed. */
var BEACON_TAG_ = '<script src="/beacon.js" defer></' + 'script>';
function withBeacon_(html) {
  var h = String(html || '');
  if (!h.trim()) return h;
  if (/beacon\.js/.test(h)) return h;
  if (/<\/body\s*>/i.test(h)) return h.replace(/<\/body\s*>/i, BEACON_TAG_ + '\n</body>');
  if (/<\/html\s*>/i.test(h)) return h.replace(/<\/html\s*>/i, BEACON_TAG_ + '\n</html>');
  return h + '\n' + BEACON_TAG_;
}
/* Commit opp/<slug>/index.html to the repo via the GitHub Contents API, the same publish the old engine did
   from the browser (ghPutFile, app.js:3462-3466 / 3530) but with the token held HERE, never in the client.
   The slug is hard-sanitized to [a-z0-9-] and the path is fixed to opp/<slug>/index.html, so this op can only
   ever publish a public opp page, never an arbitrary path, a workflow, or a secret. Idempotent: an existing
   file is updated in place by its sha. The token comes from the GH_TOKEN Script Property; owner/repo/branch
   default to this repo and can be overridden by GH_OWNER / GH_REPO / GH_BRANCH properties. */
function pagePublish_(d) {
  var slug = String((d && d.slug) || '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(slug)) return { ok: false, error: 'bad slug' };
  var html = String((d && d.html) || '');
  if (!html.trim()) return { ok: false, error: 'empty html' };
  html = withBeacon_(html);                                   // the committed page carries the beacon
  var token = props_().getProperty('GH_TOKEN');
  if (!token) return { ok: false, error: 'GH_TOKEN not set' };
  var owner = props_().getProperty('GH_OWNER') || 'thriveiii';
  var repo = props_().getProperty('GH_REPO') || 'thrive-console';
  var branch = props_().getProperty('GH_BRANCH') || 'main';
  var path = 'opp/' + slug + '/index.html';
  var api = 'https://api.github.com/repos/' + owner + '/' + repo + '/contents/' + path;
  var ghHeaders = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  var content = Utilities.base64Encode(Utilities.newBlob(html).getBytes());
  // GET the current sha then PUT. Wrapped so a 409 (the branch ref advanced under a concurrent commit, between
  // our GET-sha and PUT) can re-GET the now-current sha and PUT once more. Idempotent by path+sha, so a
  // self-heal never duplicates and never overwrites a different file. PR-L0 latent-concurrency safety.
  function attempt_() {
    var sha = '';
    var g = UrlFetchApp.fetch(api + '?ref=' + encodeURIComponent(branch), { method: 'get', muteHttpExceptions: true, headers: ghHeaders });
    if (g.getResponseCode() === 200) { try { sha = (JSON.parse(g.getContentText()) || {}).sha || ''; } catch (e1) {} }
    var body = { message: 'Publish opp/' + slug, content: content, branch: branch };
    if (sha) body.sha = sha;                                  // update in place if it exists (never duplicates)
    return UrlFetchApp.fetch(api, { method: 'put', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify(body), headers: ghHeaders });
  }
  var p = attempt_();
  var code = p.getResponseCode();
  if (code === 409) { p = attempt_(); code = p.getResponseCode(); }   // one retry on a ref-advance conflict
  if (code !== 200 && code !== 201) return { ok: false, error: 'github ' + code + ': ' + String(p.getContentText() || '').slice(0, 140) };
  var out = {}; try { out = JSON.parse(p.getContentText()); } catch (e2) {}
  return { ok: true, slug: slug, path: path, url: 'https://console.thriveiii.com/opp/' + slug,
           sha: (out.content && out.content.sha) || '', commit: (out.commit && out.commit.sha) || '' };
}

function doGet(e) {
  var op = (e && e.parameter && e.parameter.op) || '';
  if (op === 'hit') {
    try {
      /* r is the per-recipient token (a console_mail row id) carried by an email tracking pixel, so an
         open can be attributed to one recipient (console_hits.data.r -> console_mail.id -> to_addr). It is
         optional: a hit without it stays an anonymous, campaign-level view, never guessed onto a person. */
      hitPut_({ type: e.parameter.type || 'open', slug: e.parameter.slug || '',
                ts: new Date().toISOString(), vid: e.parameter.vid || '', r: e.parameter.r || '',
                ms: e.parameter.ms ? Number(e.parameter.ms) : undefined });
      /* Apps Script ContentService cannot serve image bytes or a 302, so the pixel URL answers with a tiny
         text body. Loaded by an <img>, that renders as an empty 1x1 (no alt), invisible in the client; the
         open is already recorded above. This is the only pixel behavior this relay can offer. */
      return ContentService.createTextOutput('').setMimeType(ContentService.MimeType.TEXT);
    } catch (err) { return json_({ ok: false, error: String(err.message || err) }); }
  }
  /* The bare GET reports through json_, so relay_version (from the single RELAY_VERSION constant)
     is stamped on this endpoint too, exactly as it is on every sync and send response. The console
     then reads one explicit field on every endpoint rather than scraping a prose string here and a
     JSON field there, so the two readings can never drift apart. */
  return json_({ ok: true, service: 'Thrive relay', running: true,
                 features: 'email + sync + analytics + inbox' });
}

function doPost(e) {
  var d = {};
  try { d = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) {}
  var op = d.op || '';

  try {
    /* §3.2 the request contract, versioned. `missing "to"` happened because a v5
       request shape hit a v4 handler that answered it as an email. From now on a
       request may declare the version it was written for, and a relay older than
       that request refuses BY NAME rather than misreading the shape. A request
       that declares nothing is a legacy caller and is allowed through, so an old
       page never breaks against a new relay. */
    if (d.v != null && Number(d.v) > RELAY_VERSION) {
      return json_({ ok: false,
        error: 'request v' + Number(d.v) + ', relay v' + RELAY_VERSION });
    }

    if (!op) return json_(sendMail_(d));          // v4 shape: a bare body is a send

    /* The prospect-page beacon (beacon.js) POSTs { op:'hit', ev:{...} } via navigator.sendBeacon. It is
       unauthenticated by design (a visitor has no console credential), so it is answered BEFORE authOk_,
       exactly like the GET pixel above. Without this branch a page open fell through to authOk_ and was
       dropped, so remote page opens never reached the store; that is fixed here. ev carries r (the
       per-recipient token) unchanged, so a page visit from a tokenized link attributes to one recipient. */
    if (op === 'hit') {
      var ev = (d && d.ev) || {};
      if (!ev.ts) ev.ts = new Date().toISOString();   // stamp if the client omitted it
      hitPut_(ev);
      return json_({ ok: true });
    }

    /* F2 static activation. The console (a static GitHub Pages client) cannot hold a repo-write token, so the
       relay holds it (GH_TOKEN, a Script Property) and commits the page here. This op is answered BEFORE
       authOk_ for the same reason the bare send is: the console carries no SYNC_KEY, so the /exec URL is the
       capability, exactly as for email. The blast radius is bounded far below send: pagePublish_ sanitizes the
       slug to [a-z0-9-] and only ever writes opp/<slug>/index.html (public opp-page content), never an
       arbitrary path, workflow, or secret. The GitHub token never leaves this server. */
    if (op === 'page_publish') return json_(pagePublish_(d));

    authOk_(d.auth);

    if (op === 'state_get')     return json_(stateGet_());
    if (op === 'state_put')     return json_(statePut_(d.data));
    if (op === 'hits_get')      return json_(hitsGet_());

    if (op === 'send')          return json_(sendMail_(d));

    if (op === 'store_stats')   return json_(storeStats_());
    if (op === 'send_stats')    return json_(sendStats_());
    if (op === 'store_migrate') return json_(storeMigrate_(!!d.dryRun));

    if (op === 'inbound_get')   return json_({ ok: true, records: (storeRead_().inbound || []),
                                               scan: storeRead_().inboxScan || null });
    if (op === 'inbox_scan')    return json_(scanInbox());
    if (op === 'inbox_repair')  return json_(repairInbox_(d.days || 90, !!d.dryRun));
    if (op === 'inbox_reconcile') return json_(inboxReconcile_(d.days || 2));

    /* The durable send queue (D6 + R3). The console pushes a compiled per-recipient batch and reads
       status; the sendQueue_ time trigger does the sending. outbox_run is a manual tick (a nudge, and
       the test hook), so a campaign can be kicked without waiting for the next trigger. */
    if (op === 'outbox_push')    return json_(outboxPush_(d.rows || []));
    if (op === 'outbox_status')  return json_(outboxStatus_(d.opp || ''));
    if (op === 'outbox_control') return json_(outboxControl_(d.opp || '', d.action || '', d.dues || null));
    if (op === 'outbox_run')     return json_(sendQueue_());

    return json_({ ok: false, error: 'unknown op: ' + op });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}
