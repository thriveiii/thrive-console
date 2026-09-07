# SUPPRESSION_TRACE.md

READ-ONLY trace for B0 (suppression / do-not-contact). No code changes, no SQL writes, no send. Every claim
is cited `file:line` on origin/main (`358c690`). The live shell is `library/board.html`, bundled from
`tools/board-*.src.js` by `tools/bundle.js`; all citations are in the SOURCES, not the bundle. `library/app.js`
is being retired and is cited only to say what the board shell does NOT carry, never as authority.

---

## 1. RECIPIENTS: where they live, and the address field name at each layer

The address field name is NOT the same at every layer.

- **The recipient input field (not a JSON string).** There is **no `manualRecipients` JSON fence anywhere in
  the repo** (grep for `manualRecipients` across `tools/`, `library/`, `docs/`, `relay/`, `beacon.js`: zero
  matches). The board shell's recipient input is a plain text field `#recIn`, read by `sendToRaw()`
  (`tools/board-recipient.src.js:49`) and parsed by `parseAddrs(text)`, which splits on newline / comma /
  semicolon and lowercases (`tools/board-recipient.src.js:44-45`). `sendToList()` turns each into
  `{ addr, name:"", lang:"" }` (`tools/board-recipient.src.js:50`). Address field: **`addr`**. (The only
  fenced ```` ```json ```` block in the sources is the opp.md MESSAGE body fence,
  `tools/board-upload.src.js:191`, which is the message, not recipients.)

- **`console_opps.data.recipients[]` (the source of truth the send reads).** Written by `saveRecipients`
  as `data.recipients = [{addr,name,lang}]` (`tools/board-recipient.src.js:75-77`), read back as
  `data.recipients[].addr` (`tools/board-recipient.src.js:33-35`). The send reads the same:
  `allRecipients(data)` iterates `data.recipients[]` on `r.addr` (`tools/board-send.src.js:241-246`), and
  `firstRecipient` reads `r.addr` (`tools/board-send.src.js:235-236`). Address field: **`addr`**.

- **`console_opps.data.manual_contacts[]` (a SEPARATE array, read only by the view).** Referenced nowhere in
  the board sources; only the `console_board` view reads it, in the `manual_sends` CTE
  (`docs/supabase-live-verified.sql:75-86`), and it reads only `mc->>'sent_on'` - it never reads an address
  field from `manual_contacts`. So `manual_contacts` entries carry a **`sent_on`** field (hand-logged send
  time); **no address field of `manual_contacts` is read by any served code**, so its address field name is
  not determinable from the live sources.

- **`console_mail` rows (the per-recipient ledger).** Written by `sendOne` as
  `{ id, opp:slug, status, to_addr:art.to, subject, ts, ... }` (`tools/board-send.src.js:345`, and the
  pending twin at `:358`). Opp key: **`opp` = slug**. Address field: **`to_addr`** (its value is `art.to`,
  the compiled send address).

- **The upload path (`tools/board-upload.src.js`).** A recipient email is extracted from the message text by
  `upEmailFrom` via `UP_EMAIL_RE` (`tools/board-upload.src.js:130`), ALWAYS bare (mailto stripped, `:128`),
  surfaced per message as **`email`** (`upMessageFrom` returns `{subject,body,email}`,
  `tools/board-upload.src.js:147`; carried on the review units/rows at `:194,199,227,234,249`). At commit it
  is NORMALIZED into the record shape: `recipients: r.email ? [{ addr:r.email, name:"", lang:"en" }] : []`
  (`tools/board-upload.src.js:338`, inside `upCommit`'s `one(i)`). So the upload layer's field is **`email`**,
  renamed to **`addr`** only when written to `data.recipients[]` at `:338`.

Summary of the address field name per layer: input field `addr` -> `data.recipients[].addr` (opp record and
send) -> `console_mail.to_addr` (ledger); the upload parse calls it `email` until `:338`; `manual_contacts`
exposes no read address field (only `sent_on`).

## 2. SEND TO-LIST and the narrowest pre-send check site

- **Assembly.** `runSend(slug)` reads the opp, then `var recips = allRecipients(data)`
  (`tools/board-send.src.js:377`), caps it to the remaining budget
  `var toSend = recips.slice(0, room)` (`tools/board-send.src.js:390`), and loops it one address at a time in
  the inner `one(i)` iterator, calling `sendOne(slug, row, data, toSend[i], mode)`
  (`tools/board-send.src.js:398`).
- **The exact address sent per send.** In `sendOne`, `var art = sendCompile(slug, row, data, rcpt, mode)`
  (`tools/board-send.src.js:331`), and the relay payload carries `to: art.to`
  (`tools/board-send.src.js:335`). So the value actually sent to is **`art.to`**.
- **The single narrowest check site (least blast radius).** Two candidates, both in
  `tools/board-send.src.js`:
  - `runSend`, at the `toSend` assembly (`:390`): filtering suppressed addresses out of `recips` here skips
    exactly the suppressed recipients and yields a natural visible count, exactly like the existing `capped`
    count computed on that same line. This is the least-blast-radius site that also reports a skipped count.
  - `sendOne`, immediately after `art` is computed (`:331`) and before `relayPost(payload, ...)` (`:336`):
    the absolute chokepoint every send passes through (group loop and any single-send caller), one guard on
    `art.to`. Narrowest in code, but it does not itself produce a per-list count.
  Named site for the check: **`runSend`, `tools/board-send.src.js:390`** (skip at `toSend`, report a count),
  with **`sendOne`, `tools/board-send.src.js:336`** as the guaranteed last-line chokepoint. (No check written.)

## 3. UPLOAD STRIP: where a suppressed address is dropped at upload with a visible skipped count

- The incoming recipient is parsed per message section by `upEmailFrom` / `upMessageFrom`
  (`tools/board-upload.src.js:130,147`) and carried on the review rows as `email`
  (`tools/board-upload.src.js:194,199,227,234,249`); the review table already attaches per-row `warnings`
  (e.g. `dup_slug`, `no_message`, `tools/board-upload.src.js:211,219`), which is the existing mechanism for a
  visible skipped/flagged count.
- The address becomes a stored recipient at commit: `recipients: r.email ? [{ addr:r.email, ... }] : []`
  inside `upCommit`'s `one(i)` (`tools/board-upload.src.js:338`).
- Named strip site: **`upCommit`, `tools/board-upload.src.js:338`** - dropping a suppressed `r.email` here
  keeps it out of `data.recipients[]`; surfacing the count belongs on the review row's `warnings`
  (`tools/board-upload.src.js:211,219`) so the operator sees "N skipped (suppressed)". (No drop written.)

## 4. RELAY BOUNDARY: the client call site and where each guard sits

- **Client call site.** `sendOne` calls `relayPost(payload, RELAY_SEND_TIMEOUT_MS)`
  (`tools/board-send.src.js:336`); `relayPost` is `authFetchOnce(relayEp(), { method:"POST",
  headers:{ "Content-Type":"text/plain;charset=UTF-8" }, body: JSON.stringify(payload) }, timeoutMs)`
  (`tools/board-send.src.js:306-310`).
- **Payload shape** (`tools/board-send.src.js:335`):
  `{ v:REQUIRED_RELAY_L5, from, fromName, to:art.to, subject, html, text, idempotencyKey, headers, slug,
  attachments? }`. The address the relay sends to is `payload.to`.
- **Where each guard sits.** The CLIENT guard sits before this call, at `sendOne` (`:331-336`) or at the
  `toSend` assembly (`:390`) - section 2. The RELAY guard (the authoritative one, since a client can be
  bypassed) must live in the relay's send handler that consumes `payload.to`. That handler is in the Apps
  Script relay (`Code.gs`), which is **NOT in the repo** (the repo's `relay/thrive-relay.gs` is a copy, not
  the deployed artifact - see docs/LESSONS/04). So the relay-side suppression check is ABSENT here and must be
  hand-added in the deployed relay.

## 5. EXISTING OPT-OUT handling

**In the served board shell: none.** The only opt-out-related artifacts are outbound copy and a header, none
of them processed:

- The outbound message body includes a STOP line: `"Not interested in hearing from us? Reply STOP and we will
  stop."` / `"لا ترغب برسائل أخرى؟ ردّ بكلمة إيقاف وسنتوقف."` (`tools/board-send.src.js:65,69`), and a
  `List-Unsubscribe` header pointing at `mailto:unsubscribe@thriveiii.com` and `https://thriveiii.com/unsubscribe`
  (`tools/board-send.src.js:58-59`). **Nothing consumes either**: there is no STOP-reply parser and no
  `/unsubscribe` handler anywhere in the repo (the relay `relay/thrive-relay.gs` has no unsubscribe op; its
  only `suppress` hit is the word in a comment at `:655`).
- A suppression MECHANISM exists ONLY in the retired `library/app.js`, which the board shell does not carry:
  a pre-send block `t("sup_blocked") + ThriveStore.reasonFor(to)` (`library/app.js:8867`) and a suppressed
  count in a report `t("rep_suppressed")` + `r.suppressed` (`library/app.js:12217`). The i18n strings for it
  survive (`rep_suppressed`, `sup_r_unsubscribed`, `library/i18n.js:999,1016`), but they are orphaned in the
  board shell - no `board-*.src.js` references them.
- No suppression / do-not-contact / unsubscribe TABLE exists in any SQL (grep of `docs/*.sql` for
  `suppress|unsubscrib|opt-out|dnc|blocklist|blacklist`: zero).

So: recipients are told they can reply STOP, but a STOP is never captured, there is no suppression store, and
the board shell has no code that would skip a suppressed address.

---

## ABSENT (verified missing)

1. **No suppression / do-not-contact store** - no table in `docs/*.sql`, no `console_suppress` (or similar)
   read anywhere in the sources.
2. **No opt-out capture** - the STOP line and `List-Unsubscribe` header are emitted
   (`tools/board-send.src.js:58-59,65,69`) but nothing parses a STOP reply or serves `/unsubscribe`.
3. **No suppression check in the served send path** - neither `runSend` nor `sendOne`
   (`tools/board-send.src.js`) consults any block list; the retired mechanism (`library/app.js:8867,12217`)
   is not ported into the board shell.
4. **No suppression drop at upload** - `upCommit` writes `data.recipients[]` from `r.email` unconditionally
   (`tools/board-upload.src.js:338`).
5. **No relay-side guard in the repo** - the deployed send handler is `Code.gs`, not in the repository.
6. **No `manualRecipients` JSON string** - it does not exist in the repo; recipients are a plain text field
   parsed by `parseAddrs` (`tools/board-recipient.src.js:44`).

## Smallest insertion points (file:line, no code)

- **Client, per-send chokepoint:** `sendOne`, `tools/board-send.src.js:336` (guard `art.to` right before
  `relayPost`), or the list-level skip with a visible count at `runSend`, `tools/board-send.src.js:390`
  (filter `toSend`).
- **Upload:** `upCommit`, `tools/board-upload.src.js:338` (drop a suppressed `r.email` before it becomes a
  `data.recipients[]` entry), surfacing the count via the review-row `warnings`
  (`tools/board-upload.src.js:211,219`).
- **Relay (authoritative, hand-added later, not in repo):** the deployed `Code.gs` send handler that consumes
  `payload.to`; the client call it answers is `relayPost` (`tools/board-send.src.js:306-310`, invoked at
  `:336`).
