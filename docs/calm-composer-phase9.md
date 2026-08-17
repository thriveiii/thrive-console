# The calm composer + one compile path (P9 / D8)

Two jobs, one PR. Part A closes the two-path compile window P8 opened on purpose; Part B quiets the
composer chrome. Off latest main (P5–P8 merged); author only; Thyab merges. No new store, no SQL.

## Part A · one compile path (load-bearing)

P8 shipped with two compile paths by design – a single-send builder (`compileArtifact`) and a campaign-row
builder (`compileCampaignRow`), both drawing from a shared `composeArtifactCore` – with a parity gate
holding them byte-identical until this brief could collapse them. P9 collapses them.

There is now **one** `compile(recipient, content)`:

- `recipient = {addr, name, lang}` – who the message is for.
- `content = {innerTpl, subjectTpl, business, link, month, sig, branded, slug, track, tokenSlug,
  firstName, lang, rawText}` – what the message says, before this recipient's merge.

`compile` owns every piece of the send that must be identical across single and campaign: the field merge
(`mergeFieldsInto`), the POSTAL footer (`ThriveStore.footerHtml` / `footerText`), the tokenized page link,
the open pixel (`openPixelHtml`), and the deterministic per-recipient token (`recipientOpenToken`). The
footer is attached in exactly one place – `grep ThriveStore.footerHtml` is **1**, `ThriveStore.footerText`
is **1** – so no surface can drift.

Two thin builders assemble `content` from their own world and hand it to the one compile:

- **`editorContent(opts)`** reads the live DOM (`bodyTemplateHtml()`, `#esubject`, signature, branded
  toggle, first-name checkbox, plain-text override) and, bound as `window.__cmpCompile(rec, opts)`, calls
  `compile(rec || fieldRecipient(), editorContent(opts))`. Preview, self-send, and real send all go
  through it.
- **`campaignContent(o, tpl)`** builds the same shape from a campaign opportunity + template;
  `startCampaignQueue` calls `compile(sr, content)` once per recipient row.

The deleted functions – `composeArtifactCore`, `compileArtifact`, `compileCampaignRow` – are gone from the
tree (`grep` proves zero). The parity gate stays and now proves the point directly: a single send and a
campaign row for the same recipient and content are **byte-identical** in subject, HTML, text, and token
(`tools/compile_parity_test.py`, named and nameless recipients), and a different recipient produces
different bytes and a different token.

## Part B · the calm chrome

The composer used to open on a permanent formatting toolbar (bold / italic / underline / list / link /
unlink / personalize / link-to-opportunity), a template dropdown, a "More" block, a closing-block
disclosure, a plain-text disclosure, and the preview – everything at once. P9 opens on only what a first
message needs:

| Old control (permanent) | New home |
| --- | --- |
| To / Recipient name | unchanged, at the top |
| Subject | unchanged |
| Message body (`#ebody`) | unchanged, one mount |
| **B / I / U / List / Link / Unlink** toolbar | floating `#eFloatBar`, revealed by **Aa** or by selecting text; parks just inside the body, never over the rail |
| **Link to opportunity** | in the floating bar (`#tbOpp`) |
| **Personalize names** chip | first-class, above Send, beside Preview |
| **Preview** | first-class control (`#cmpPreviewBtn`), never in the overflow |
| Message template dropdown + **More** | the one overflow (`#cmpOverflow`), opened by the rail's More |
| Closing block | in the overflow |
| Plain-text alternative | in the overflow |
| Send to myself / Copy / Open in mail app | in the overflow |
| **Send** | first-class, always visible |
| Undo / Redo | quiet on the body rail |

The floating format bar preserves the body's selection when a button is pressed (`mousedown` →
`preventDefault`, the standard rich-text-toolbar move), so bold/italic/link apply to the current selection
instead of collapsing it. It is placed relative to the selection but floored at the body's own top, so a
first-line selection or a no-selection pin never rides up over the Aa rail.

Nothing is restyled beyond the existing tokens (`--hair`, `--ink-2`, `--purple`, `--panel`, `--panel-2`,
`--grad`, `--e-enter`); the reveal animation respects `prefers-reduced-motion`.

## One component

There is still exactly one composer – `initCompose` – mounted for compose (`initCompose(current)`) and for
reply (`initCompose(current, {reply:true, ...})`). Part B added no second component and hid neither Send
nor Preview.

## Proof

- `tools/calm_composer_test.py` – one composer, one compile, the P8 second paths gone, one `#ebody`, no
  permanent `class="etoolbar"`; and live: calm default view (only To/Subject/body/Send + the two campaign
  controls), Aa reveals/toggles the floating bar, More reveals the one overflow, a text selection reveals
  the bar, a format button applies to the selection, Preview opens the per-recipient preview.
- `tools/compile_parity_test.py` – single == campaign, byte-identical, through the one compile.
- `tools/relay_courier_test.py` – one compile function, footer attached in exactly one place, both
  single-send payloads build from `compile`.
- `tools/true_preview_test.py`, `tools/personalize_merge_test.py` – preview equals sent; merge names
  render, nameless falls back cleanly, EN + AR.
- Gates green: `verify.js` 35/35, `arabic.py`, `flows.py`, `perf_gate.py`. Isolation grep clean. No
  em-dash (U+2014). Renders with no horizontal scroll at 390 / 1024 / 1280 in EN and AR.
