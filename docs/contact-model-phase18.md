# The universal contact model (P18)

P17 filled the envelope: subject, names, template, and the send-to address were captured. But the contact
did not reach the card. Two defects sat under the Communication tab.

1. **The send-to was not wired onto the card.** The envelope carried `send_to`, but the Communication tab
   read a different, empty place (`o.channel` / `o.contact_tier`). The one-source law was violated: two
   fields claimed to hold the contact, and the one the tab read was blank.
2. **Capture was email-only.** A business that lists a phone, a WhatsApp number, an Instagram handle, or an
   Arabic جوال line was read for its email and nothing else. Every other way to reach it was dropped on the
   floor.

## The model: R11, one list

An opportunity now carries ONE channel list. Each channel is one shape:

```
{ type: email | phone | whatsapp | social | form | other,
  value,                       // the address, number, or URL
  platform,                    // social only: instagram | x | tiktok | facebook | linkedin | other
  handle,                      // social only: the username, no @
  tier: A | B | C,
  tier_basis: sighted | stated | inferred,
  source: page | research md | opp.md | manual,
  primary }                    // exactly one channel is primary: the send target
```

The composer, the roster, and the Contact Book all read this one list through the SAME reader
(`contactChannels`). There is no second contact field.

### Tiering travels with the channel

- **sighted** on the business's own surface (a `mailto:` / `tel:` / `wa.me` / social link on their page) is
  Tier A / sighted, settled.
- **stated** by a research md is Tier A / stated, shown "Tier A per research, confirm". One tap (Confirm)
  flips the basis to sighted after Thyab has verified the address. It is never auto-upgraded.
- anything merely **inferred** is Tier C / inferred.

A channel is never invented, and a tier is never raised without a sighting.

## Capture: the one extractor, extended

The single key-line extractor already read `Send to` and `Subject`. It now also reads, in English and Arabic,
anywhere on a line, bold-tolerant:

- **Phone / Tel / هاتف / جوال / رقم** -> a phone channel (digits normalized, a leading `+` kept). A second
  number on another line (the Arabic جوال beside an English Phone) is a second phone, not a dropped one.
- **WhatsApp / واتساب** -> a `wa.me` link.
- **Instagram / X / Twitter / تويتر / إكس / TikTok / Facebook / LinkedIn** -> a social channel; the handle is
  derived from a URL or an `@handle`, its case left as written.

From a rung-4 page read (`index.html`), `mailto:` / `tel:` / `wa.me` / social profile links visible on the
business's own page are captured as Tier A / sighted.

`buildChannels` enumerates the email, the phones, and the socials, dedupes by `type|platform|value`, classifies
and tiers each, and marks exactly one primary (the email when there is one, else the first channel).
`toRecord` writes it once, as `channels`. The old `channel` / `contact_tier` fields remain only as the legacy
mirror of the primary, kept for the send path.

## Wiring to the card

- **The Communication tab** renders the channel list from the one field: a type icon, the value (LTR-isolated),
  a tier chip whose colour is the basis (green sighted, amber stated, muted inferred), a primary marker, and a
  one-tap Confirm on a stated tier. The Confirm writes the flipped basis back onto the SAME list.
- **The composer To** resolves from the primary email channel. A card whose primary is a non-email channel and
  which has no email at all leaves the To blank and shows "This is not an email channel. Pick an email channel
  or add one to send by email." rather than sending to the wrong place.
- **A legacy card** that predates R11 (no `channels[]`) is read into the SAME shape by the one reader, so its
  email still appears in the tab. One model, no second store.

## Evidence

- **`tools/ingest_matcher_test.js`** (permanent, extended): a crafted section with a Phone, a WhatsApp link, an
  Instagram handle and an Arabic جوال captures four channels beside the email; the Arabic line yields a second
  phone (not dropped); the WhatsApp channel is a `wa.me` link and the Instagram channel carries the bare handle;
  exactly one channel is primary and it is the send-to email; a rung-4 page (mailto + instagram on the
  business's own surface) gives an email and a social channel, every one Tier A / sighted; a research-md address
  is Tier A / stated, never auto-upgraded; there is exactly ONE channel builder, `toRecord` writes it once, and
  ten reads of the list are byte-identical.
- **`tools/contact_model_test.py`** (permanent, live): on the real console modal, a research-stated email
  renders as a channel row with a "Tier A per research, confirm" chip, a primary marker, and a Confirm control;
  one tap flips the basis to sighted, the Confirm control goes away, and the flip is written back onto the one
  list; a non-email card lists every channel, offers no email path, and marks WhatsApp primary; a legacy card
  with no `channels[]` still shows its email; the tab mirrors to RTL in Arabic with «الفئة A حسب البحث، أكِّد»
  and «الأساسية»; and on `compose.html` the email-primary card's To resolves to exactly the primary address
  while the non-email-primary card's To stays blank with the "not an email channel" note.

Gates: `verify.js` 35/35, `arabic.py`, `flows.py`, `perf_gate.py` green (the bundle ceilings raised a few KB
for the R11 reader, the channel-list render, the `ocm_*` strings and the CSS, documented in `perf_gate.py`).
Isolation grep clean (lotus/newsroom only the benign `store.js:20` prose); no long dash. `board_match_join_test`,
`card_page_link_test`, `calm_composer_test`, `contacts_test`, `comments_test`, `thread_structure_test` all green
after the module-scope hoist of the one reader.

## Do not (held)

The channel list is the one source; there is no second contact field. A stated tier is never auto-upgraded to
sighted; only Thyab's Confirm tap does it, and only after a sighting. A non-email channel is never dropped, and
a message is never sent to a C-tier or non-primary channel without an explicit choice. Sending pacing, the
thread render, Lotus, and the newsroom asset are untouched. Counts render outside the translated strings, inside
`<bdi class="n">`; Arabic carries no letter-spacing.

## Real-zip caveat

The real batch-13 producer zip is not present in this environment. The defect and the fix are reproduced against
the real field shapes - the shared bold `Send to ... Subject` line, the labeled Phone / WhatsApp / social lines
in English and Arabic, the `mailto:` / social links on a rung-4 page, and the `en-opp1` bundle template - in
Node and on the live console surface. Drop the actual zip into `tools/fixtures/` and the same board test runs
against it directly.
