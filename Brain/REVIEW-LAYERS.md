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
