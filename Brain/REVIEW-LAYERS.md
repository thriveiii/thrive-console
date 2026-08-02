# The five review layers

خمس طبقات مراجعة، تُمرَّر على كل صفحة وكل قسم بالترتيب. الطبقة الأولى تسأل عن المعنى، والأخيرة تسأل عمّا يحدث حين ينكسر شيء.

Every page and every section passes through these five, in order. They are ordered on purpose:
a page that fails layer 1 cannot be rescued by layers 2 to 5, and polishing a screen whose
purpose is unclear is the most expensive way to waste a day.

| # | Layer | The question it asks | It fails when |
|---|---|---|---|
| 1 | **Purpose** | What is this screen for, and what does the reader do next? | Two entry points, or none. A section that exists because the data existed. |
| 2 | **Story** | Does it read as sentences before it reads as numbers? | The reader has to do arithmetic to know whether things are going well. |
| 3 | **Truth** | Can every number be traced to its source, and does a zero look like a zero? | A count with no origin, an empty state that hides itself, a green line over a failed write. |
| 4 | **Craft** | Spacing, hierarchy, both languages, both directions, three widths. | Arabic that reads like translated English. A badge that moves between languages. |
| 5 | **Resilience** | What does the reader see when this fails, is slow, or never loads? | A spinner with no end. A cause printed that did not happen. A blank locked page. |

---

## Applied so far

### Overview (`library/index.html`)

- **Purpose.** One entry point: the sentence at the top. Everything below it is evidence for
  that sentence, in widening detail: tiles, campaigns, messages, people, pages.
- **Story.** The page now opens with a line in plain language: who you wrote to, who answered,
  how often your pages were opened. Tiles say what happened; the sentence says what it means.
- **Truth.** Every non-archived opportunity has a row, zeros printed as zeros. Own previews
  excluded from every count. Replies credited to the template that earned them, through the
  conversation, never guessed. A send with no template is grouped as "no template" rather than
  dropped.
- **Depth added.** Two readings that did not exist: per message (sent, opens, open rate,
  replies, reply rate) and per person (state: answered you, read it and went quiet, sent and
  not opened, no sign of life). The first answers "which message works", the second answers
  "who do I follow up, and why".
- **Craft.** Metric badge pinned to the trailing corner, so top-right in English and top-left
  in Arabic from one rule.
- **Resilience.** Boot failsafe; the analytics banner names the relay's own error verbatim.

### Settings (`library/settings.html`)

- **Purpose.** Connection health sits first and answers the only question that page is asked
  in practice: is this thing working, and if not, which link is broken.
- **Truth.** A half publish is reported as a half publish. A timeout is called a timeout, not
  a wrong key. Nothing is painted green that did not happen.
- **Resilience.** Every relay call is time-boxed and retried once; rows fill in as answers
  arrive; a throw still ends with a verdict on screen.

---

### The shell and the drawer (`library/console.html`)

- **Purpose.** One document, seven views, three destinations in the bar. The console stopped
  being a set of pages and became an application, which is what makes it bearable on a phone.
- **Story.** The work opens beside the board rather than instead of it. You never lose your
  place, because your place never went anywhere.
- **Truth.** The drawer *moves* the existing editor and composer nodes rather than copying
  them, so the document holds exactly one of each and one set of listeners. Two copies would
  mean duplicate ids and a send button belonging to whichever loaded last.
- **Craft.** On a phone the drawer stops at 92vw, leaving a strip of the board visible and a
  scrim to tap. A full-width sheet leaves only a button a thumb cannot always reach.
- **Resilience.** Escape closes it, the scrim closes it, focus moves to the close control on
  open and returns to the token on close. The single pages still work with no drawer at all:
  the layer stays dormant when `#drawer` is absent.

## The audit of the new platform

Run it: `python3 tools/audit-five-layers.py`. It walks the shell the way a person does, at
390 with a finger, at 1024 and 1440 with a pointer, in both languages. 98 assertions, one per
layer question. It is kept because a review that cannot be re-run is an opinion.

Four defects it found, all fixed:

**1. Listeners were clobbering each other. (Layer 3, Layer 5)**
Every view used to own its page, so assigning `window.onThriveSync` was safe. In one shell
they share one window, and the view that initialised last silently unsubscribed every view
before it. Opening Activity once stopped the board refreshing on sync, and the board's own
handler had already displaced the sync round that runs on unlock. This is the defect the shell
introduced and nothing would have surfaced it except walking between views and then syncing.
Listeners are registered by key now, so a view replaces only its own and all of them run.

**2. The most-tapped controls were too small to tap. (Layer 4)**
The three destinations in the bar measured 33px, the lock 31px, the board chips 24px. On a
phone those are the controls used twenty times a day. A pointer keeps the tighter density; a
finger now gets 40. The chips gained a real hit area at every width, because a chip here is a
filter before it is a label.

**3. `aria-modal` was a promise the keyboard did not keep. (Layer 5)**
The drawer declared itself modal, and a pointer was correctly held out by the scrim, but Tab
walked straight out of the dialog into a board the reader could not see. Focus is trapped
inside it now, and still returns to the token on close.

**4. The gate input tracked its Arabic placeholder. (Layer 4)**
Found by the checklist in phase 6. Letter-spacing on Arabic breaks the joins. Latin only.

## Queued, in this order

1. **Compose** (`compose.html`): the densest screen and the one used most under pressure.
   Layer 2 and 4: fewer visible controls at rest, the link manager folded until there is a
   link, the month field appearing only when the template asks for one.
2. **Library** (`library.html`): layer 1. It currently offers search, sort, two filters and a
   language toggle with equal weight. One primary path, the rest secondary.
3. **Editor** (`editor.html`): layer 5. What happens when a publish fails halfway.
4. **Templates** (`templates.html`): layer 2. Show each template's own performance next to it,
   now that per-template numbers exist.
5. **Activity** (`activity.html`): layer 1. It is a log; it should read as a story of the week.

Nothing here is cosmetic-only work. Each entry names the layer that fails today, so the pass
can be judged rather than admired.
