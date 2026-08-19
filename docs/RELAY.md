# The relay

> ## The deployment ritual, the five taps
>
> **Saving the script is not deploying it.** The editor can hold new code while the live URL keeps
> serving the old. That is the mismatch that failed every send one night with `missing "to"`. When
> the console shows the version banner, this is the fix, in order:
>
> 1. **Deploy** (top right in the Apps Script editor)
> 2. **Manage deployments**
> 3. the **pencil** (Edit) on the one deployment
> 4. **Version: New version**
> 5. **Deploy**
>
> Never **New deployment**: it mints a different URL and the console keeps calling the old one. One
> deployment, forever. The URL must never change.
>
> The version the console requires is `REQUIRED_RELAY` in `library/app.js`; the version the relay
> serves is `RELAY_VERSION` at the top of `relay/thrive-relay.gs`. They must be equal. When they are
> not, the relay stamps its number on every response, the console compares on every request, and it
> refuses to send until the two agree. Bump both numbers in the same commit as any change to the
> request or response shape, never separately.

The console is a static page and one moving part. This is the moving part.

**Until WO-013 the relay had no source in this repository.** `Brain/RUNBOOK-sync.md` said "replace
the whole file with `thrive-email-resend.gs` (relay v4)", and that file existed only inside the
Apps Script editor. There was no history, no review, and no way to answer "what changed" about the
one component that holds every device's data. The source is now `relay/thrive-relay.gs`, written
here first and pasted second, which is the order it should always have been in.

---

## 1. What v5 changes

| | v4 | v5 |
|---|---|---|
| Shared state | Script properties, chunked | A JSON file on Drive |
| Page hits | Script properties, chunked | The same Drive file |
| The console's HTTP interface | `state_get`, `state_put`, `hits_get` | **identical** |
| The inbox | not read | scanned every fifteen minutes |
| Outbound `Reply-To` | `hi@thriveiii.com` | `hi+<slug>@thriveiii.com` |
| Measurement | none | `store_stats` |

**The HTTP interface does not change, and that is the point.** The console calls `state_get` and
`state_put` and does not know or care where the bytes live. Any console code that assumed
Properties would be a defect. There is none, which is what makes this swap a morning's work rather
than a rewrite.

---

## 2. Why the store had to move, with the number

Apps Script's Properties Service holds **500 KB in total and 9 KB per key**. It is a configuration
store. Using it as a database works at small size and then breaks, and the console's own connection
health panel had already started saying so:

> If it keeps failing, the relay is out of Script properties space.

That sentence had no number behind it, which is why nobody acted on it. `store_stats` reports total
bytes, key count, and the five largest keys. **Measure before you migrate.** Settings, Replies,
`Measure the relay store` runs it and prints the answer.

Drive holds a JSON file with no practical ceiling at this size, it is readable and writable from
Apps Script, and it costs nothing. Properties keeps only what it is for: `SYNC_KEY`, `RESEND_KEY`,
and the file pointer.

---

## 3. The migration, and the rollback

**Run it with a verified backup in hand.** Settings, Backup and restore, `Export backup`, and open
the file to confirm it has your opportunities in it. A backup nobody has opened is a belief.

### Migrating

1. `script.google.com`, open the Thrive relay project.
2. Replace the whole file with `relay/thrive-relay.gs` from this repository. Save.
3. `Deploy` → `Manage deployments` → the pencil → `Version: New version` → `Deploy`.
   **Never `New deployment`.** See §5.
4. In the console: Settings → Replies → `Measure the relay store`. Note the numbers.
5. In the Apps Script editor, run `storeMigrate_(true)` once. The `true` is a dry run: it reports
   what it found and writes nothing.
6. Run `storeMigrate_(false)`. It copies the chunks to Drive, **reads them back and verifies**, and
   only then deletes the old properties. A migration that deletes before it verifies is a migration
   that loses everything the one time the write fails.
7. `Measure the relay store` again. Properties should be a few hundred bytes; Drive should hold the
   state.

### Rolling back

The old chunks are deleted only after the verified read-back, so the rollback is the backup file,
not the properties.

1. Redeploy v4 from your own copy, or keep v5 and ignore the inbox scan.
2. In the console, Settings → Backup and restore → `Restore from file`.
3. `Force push from this device`. That device's data becomes the shared store again.

**The one thing that cannot be rolled back is a deleted Drive file.** It is in the account's trash
for 30 days. Do not empty the trash on the day of a migration.

---

## 4. Re-authorisation, which you have to do once

The inbox scan needs a Gmail read scope the relay has never held. Google will not grant it
silently, and this is the step people get stuck on.

1. Open the project at `script.google.com`.
2. Select `scanInbox` in the function dropdown and press **Run**.
3. Google shows **Authorization required**. Press `Review permissions`, choose the account that
   receives `hi@thriveiii.com`, and press `Allow`.
4. If the screen says **Google hasn't verified this app**: press `Advanced`, then
   `Go to Thrive relay (unsafe)`. It is your own script in your own account. This wording is what
   Google shows for any unpublished script and it does not mean anything is wrong.
5. Run `installScanTrigger` once. It removes any existing `scanInbox` trigger first, so running it
   twice does not make two triggers.
6. **Redeploy.** Authorising in the editor does not change what the deployment runs.
   `Deploy` → `Manage deployments` → pencil → `New version` → `Deploy`.

Confirm it worked: Settings → Replies. `Last inbox scan` should carry a time. If it says the relay
has not scanned yet, step 6 was skipped.

---

## 5. One deployment. Forever.

Apps Script hands out a **new `/exec` URL for every new deployment**. Two deployments means two
URLs, and half your devices call the dead one, silently, showing zeros while the other half show
real numbers.

There is exactly one deployment of the Thrive relay. Updating it is always:

> `Deploy` → `Manage deployments` → `Edit` (the pencil) → `Version: New version` → `Deploy`

The URL never changes. **Archive anything else in that list.** This has bitten this project three
times.

`Who has access` must read **`Anyone`**, not `Anyone with a Google account`. They look almost
identical in the menu and only one works. The second turns every call from a prospect, a phone, or
the console itself into a Google login page, and a prospect has no Google account, so that state
can never record a single page open.

---

## 6. The attribution order

The first rule that matches wins, and **the record stores which one did**, so a wrong attribution
is diagnosable rather than mysterious. The rule that matched is printed under every reply in the
History tab.

| # | Rule | Matches on | Why here |
|---|---|---|---|
| 1 | `tag` | `Reply-To: hi+<slug>@thriveiii.com` | Exact. It is an address, and no client rewrites an address. Gmail delivers plus-addressed mail to the same inbox |
| 2 | `thread` | `In-Reply-To` or `References` against a stored `mid` | Works for every reply sent before the tag existed |
| 3 | `sender` | The from address against a known recipient | The last resort that still names an opportunity |
| 4 | `none` | nothing | **Stored, named on screen, never discarded and never guessed** |

A tag naming a slug this console has never heard of is **not** a match. It is almost certainly a
deleted record, and attaching a reply to something that is gone loses it more quietly than leaving
it unattributed.

**v7 (P22) makes the threading tier a guarantee, and names the basis.** `sendMail_` now always puts a
Message-ID on the wire (minting one on our own domain if the console did not) and returns it, so rule 2
has something exact to match. The console projects the four rules onto one *join basis* vocabulary in a
single function (`ThriveInbound.joinBasis`): `plus-address` (the tag) and `references` (the thread) are
deterministic; `sender` and `subject-heuristic` are heuristic; a hand attachment is `manual`; nothing
matched is `unresolved`. Precedence is fixed and a deterministic basis always wins for the same row. The
thread shows a deterministic basis inline and a heuristic one as a tap-open disclosure, so an operator
sees which replies are certain. The scan also stamps a heartbeat (its interval, whether it hit the read
cap), and a read-only `inbox_reconcile` compares the mailbox against what is filed; the board surfaces a
stale sweep as "inbound delayed" and an unfiled backlog loudly, so silence is detectable.

### What is never counted as a reply

Bounces from `mailer-daemon`, anything with `Auto-Submitted` other than `no`, anything with
`X-Autoreply`, and subjects beginning `Automatic reply`, `Out of office`, `رد تلقائي`, or
`خارج المكتب`. These are stored with `kind: "auto"`. **They move no card and count in no total.**
They are still shown, labelled, because a bounce is evidence about an address and hiding it is how
a dead address gets written to for a year.

### Two copies of these rules, and they must not drift

`library/inbound.js` is the copy under test, because it is pure and can be tested.
`relay/thrive-relay.gs` is the copy that runs. **A change to one is a change to both.**
`tools/inbound.py` exercises the console's copy; the relay's copy is exercised by running
`scanInbox` and reading what it filed.

---

## 7. What is stored, and what is not

Sender, display name, subject, timestamp, the Gmail message and thread ids, the matched
opportunity, the rule that matched, and **a snippet of the first 300 characters**.

**Not the full body.** The console shows the snippet and deep links to Gmail for the rest. This
keeps the shared store small, keeps private correspondence out of a blob that syncs to every
device, and still answers the only question the board needs to ask, which is whether they replied.

---

## 8. Secrets

`RESEND_KEY` and `SYNC_KEY` live in `Project Settings → Script properties` and nowhere else: not in
this repository, not in the browser, not in a message. Anything printed anywhere is compromised and
must be rotated the same day.

`SYNC_KEY` is derived from the passcode. Do not go hunting for it in a file: on any unlocked device,
`Settings → Connection health → Copy the sync key` puts the exact value on the clipboard.
