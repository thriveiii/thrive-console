# Brain — Thrive's deep-knowledge archive

الغرفة المركزية للمعرفة العميقة في خلفية ثرايف: كل درس هندسي أو تصميمي أثبت نفسه، محفوظ هنا كمرجع دائم.

This folder is the standing reference behind Thrive's build work. It holds four
documents, kept verbatim as they were written, plus a map of what the console
already enforces, what was folded in from them, and what is deliberately kept as
reference only.

Nothing in here is executed. `Brain/` is documentation: the console does not read
it at runtime and it is never published to a prospect. The one operational file
that came out of it lives outside this folder, at `tools/verify.js`.

---

## The four documents

| File | What it is | Best used for |
|---|---|---|
| `01-engineering-html-deliverables.md` | 18 hard-won lessons from building animated, RTL, client-facing HTML: build architecture, programmatic visual QA, RTL coordinate traps, cascade traps, runtime resilience, scroll-UX kit, self-contained shells, Arabic numeral formatting, motion vocabulary, client-side gating | Any new HTML deliverable, and any change to `opp/` pages or `templates/` |
| `02-technical-capabilities-transfer-pack.md` | A source-neutral engineering playbook in Problem → Solution → Rule form: architecture, git and deploy, Postgres, static + serverless, build discipline, debugging, data integrity, RTL/i18n, PDF generation, code discipline | Backend and deployment decisions, data-integrity questions, anything about trusting a claim |
| `03-carousel-and-story-pattern.md` | The carousel and story design system: brand truth, identity vs chrome, locked palette, narrative architectures, motif library, caption voices, the render script | Social and story output; also the canonical statement of brand voice and the locked palette |
| `04-designer-framework.md` | The designer framework: 8-point grid, type scale, 60/30/10 colour, Reverse-Z for Arabic, design schools, the 20-point pre-delivery checklist, format rules | Any visual deliverable, and the checklist before any hand-off |

---

## What the console already enforces

These principles were already live in `thrive-console` before this archive
landed. They are listed so nobody re-implements them, and so a future change
that breaks one is recognised as a regression rather than a preference.

| Principle | Source | Where it lives |
|---|---|---|
| No em dash in any output, any language | 03 §2, 04 §3 | `tools/verify.js` gate, all copy in `library/i18n.js` |
| Arabic guillemets «...», never straight quotes in Arabic | 03 §2 | `library/i18n.js`, checked by `tools/verify.js` |
| Western numerals (1, 2, 3) in every language | 01 §7, 03 §2 | all views; Eastern digits are a verify failure |
| No letter-spacing on Arabic, no uppercase on Arabic | 01 §7, 02 §8.3 | `library/styles.css` `html[dir="rtl"] … letter-spacing:normal;text-transform:none` |
| Digits and identifiers are LTR islands inside RTL | 02 §8.2 | `unicode-bidi:isolate` + `direction:ltr` on ratios, dates, URLs, mono cells |
| Arabic body needs more line-height | 02 §8.4, 04 §3 | 1.55 base, 1.6–1.7 on note, quota and body blocks |
| Logical properties so one stylesheet serves both directions | 02 §8.1 | `inset-inline-end`, `margin-inline-*` throughout; the metric badge sits top-right in English and top-left in Arabic from one rule |
| No string ships in one language only | 02 §8.7 | EN/AR key parity, asserted by `tools/verify.js` |
| Honest states, never pretend success | 02 §7.3 | the relay banner reports the verbatim relay error; sync failures never render as success |
| Drop, never invent | 02 §7.4 | zero is printed as `0`, never hidden; "never invent a quote, an email, a number, or a claim" in the editor rules |
| One source of truth; caches are provisional | 02 §3.8 | the shared relay store is canonical; local ledgers union-merge into it |
| Deduplicate first; repetition raises confidence, not count | 02 §7.5 | `hitKey()` dedup before any analytics count |
| Merge is not deploy; prove the running version | 02 §2.1 | the relay probe reads the live `/exec` and refuses a URL that does not answer v4 |
| Verify agent success claims | 02 §2.4 | every change in this repo is verified by the Playwright suites before it is pushed |
| Exposure equals compromise | 02 §6.10 | no secret in the repo: `RESEND_KEY` and `SYNC_KEY` live only in Apps Script properties, the GitHub token only in the browser, and `tools/verify.js` fails on a key-shaped string |
| Client-side gating is UX, not security | 01 §18 | stated in the header comment of `library/gate.js`; the `opp/` pages are deliberately public |
| `noindex,nofollow` on private deliverables | 01 §14 | every `library/*.html` and both `templates/*/template.html` |
| Self-contained shell: tokens plus embedded fonts | 01 §14 | `:root` token set in `library/styles.css`; base64 Lato and Alyamama inside every published page |
| Honour `prefers-reduced-motion` | 01 §12 | `library/styles.css` §295 |
| Passive scroll listeners | 01 §12 | tooltip and rail listeners use `{passive:true}` |
| The locked brand palette and gradient | 03 §5 | `--purple #9685CA`, `--pink #EE8C9D`, `--teal #71BFCC`, and the six-stop `--grad` are exactly the archive's values |

## What was folded in from the archive

| Added | Source | Where |
|---|---|---|
| A repository verify gate: syntax check, secret scan, copy gates, EN/AR parity, dead-attribute and placeholder scan | 01 §9, 02 §5.2, 02 §5.3 | `tools/verify.js`, run with `node tools/verify.js` |
| A copy pass that the new gate then locks in: 142 em dashes removed from both languages, the 3 curly quotes in English copy straightened, Eastern-Arabic digits removed from Arabic copy, tanwin moved onto the letter (`مؤقتًا`, not `مؤقتاً`) | 01 §7, 03 §2, 04 §3, 04 §12 | `library/i18n.js`, `library/app.js`, `library/gate.js`, `beacon.js`, `library/compose.html`, `library/styles.css`, `library/fonts.css` |
| A boot failsafe so a script failure can never leave a blank locked page | 01 §12 | inline watchdog in every `library/*.html`, `.bootfail` in `library/styles.css` |
| A `<noscript>` statement instead of an empty screen | 01 §12 | every `library/*.html` |
| The pre-hand-off checklist, adapted to this repository | 01 §9, 04 §7 | `Brain/CHECKLIST.md` |

## Deliberately not applied

| Not applied | Why |
|---|---|
| The Eastern-Arabic numeral formatter (01 §15) | The same archive rules Western numerals for commercial work in both languages (03 §2). The formatter is kept in 01 §15 for the day an institutional or government deliverable needs it. |
| The scroll-UX kit: progress ring, scroll-spy, count-ups (01 §13) | The console is a working control room, not a scroll narrative. Motion here is one slow logo turn and nothing else. |
| The tiered hot/warm/cold data lifecycle and the Postgres playbook (02 §1.4, §3) | There is no database. The console is static plus one Apps Script relay by design. |
| Video facade, carousel render scripts, PDF generation (01 §6, 03 §10, 02 §9) | No such deliverable exists in this repository. They belong to the studio's output work, and stay here as reference. |
| Agents author, humans merge (02 §2.3) | Recorded as the standing rule. It is a workflow commitment, not something this repository can enforce for itself. |

---

## How to use this archive

- Read the relevant document **before** starting work in its area, not after a
  failure has already happened. That is the whole point of the folder.
- Run `node tools/verify.js` before every push. It is the mechanical half of the
  archive; `Brain/CHECKLIST.md` is the half that still needs a person.
- When a new lesson is proven, extend the matching document and add a line to the
  tables above. An archive that is not updated stops being trusted.
