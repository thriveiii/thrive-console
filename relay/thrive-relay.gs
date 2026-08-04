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

var TAG_LOCAL   = 'hi';
var TAG_DOMAIN  = 'thriveiii.com';
var STORE_NAME  = 'thrive-console-store.json';
var INBOX_MAX   = 50;          // messages read per scan, so one run cannot run long
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
                          found: 0, added: 0, idle: true };
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
    store.inboxScan = { ts: new Date().toISOString(), ms: new Date().getTime() - started,
                        found: scanned, added: added, idle: false };
    store.scanLog = (store.scanLog || []).concat([{ ms: new Date().getTime() - started, idle: false }]).slice(-96);
    return { ok: true, added: added, scanned: scanned };
  });
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

  // ---- rule 1, the tag
  var tagged = '';
  var fields = [msg.getTo(), msg.getCc(), headerOf_(raw, 'Delivered-To'), headerOf_(raw, 'X-Original-To')];
  for (var i = 0; i < fields.length && !tagged; i++) {
    var parts = String(fields[i] || '').split(',');
    for (var j = 0; j < parts.length && !tagged; j++) tagged = slugFromTag_(parts[j]);
  }
  if (tagged && known[tagged]) { rec.rule = 'tag'; rec.opp = tagged; return rec; }

  // ---- rule 2, the threading headers
  var ids = idsIn_(headerOf_(raw, 'In-Reply-To')).concat(idsIn_(headerOf_(raw, 'References')));
  if (ids.length) {
    var byId = {};
    for (var a = 0; a < mail.length; a++) {
      var mm = mail[a];
      if (!mm || mm.direction === 'in') continue;
      if (mm.mid) byId[String(mm.mid).replace(/^<|>$/g, '')] = mm;
      if (mm.messageId) byId[String(mm.messageId).replace(/^<|>$/g, '')] = mm;
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
  ScriptApp.newTrigger('scanInbox').timeBased().everyMinutes(15).create();
  return 'scanInbox now runs every 15 minutes';
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
function sendMail_(d) {
  var key = props_().getProperty('RESEND_KEY');
  if (!key) throw new Error('RESEND_KEY not set');
  if (!d.to) throw new Error('missing "to"');

  var replyTo = d.slug ? (TAG_LOCAL + '+' + d.slug + '@' + TAG_DOMAIN) : (TAG_LOCAL + '@' + TAG_DOMAIN);
  var payload = {
    from: d.from || ('Thrive <' + TAG_LOCAL + '@' + TAG_DOMAIN + '>'),
    to: [d.to],
    subject: d.subject || '',
    html: d.html || '',
    reply_to: replyTo
  };
  if (d.text) payload.text = d.text;
  if (d.headers) payload.headers = d.headers;

  var res = UrlFetchApp.fetch('https://api.resend.com/emails', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + key },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var body = res.getContentText();
  var j = {};
  try { j = JSON.parse(body); } catch (e) {}
  if (res.getResponseCode() >= 300) throw new Error(j.message || body.slice(0, 200));
  return { ok: true, id: j.id || '', replyTo: replyTo };
}

/* ===================== HTTP ===================== */

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var op = (e && e.parameter && e.parameter.op) || '';
  if (op === 'hit') {
    try {
      hitPut_({ type: e.parameter.type || 'open', slug: e.parameter.slug || '',
                ts: new Date().toISOString(), vid: e.parameter.vid || '',
                ms: e.parameter.ms ? Number(e.parameter.ms) : undefined });
      return json_({ ok: true });
    } catch (err) { return json_({ ok: false, error: String(err.message || err) }); }
  }
  return ContentService.createTextOutput('Thrive relay v5 (email + sync + analytics + inbox) is running.');
}

function doPost(e) {
  var d = {};
  try { d = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) {}
  var op = d.op || '';

  try {
    if (!op) return json_(sendMail_(d));          // v4 shape: a bare body is a send

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

    return json_({ ok: false, error: 'unknown op: ' + op });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}
