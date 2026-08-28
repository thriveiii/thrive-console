/* SENDER_NAME (Node, fails-when-broken).
 *
 * The delivered email showed the from-name "hi" because the console sent a BARE address
 * (from:"hi@thriveiii.com") and the relay forwarded it verbatim, so Resend derived the display name
 * from the local-part; the separate fromName field was never read. This locks the fix:
 *
 *   1. the relay builds one RFC 5322 name-addr, "Name <addr>", from d.from + d.fromName (fromHeader_),
 *      sanitizing CR/LF and quoting a name with specials, and the send payload's `from` uses it.
 *   2. the console default from-name is "Thrive Digital Solutions" and every send carries fromName.
 *
 * The relay is Apps Script, deployed manually and separate from the repo, so it cannot run through
 * Resend here; this extracts fromHeader_ from the .gs source and drives it directly, then asserts the
 * two source seams (relay payload wiring, console default + fromName field) that make the name reach
 * the wire. Synthetic inputs only.
 */
const fs = require('fs');
const path = require('path');
const ROOT = '/home/user/thrive-console';

const fails = [];
function ck(n, c, d) {
  console.log((c ? 'PASS ' : 'FAIL ') + n);
  if (!c) { fails.push(n); if (d !== undefined) console.log('      ' + String(d).slice(0, 300)); }
}

// ---- extract fromHeader_ from the relay source and drive it directly ----------------------------
const relay = fs.readFileSync(path.join(ROOT, 'relay/thrive-relay.gs'), 'utf8');
const helperSrc = relay.slice(relay.indexOf('function fromHeader_'), relay.indexOf('function sendMail_'));
ck('the relay defines fromHeader_ before sendMail_', helperSrc.indexOf('function fromHeader_') === 0, helperSrc.slice(0, 40));
const fromHeader_ = new Function('addr', 'name', helperSrc + '\n return fromHeader_(addr, name);');

// 1. the exact shape the task requires when a display name is set
ck('a set fromName yields "Thrive Digital Solutions <hi@thriveiii.com>"',
   fromHeader_('hi@thriveiii.com', 'Thrive Digital Solutions') === 'Thrive Digital Solutions <hi@thriveiii.com>',
   fromHeader_('hi@thriveiii.com', 'Thrive Digital Solutions'));

// 2. no name -> bare address (so the provider still delivers, just without a chosen name)
ck('an empty name falls back to the bare address', fromHeader_('hi@thriveiii.com', '') === 'hi@thriveiii.com');
ck('a null name falls back to the bare address', fromHeader_('hi@thriveiii.com', null) === 'hi@thriveiii.com');

// 3. an empty address returns "" so the caller's default fires
ck('an empty address returns "" (caller default applies)', fromHeader_('', 'Thrive Digital Solutions') === '');

// 4. CR/LF in the name can never inject a header
const injected = fromHeader_('hi@thriveiii.com', 'Evil\r\nBcc: attacker@evil.test');
ck('CR/LF is stripped from the display name (no header injection)', !/[\r\n]/.test(injected), JSON.stringify(injected));

// 5. a name with a comma (or other special) is quoted, per RFC 5322
ck('a name with a comma is wrapped in quotes',
   fromHeader_('hi@thriveiii.com', 'Thrive, Inc') === '"Thrive, Inc" <hi@thriveiii.com>',
   fromHeader_('hi@thriveiii.com', 'Thrive, Inc'));
ck('a plain name (no specials) is NOT quoted',
   fromHeader_('hi@thriveiii.com', 'Eid Mubarak from Thrive') === 'Eid Mubarak from Thrive <hi@thriveiii.com>',
   fromHeader_('hi@thriveiii.com', 'Eid Mubarak from Thrive'));

// 6. a d.from already carrying a full header is used verbatim (no double-wrapping)
ck('a full "Name <addr>" in d.from is used verbatim',
   fromHeader_('Legacy <hi@thriveiii.com>', 'Ignored') === 'Legacy <hi@thriveiii.com>');

// ---- source seam 1: the relay send payload uses fromHeader_ ---------------------------------------
const sendBody = relay.slice(relay.indexOf('function sendMail_'), relay.indexOf('function json_'));
ck('the relay send payload builds `from` via fromHeader_(d.from, d.fromName)',
   /from:\s*fromHeader_\(d\.from,\s*d\.fromName\)/.test(sendBody), sendBody.match(/from:[^\n]*/));
ck('the relay send payload no longer forwards a bare d.from as the from header',
   sendBody.indexOf('from: d.from ||') === -1);

// ---- source seam 2: the console default + the transmitted fromName field --------------------------
const client = fs.readFileSync(path.join(ROOT, 'tools/board-send.src.js'), 'utf8');
ck('the console default from-name is "Thrive Digital Solutions"',
   /FROM_NAME_DEFAULT_L5\s*=\s*"Thrive Digital Solutions"/.test(client));
ck('every send carries the fromName field in the relay payload',
   /fromName:\s*fromName\(\)/.test(client));

// ---- the built board.html carries both (bundle actually shipped the change) -----------------------
const board = fs.readFileSync(path.join(ROOT, 'library/board.html'), 'utf8');
ck('the built board.html carries the "Thrive Digital Solutions" default', board.indexOf('FROM_NAME_DEFAULT_L5 = "Thrive Digital Solutions"') !== -1);
ck('the built board.html still passes fromName in the send payload', /fromName:\s*fromName\(\)/.test(board));

console.log('\n' + (fails.length ? 'FAILED: ' + fails.join(', ') : 'ALL SENDER-NAME CHECKS PASS'));
process.exit(fails.length ? 1 : 0);
