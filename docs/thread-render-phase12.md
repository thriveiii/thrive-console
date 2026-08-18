# The message model and the thread render (P12 / R10)

P11 fixed opportunity ingest; it did not touch how a message is shown. The thread view (thread v2,
`renderHistory` → `threadListHtml`) still collapsed a message into an undifferentiated blob and the renderer
guessed at it. On the live console the مدارس المدار الدولية thread rendered the **subject** ('من جد وجد') where
the body belonged, the real **body** ('مرحبا، إليكم العرض...') was visible only buried inside the reply's
quoted original, sender and recipient were undistinguished, and the panel's margins did not match the composer
beneath it. Root cause: there was no structured message object, so the render guessed. This brief defines the
model and rebuilds the render on it. Off latest main (P5–P11 merged); author only; Thyab merges; additive only.

## R10 · the one message model (`buildMessage`)

A message is an object with named fields, never a blob:

```
{ time, from, fromAddr, to, toAddr, subject, body, quoted, direction }
```

`buildMessage(entry)` reads one thread entry into this shape once, and every surface reads its fields. For an
**outbound** send it reads the compiled body the ledger already stored (`m.preview`, carried through
`buildThread` - the send path has written it all along; the thread simply dropped it) plus `to`/`subject`/`ts`;
for an **inbound** reply it reads `from`/`subject`/`ts` and the reply text. `splitReplyBody` separates the new
answer from the quoted original **once**, with the same quote detector the renderer already uses
(`quoteStartIndex`), so the "On &lt;date&gt; X wrote:" header and everything below it is `quoted`, never
`body`. The subject is its own field, never mistaken for either. Pure derivation: the stored row is never
rewritten.

## the render, rebuilt on the model

`renderMessageBody(msg)` is the one body renderer. Each message is one card with distinct, labeled zones:

- **header** - the sender, then the recipient (`msgWhoLine`: each name its own isolated run, the recipient
  quietly behind one localized "to" label), with the timestamp pinned to the opposite edge;
- **subject** - its own emphasized line (`.rp-subj`), never rendered as the body;
- **body** - the answer in its own block (`.rp-snip`);
- **quoted** - the prior thread as one quiet collapsible section (`details.rp-quoted`, collapsed by default,
  expandable on tap), its recomposed header and quoted lines collapsing together, clearly separated from the
  new message.

A field that is absent has its zone omitted cleanly - no empty label, no stray gutter. Outbound (neutral, far
edge) and inbound (replied-green, reading-start edge) are told apart by alignment and tint, consistent EN and
AR. Both `sentCard` and `replyCard` build the model and render through the one body path - one model, one
render, no per-thread or per-slug branch. The chief fix falls straight out of it: an outbound send finally
shows its compiled body, so the words we sent are read where we sent them instead of only where the reply
quoted them.

## layout

The thread panel now shares the composer's content column: the reply editor beneath it is a `.compose-panel`
(`max-width:820px`) inside a `.panel` (20px inline padding), and `#modalHistory .th-list` takes the **same**
max-width and the **same** inline gutter. With `box-sizing:border-box` global, the two content columns line up
on both edges (equal gutters, matching the composer), and nothing overflows. Existing design tokens only; no
letter-spacing on Arabic; the recomposed quote header keeps each part isolated so a mixed-direction header
never scrambles; Western numerals; reduced motion respected.

## Evidence

`tools/thread_render_test.py` (logic, 16/16) and `tools/thread_gutter_test.py` (the real card window at three
widths EN/AR, 42/42) prove:

1. The مدارس repro: the outbound send shows sender, recipient, timestamp, the subject on its own line, and the
   full compiled body in its own block; the inbound reply shows its answer with the quoted original collapsed
   beneath it and expandable; the subject is never rendered as the body, the body never buried in the quote.
2. A single-recipient thread and a campaign thread render the same zones through the one renderer (source:
   one `buildMessage`, one `renderMessageBody`, both cards route through them; no per-thread/per-slug branch).
3. At phone / iPad-landscape / desktop, EN and AR, the thread's content column matches the composer's on both
   the inline-start and inline-end edge, and neither the page nor the thread panel scrolls horizontally.
4. A message with no subject omits the subject zone cleanly (no empty label), body still shown.
5. Ten reads are byte-identical; `buildMessage` splits body from quoted with named fields; rendering never
   rewrites the stored row.

The existing thread invariants still hold (`thread_structure_test`, `reply_body_rtl_test`,
`reply_hardening_test`, updated to the new zone structure): per-line direction isolation, the recomposed
header, XSS inertness, the collapsible quote, no overflow. Gates: `verify.js` 35/35, `arabic.py`, `flows.py`,
`perf_gate.py` (app.js ceiling raised the minimum for the model + renderers; dist within ceiling; hydrate
still 11). Full bed green but the one known-benign `supabase_stage1` failure (a retired-brand word in
pre-existing docs, unrelated to this change and failing identically on main). No em-dash (U+2014); isolation
grep clean.

## Do not (held)

The renderer reads the named fields of the model (R10), never a blob. The subject is never shown as the body;
the body is never buried in the quoted thread. The thread panel does not overflow and shares the composer's
margins. There is one model and one render, no second parse path. Arabic carries no letter-spacing. Ingest
(P11), sending (P8) and the isolated newsroom asset are untouched.
