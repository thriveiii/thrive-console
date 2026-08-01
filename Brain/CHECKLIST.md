# Pre-publish checklist — thrive-console

Adapted from `01-engineering-html-deliverables.md` §9 and `04-designer-framework.md` §7
to this repository. The mechanical checks run themselves; the rest needs a person.

## 1. Mechanical (run it, do not eyeball it)

```bash
node tools/verify.js
```

That single command covers:

- every `.js` file parses (`node --check`), so one silent syntax error cannot disable a page
- no secret-shaped string anywhere in the repository
- EN/AR key parity in `library/i18n.js`, both directions
- every `data-i18n` key used in HTML exists in both dictionaries
- copy gates on all user-facing text: zero em dashes, zero Eastern digits, Arabic
  quotation with guillemets, no leaked `{{PLACEHOLDER}}` outside a template
- no `src=""`, no `href=""`, every private page carries `noindex,nofollow`

Then the browser suites, which are the only proof the behaviour still holds:

```bash
python3 <scratchpad>/test*.py     # all suites must print ALL PASS
```

## 2. Data honesty

- Does every number on Overview come from a source that can be named? A count with
  no traceable origin is a bug, not a metric.
- Is a zero printed as `0` rather than hidden? An empty state that hides itself
  reads as "no data exists" when it means "this device has not synced".
- Does a failure say what failed, in the relay's own words? No silent degradation
  to a friendly message.

## 3. Bilingual parity

- Every new string added in English exists in Arabic, written natively, not
  translated word for word.
- Arabic greeting form is «مرحبًا مجد،», never a transliterated English pattern.
- Ratios, dates, URLs and codes stay LTR inside Arabic text.
- The metric badge sits top-right in English and top-left in Arabic, from the same
  logical rule.

## 4. Layout at three widths

Phone (390px), tablet, desktop:

- no horizontal scroll at 390px
- no element outside its container
- grids collapse rather than leaving one stretched item alone on the last row
- tooltips open inside the viewport in both directions

## 5. Before it is live

- `git log --oneline -3` — the commits actually landed.
- The published page is the page you tested. Merged is not deployed; open the live
  URL and confirm the change is visible there.
- If the change touched the relay contract, the relay's own version string must
  confirm it. The console refuses a relay that does not answer v4 for exactly this
  reason.
- No secret was printed anywhere in this session. If one was, it is compromised:
  rotate it now, not later.
