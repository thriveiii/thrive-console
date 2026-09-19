# OPP_CONTROL_ROOM_PLAN

A single deep design + data-model plan for the networked opportunity system.
This document is a blueprint only. It contains NO code and changes NO behavior.
Thyab reviews and approves it before any build begins.

Two parts:

- STEP 1, TRACE. What exists today, read-only, every claim cited to file:line.
- STEP 2, DESIGN. The control room, the minimal additive schema, the derived
  views, and the staged build order. No code.

Ground rules that this plan already respects: one PR per concern; author only,
never merge; additive SQL only (ADD COLUMN / new table IF NOT EXISTS, applied by
Thyab); work in tools/board-*.src.js and rebuild with `node tools/bundle.js`,
never hand-edit library/board.html; no em or en dashes in any copy; straight
quotes in English, guillemets in Arabic; Western numerals; English and Arabic;
no letter-spacing on Arabic.

---

## STEP 1: TRACE (what exists today)

### The vision in one line

Three linked entities, Opportunity + Template + Contact, joined by a single send
ledger. A send links (opp / template) + (contact) + (Thrive team member) +
(timestamp) into ONE record, and every screen is derived from that ledger.

The good news the trace establishes: most of that substrate already exists. What
is missing is small, additive, and named precisely below.

### Entity 1: the Opportunity (the card)

- Table `console_opps`, documented columns at `docs/supabase-board-view.sql:25`:
  slug, business, stage, published, archived, data jsonb, up.
- The message lives inside `data` jsonb, not in columns. The editor reads and
  writes `data.outreach_subject` and `data.outreach_text`:
  `tools/board-editor.src.js:126` returns
  `{ outreach_subject:edVal("edSubj"), outreach_text:edVal("edBody"), sig:edSignature() }`.
- Recipients live in `data.recipients[]`. Today each recipient is
  `{ addr, name, lang }` but `name` and `lang` are always empty:
  `tools/board-recipient.src.js:50` and `:99` both build
  `{ addr:a, name:"", lang:"" }`.
- The page the opp points at is `data.page_slug`, resolved at send time at
  `tools/board-send.src.js:221`: `var pageSlug = (data && data.page_slug) || slug`.
- VERDICT on the opp: the opp has NO actor / creator field. The send has an
  actor (below), the opportunity does not. This is the G9 gap. It is not needed
  for the control room's core, but it is the one field that would let us say who
  created a card, not just who sent from it.

### Entity 2: the Template (the Library page)

- Table `console_pages`: slug, html, title, task, tags, live_verified_at. This
  is the Library. A published opp card points at a template page by
  `data.page_slug`.
- There is also legacy `console_templates` hydration in the OLD engine
  (`library/app.js`, the custom-templates path). That is app.js only and is not
  the board.html Library. For the networked system, the Template entity is
  `console_pages`, addressed by slug.
- VERDICT on the template link: a send does NOT record which template it used as
  its own column. The only link from a send back to a template is indirect:
  send -> opp (`console_mail.opp = slug`) -> `console_opps.data->>'page_slug'` ->
  `console_pages.slug`. So "who did we send template Y to" is a two-hop join
  through the opp's jsonb, not a one-hop lookup. See the derivability table.

### Entity 3: the Contact

- Table `console_contacts` ALREADY EXISTS and is fully specified at
  `docs/supabase-contacts.sql`: id (text pk), addresses jsonb, name, tags jsonb,
  note, author, author_name, created_at, updated_at; a GIN index on addresses;
  RLS (read all authenticated, insert with author = auth.uid(), update/delete
  authenticated). The file's own comment states the intent exactly: "a contact
  row is a lens over the ledger, not a copy ... activity stays derived live from
  console_mail, console_hits and console_inbound."
- It is wired ONLY in the old engine. `library/app.js:4171` `supaContactRow(c)`,
  `:4179` `saveContact` -> `supaQueueUpsert("console_contacts", ...)`, `:4183`
  delete, plus `mintContactId` and the contacts.html / initContacts nav.
- It is NOT wired in board.html: a grep of all `tools/board-*.src.js` for
  `console_contacts` or `initContacts` returns nothing. board.html has no
  Contacts section today.
- VERDICT on contacts: the entity and its storage exist and match the vision
  ("a lens over the ledger"). The gap is purely that the NEW engine (board.html)
  does not surface or write it yet.

### The ledger: console_mail (the join of everything)

- Documented columns at `docs/supabase-board-view.sql:27`:
  `console_mail (id, opp, status, to_addr, subject, ts, actor, data jsonb, up)`.
- A send is written one row per recipient at `tools/board-send.src.js:405`:
  `mailRow = { id:art.token, opp:slug, status:"sent", to_addr:art.to,
  subject:art.subject, ts:isoNow(), actor:currentUid(), up:Date.now(),
  cycle:(row && row.cycle) || null, ... }`.
- So each ledger row ALREADY carries four of the five links the vision needs:
  the opportunity (`opp`), the contact address (`to_addr`), the Thrive team
  member (`actor` = `currentUid()`), and the timestamp (`ts`). The fifth link,
  the template, is only derivable through the opp (see above). `actor` is a
  manually-applied migration column per the board-view notes.
- Replies: `console_inbound`, attributed to an opp. The board view composes
  "replied" from inbound rows joined by opp with subject normalization
  (`docs/supabase-board-view.sql:116-146`, the `subjLinkKey` normalization app.js
  uses). Reply counts per contact are therefore derivable by joining inbound
  back through the send's opp + from-address.
- Opens: `console_hits`, keyed to the opp / page.

### Derivability verdict (the heart of STEP 1)

Question: can "templates sent to contact X", "sends of template Y and who got
them", and "the conversation with contact Z" ALL be derived from existing tables,
or is a new column / table needed? Exact answers:

| Question the vision asks | Derivable today? | From what | What is missing |
| --- | --- | --- | --- |
| Conversation with contact Z (all sends TO them + replies) | YES | `console_mail` where `to_addr` in the contact's `addresses[]`, joined to `console_inbound` by opp + from-address | Nothing. This is a pure ledger read. |
| Contact entity (a person, curation, tags, note) | YES, exists | `console_contacts` (schema present) | Only the board.html wiring to read/write it. |
| Who is the sender / team member of a send | YES | `console_mail.actor` | Nothing. |
| When was it sent | YES | `console_mail.ts` | Nothing. |
| Which opportunity a send belongs to | YES | `console_mail.opp` | Nothing. |
| Sends of template Y, and who received them | INDIRECT | send -> opp -> `console_opps.data->>'page_slug'` -> template | A direct `template` (or `page_slug`) column on `console_mail` would turn a two-hop jsonb join into one clean hop. Additive, one column. |
| Templates sent to contact X | INDIRECT | same two-hop chain, per contact | Same one column resolves it. |
| Reply count tag next to a contact | YES | `console_inbound` counted per opp + from-address | Nothing new; a view makes it cheap. |
| Recipient's display name (for "Hi [Name],") | NO | recipients are `{addr, name:"", lang:""}` today | The name is never captured. Sources exist (contact name, file, email local-part, page title) but nothing writes recipient.name today. |

Bottom line: the contact entity EXISTS; the send ALREADY carries actor + to_addr
+ opp + subject + ts; conversation-with-a-contact and reply-count are already
derivable. Exactly TWO things are genuinely missing at the data layer:

1. A direct template link on the send (one additive column, or a jsonb stamp) to
   make template-view a one-hop lookup instead of a two-hop join through opp
   jsonb. Optional but clean.
2. A captured recipient / contact NAME, so the greeting can say "Hi [Name],".
   The token machinery is already there (next section); only the value is
   missing.

### Signatures today (G7.1, merged)

- Per-user localized signatures are live in the editor:
  `tools/board-editor.src.js:57` `edSignature()` (the live field value),
  `:76` `edSignatureDefault(lang)`, `:88` `edSignaturePreset()`,
  `:91` `edSavedSigs()` (the saved list from the user's identity),
  `:238` `edFillSignature()`. Window seams exposed at `:354-357`
  (`__thriveEditorSignature`, `__thriveSignaturePreset`, `__thriveSignatureDefault`,
  `__thriveMsgLang`). The signature is the operator's OWN field, English and
  Arabic, stored per user.
- VERDICT: the "guarantee the signature" requirement is already satisfied by
  G7.1. The control room reuses it; nothing new is needed for signatures.

### The greeting toggle today

- There is NO "Hi [Platform] team," vs "Hi [Name]," toggle today.
- BUT the compile step already supports a `{{NAME}}` token with graceful
  empty-name cleanup: `tools/board-send.src.js:87-88`. When a name is present it
  substitutes; when absent it removes `{{NAME}}` and tidies the punctuation and
  spaces around it. So the machinery to switch between a named greeting and a
  nameless one already exists at compile time. What is missing is (a) the UI
  toggle and (b) a populated name to feed it.
- Name sources available for inference: `console_contacts.name`;
  `recipient.name` (currently ""); the uploaded file name; the email local-part
  (before the @); the offer/page title (`console_pages.title`). None are wired
  to recipient.name yet.

### Bulk send today (one-to-one already real)

- `runSend` at `tools/board-send.src.js:429` is already a REAL group send: it
  reads `allRecipients(data)` (`:251`, `:437`) and loops EVERY recipient, calling
  `sendOne` once per recipient (`:385`), one throttled relay call each, one
  `console_mail` row each. There is no shared To. Every recipient already gets an
  individual one-to-one message.
- VERDICT: the "each recipient gets an individual message, never a shared To"
  requirement is already satisfied for the campaign send path. What is missing is
  (a) making the SAME one-to-one loop the guaranteed behavior on EVERY send path
  including a text-only no-template send, and (b) the explicit checkbox to send
  the same subject to several related contacts (2 to 3) as a deliberate choice.

### Routing today (card tap and New message)

- Card tap opens the detail view, NOT the mode selector:
  `tools/bundle.js:2387` `open = function(){ openOppWindow(slug, "detail"); }`.
- `openOppWindow(slug, mode)` at `tools/bundle.js:2164`; the detail surface is
  `owDetailHtml(row, detail)` at `:2133`, the ONE opp-detail surface.
- "New message" from scratch goes through `owNewMessage()` at `:2178`, which
  calls `openOppWindow(slug, null)` at `:2182`, and null mode is the mode
  selector. `owSelectMode(mode)` at `:2067`.
- VERDICT: the routing the vision wants is ALREADY the routing. Card tap already
  lands on detail, not the mode selector; the mode selector is already reserved
  for New message. Phase 1 is therefore mostly turning the existing detail
  surface into the three-gate control room that opens on the loaded message, not
  a re-route.

---

## STEP 2: DESIGN (no code)

### The control room (opened on a card tap)

Tapping a card opens the opp control room (the existing `owDetailHtml` surface,
`tools/bundle.js:2133`), organized as three gates. It opens immediately with the
message loaded and editable. The mode selector is untouched and stays reserved
for "New message" from scratch.

```
+-----------------------------------------------------------+
|  [ business name ]                    [ close ]           |
|  Gate tabs:   MESSAGE  |  PAGE  |  CONTACT                |
+-----------------------------------------------------------+
|  GATE 1: MESSAGE  (opens here, message pre-loaded)        |
|   - live editor (edSubj / edBody), no breakage            |
|   - preview beside it, updates live                       |
|   - signature guaranteed (G7.1: __thriveSignaturePreset)  |
|   - greeting toggle:  ( ) Hi [Name],   ( ) Hi [team],     |
|         EN and AR, one tap                                 |
|   - smart name: inferred from contact / file / email /    |
|         page title; suggests gently; asks if unknown;     |
|         NEVER blocks the send                              |
|   - BULK: [x] also send this subject to related contacts  |
|         (pick 2 to 3); still one-to-one per recipient     |
|   - [ Send ]  (runSend, one console_mail row each)        |
+-----------------------------------------------------------+
|  GATE 2: PAGE                                             |
|   - the full page settings: title, link name / slug, etc. |
|   - points at console_pages by data.page_slug             |
+-----------------------------------------------------------+
|  GATE 3: CONTACT                                          |
|   - all contact data for this opp + its address           |
|   - person name, platform name, tags, note                |
|   - saves whatever exists; missing name never blocks send |
+-----------------------------------------------------------+
```

Where each requested feature lives:

- Bulk-send checkbox: Gate 1 (MESSAGE), directly above Send. It selects 2 to 3
  related contacts to receive the same subject. It changes WHO is in the
  recipient loop, not HOW they are sent: the send stays one-to-one
  (`runSend` -> `sendOne` per recipient, already the behavior).
- Greeting toggle: Gate 1, in the editor header. Two forms, EN and AR:
  "Hi [Name]," vs "Hi [Platform] team,". It flips which token the body opens with
  and feeds the compile step that already exists (`{{NAME}}` at
  board-send.src.js:87). When no name is known, the "Hi [team]," form is the safe
  default and the send is never blocked.
- Signature: Gate 1, guaranteed via the existing G7.1 seams
  (`__thriveSignaturePreset` / `__thriveEditorSignature`). No new signature code.
- Smart name inference: Gate 1 + Gate 3. The editor infers person / platform name
  from the uploaded file, the email shape, or the offer page; if it understands,
  it suggests gently; if not, it asks Thyab to add the personal / platform name to
  complete the contact, but NEVER blocks the send, and saves the contact with
  whatever data exists.

### Minimal additive schema (SQL applied by Thyab, additive only)

Reuse what exists. Add the least possible.

1. Contacts: REUSE `console_contacts` exactly as it is in
   `docs/supabase-contacts.sql`. No schema change. The only work is board.html
   wiring (a build task, not a schema task).

2. Template link on the send (optional but recommended): additive column so
   template-view is one hop instead of a two-hop jsonb join.
   ```
   alter table public.console_mail
     add column if not exists page_slug text;
   ```
   Stamp it at send time in the mailRow at `tools/board-send.src.js:405` from the
   `pageSlug` already computed one screen up at `:221`. This is purely additive:
   old rows keep NULL and fall back to the existing opp -> data->>'page_slug'
   derivation, so nothing breaks. If Thyab prefers zero schema change, the same
   value can instead be stamped into the existing `console_mail.data` jsonb; the
   column is cleaner for a view join. Thyab chooses.

3. Recipient / contact name for the greeting: NO new table. The name rides in
   `data.recipients[].name` (the field already exists, just always empty) and,
   for a curated contact, in `console_contacts.name` (already exists). The build
   populates recipient.name from the inference sources; the greeting toggle reads
   it. No schema change.

4. The opp actor / creator (G9 gap): NOT required for the control room. Flagged
   only. If Thyab wants "who created this card" (not just who sent), that is a
   separate additive column on `console_opps` and its own PR, out of scope here.

Net additive schema for the whole networked system: at most ONE column
(`console_mail.page_slug`), and even that is optional. Everything else is wiring
over tables that already exist.

### Derived views (read models; each is a lens over the ledger)

These are SQL views (or in-app derivations) that read the ledger. They store
nothing; they are exactly the "a row is a lens over the ledger, not a copy"
principle already written into `docs/supabase-contacts.sql`.

- CONTACT view (opening a contact): all `console_mail` rows whose `to_addr` is in
  the contact's `addresses[]`, ordered by ts, joined to `console_inbound` for the
  conversation history. Shows only templates sent TO this contact + the full
  thread. Derivable today; no new column needed.
- TEMPLATE view (opening a Library template): its data + who it was sent to +
  the sender (actor) + date/time + send count, plus a reply-count TAG next to any
  contact who replied, tapping into the full conversation. Derivable via
  send.page_slug (if column added) or send -> opp -> page_slug (if not). Reply
  count from `console_inbound` per opp + from-address.
- OPP CONTROL-ROOM view: the three gates over one opp. Message from
  `console_opps.data`, page from `console_pages` via page_slug, contact + thread
  from `console_contacts` + `console_mail` + `console_inbound`.

Every screen is the same ledger read from a different angle. That is the network.

### Staged build order (one PR per phase, author only, tests fail-when-broken)

- PHASE 1: the control room opens on the message.
  Turn the existing detail surface (`owDetailHtml`) into the three-gate layout,
  Message gate first, with the live editor + preview already loaded. The routing
  (card tap -> detail) is already correct (`bundle.js:2387`), so this phase is
  layout + wiring the Message gate to the existing editor and Send, NOT a
  re-route. No mode selector on card tap (already the case). Fails-when-broken
  test: tapping a published card opens the control room with its subject and body
  populated and the Send control present; proven by reverting the wiring.

- PHASE 2: bulk send guaranteed everywhere + greeting toggle + smart name.
  Make the one-to-one loop the guaranteed path on EVERY send (including text-only
  no-template) and add the "also send to 2 to 3 related contacts" checkbox. Add
  the EN/AR greeting toggle feeding the existing `{{NAME}}` compile step, with
  name inference from file / email / page title and the gentle-suggest,
  never-block behavior. Populate `data.recipients[].name`. Fails-when-broken
  test: a two-recipient send writes two individual `console_mail` rows (no shared
  To) and the named-greeting form renders "Hi <name>," per recipient while the
  nameless form stays clean; proven by reverting.

- PHASE 3: contacts section + template memory + reply tags.
  Wire `console_contacts` into board.html (the section app.js already has),
  giving a Contacts area where opening a contact shows only templates sent to
  them + full history. Add the template-view memory (who / when / count) in the
  Library and the reply-count tag next to contacts who replied. Optionally add
  the `console_mail.page_slug` column here to make template-view one-hop.
  Fails-when-broken test: after a send + a recorded inbound reply, the contact's
  view lists that send and the template-view shows the send count and a
  reply-count tag; proven by reverting.

### Open questions for Thyab (answer before Phase build starts)

1. `console_mail.page_slug` column, yes (clean one-hop template-view) or no
   (keep the two-hop opp-jsonb derivation, zero schema change)?
2. Greeting default when no name is known: confirm "Hi [Platform] team," is the
   safe fallback (the plan assumes yes).
3. "Related contacts" for the bulk checkbox: how are they related, by shared opp,
   shared template, or a tag on the contact? This decides how the picker filters.
4. Do you want the opp creator (G9) in this arc, or kept as a separate later PR
   (the plan keeps it separate)?

No code will be written until this plan is approved.
