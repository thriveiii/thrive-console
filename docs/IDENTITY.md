# Thrive Console · Identity and experience law

This document explains why every visual and behavioural decision in the console exists, and it
sets the rule that governs decisions nobody has made yet. When a future change is proposed and
this document does not obviously answer it, §12 tells you how to decide, and the decision gets
written back into this file.

Read this before adding anything. A component that violates a law here is a defect even if it
looks good.

---

## 1. What the console is for

The console is where one person decides who to contact next and follows through.

It is not an analytics product. It is not a CRM. It is not a dashboard. It is a follow-up
instrument used by an operator with limited attention, usually on an iPad, usually for a few
minutes at a time.

Everything below follows from that sentence. When two design options conflict, the one that
gets a decision made faster wins, even when the other one shows more.

## 2. The four diagnoses that produced this identity

The previous version was not ugly. It was flat in the specific sense that everything carried
the same weight.

1. **Seven equal destinations.** Overview, Library, Editor, Compose, Templates, Activity,
   Settings, all rendered as identical links. Configuration sat beside daily work as an equal.
2. **A home page that reported instead of ruling.** Six stacked blocks of true information and
   not one sentence saying what needed a decision today.
3. **One visual weight.** Every surface a panel, one hairline border, one radius. The gradient
   appeared only on buttons, so colour carried no meaning and could not be read.
4. **Context broken by every action.** Card to editor to composer to log, each a view change,
   each a scroll reset. The navigation cost more attention than the work.

Each law below is the direct answer to one of these.

## 3. The organising principle: state is position

**Law 3.1.** The primary surface is a board. Horizontal position encodes state. Nothing else
on the board may encode state.

**Law 3.2.** No lane may be hidden to make a layout fit. On narrow viewports the board scrolls
horizontally and every lane remains reachable. A hidden lane misrepresents the pipeline, and
misrepresenting the pipeline is worse than a scrollbar.

**Law 3.3.** Finished work does not compete for width with live work. Won and lost live in a
collapsed tray below the board. Their counts stay visible, their tokens do not.

**Law 3.4.** Lane membership is always derived, never stored. Rationale is in
`MIGRATION.md` I1. The short version: stored state drifts, derived state cannot.

**Law 3.5.** The board answers "where is everything". It is deliberately weak at "how is the
messaging performing". That question keeps its own surface. Do not fix the board's weakness by
crowding it, because the crowding is exactly what this redesign removed.

## 4. The colour law

The Thrive gradient is `#72BECE → #5D7FB7 → #9685CA → #EE8C9D → #A78CA7 → #71BFCC`. In the
previous console it appeared only as a button fill, which is decoration. Here it becomes a
scale, and travelling it means progress.

| Meaning | Token | Hex | Why this position |
|---|---|---|---|
| Draft | `--lane-draft` | `#71BFCC` | The gradient's opening. Nothing has left the building. |
| Live | `--lane-live` | `#7F9FD4` | The gradient's second stop, lightened for contrast on `#0a0a0c`. |
| Sent | `--lane-sent` | `#9685CA` | The brand's own centre. The midpoint of the journey. |
| Opened | `--lane-opened` | `#EE8C9D` | The warmest point. Attention has been paid. |
| Replied | `--lane-replied` | `#7EE0B8` | The terminal state, already the console's `badge.sent` green. |
| Stalled | `--state-stall` | `#F6CF5B` | Already the console's `badge.draft` amber. Warning, not failure. |

**Law 4.1.** No colour enters the system without a meaning. A colour introduced to look good
is a defect, because the moment colour is sometimes decorative, colour stops being readable
anywhere.

**Law 4.2.** The full gradient is reserved for crowning moments: the primary action, the logo
mark, and nothing else per screen. When the whole gradient is everywhere, no single moment can
be crowned.

**Law 4.3.** Green and amber are not new. They were already carrying `sent` and `draft` badge
meanings in the shipped console. The identity extends the existing system rather than
replacing it, so no user relearns a colour.

**Law 4.4.** Colour is never the only carrier of meaning. Every lane also has a text label and
a count, every stalled token also has an age in text. This is an accessibility requirement and
also a printing requirement.

**Law 4.5.** Surfaces stay near-black. `--bg #0a0a0c`, `--panel #111116`, `--panel-2 #16161d`.
The palette earns its saturation by spending almost none of it on surfaces.

## 5. The weight law

**Law 5.1.** Three levels of visual weight exist, and only three.

- **Surface.** Background and panels. Hairline borders at 10% white. No shadow.
- **Object.** Tokens, cards, drawer. One border, one radius, and elevation only while moving
  or while raised by interaction.
- **Accent.** Exactly one element per screen may carry the full gradient or Syne 800.

**Law 5.2.** A new component picks a level before it picks a style. If it cannot be placed in
one of the three, it is probably two components.

**Law 5.3.** Radii are `--r-sm 8px`, `--r-md 12px`, `--r-lg 16px`, `--r-xl 18px`. Nothing else.
A one-off radius is how a system starts dying.

## 6. The typography law

**Law 6.1.** Latin is Lato, in 400, 700, and 900. Arabic is Alyamama in 400 and 700, matching
the shipped console's embedded stack. Never Inter, Roboto, Arial, or any system font.

**Law 6.2.** Syne 800 is a display moment, not a typeface. At most one per screen, reserved for
a number or a verdict that deserves to be the only loud thing in the frame. If a screen has
two, it has none.

**Law 6.3.** Numbers that a person must compare are set in Lato with tabular alignment and
isolated with `unicode-bidi: isolate`. The console already learned this the hard way: without
isolation, the bidi algorithm reorders `15 / 100` into `100 / 15` in Arabic, and the number
then reads as simply wrong.

## 7. The Arabic law

These are hard rules. Breaking any of them is a defect, not a taste difference.

**Law 7.1. Never apply `letter-spacing` to Arabic text.** It breaks the joins between letters
and produces something that reads as broken rather than as styled. Scope every `letter-spacing`
declaration to Latin selectors, and set `letter-spacing: normal` on any shared class that
carries Arabic.

**Law 7.2. Never apply `text-transform: uppercase` to Arabic.** The script has no case. The
declaration does nothing useful and signals that the rule was copied without thought.

**Law 7.3. Quotation marks.** Arabic uses guillemets `«...»`. English uses straight double
quotes. Never straight quotes inside Arabic text.

**Law 7.4. Numerals.** Western digits `0123456789` by default across the console in both
languages. Eastern Arabic numerals are reserved for fully Arabic institutional deliverables to
Gulf audiences, which the console is not.

**Law 7.5. Register.** Product and client-facing Arabic is fluent, simple Modern Standard
Arabic in the Gulf digital register. `«سنرسل»` not `«بنرسل»`, `«لديك»` not `«عندك»`. Khaleeji
is for conversation with Thyab, never for the interface.

**Law 7.6. Mirroring is logical, never manual.** Use `inset-inline-start`, `margin-inline`,
`padding-inline`, `text-align: start`. Never `left`, `right`, or a mirrored stylesheet. A
mirrored stylesheet is two stylesheets that will drift.

**Law 7.7. Weights drop by one step in Arabic.** Alyamama at 700 reads heavier than Lato at
700 at the same optical size. The shipped console already compensates by mapping 800 and 900
Latin weights to 600 and 700 Arabic. Preserve that mapping in every new component.

**Law 7.8. Identity fields stay LTR.** Email addresses, URLs, slugs, timestamps, and code
identifiers keep `direction: ltr` and `text-align: start` regardless of interface language.

## 8. The motion law

Motion is what makes the board feel like an application instead of a document. The full system
is in `MOTION.md`. Two principles govern it:

**Law 8.1.** Motion exists to preserve continuity, never to entertain. If a person notices the
animation itself, it is too long, too large, or too eager.

**Law 8.2.** Nothing bounces. No spring, no overshoot, no elastic easing. The console is a
work surface used by someone who may be doing this for the twentieth time today. Playfulness
that delights once irritates the nineteenth time.

## 9. The density law

**Law 9.1.** Five decided moves is a full day. The board is built for roughly three sends a
day as a sustainable professional rhythm, and it should never imply that a bigger number is a
better day.

**Law 9.2.** Never show a number without the sentence that makes it actionable. `3 stalled over
10 days` is a decision. `17%` is trivia unless something next to it says what to do about it.

**Law 9.3.** Empty is a designed state, not a missing state. Every lane, the tray, and the
board itself have written empty copy in both languages. An empty console on day one should
read as calm, not broken.

## 10. What must never happen

A checklist, so that review can be mechanical rather than a matter of taste.

- An em dash in any output: code, comments, commits, copy, documentation.
- `letter-spacing` or `text-transform: uppercase` applied to Arabic text.
- A system font anywhere in the interface.
- A new top-bar item added without an existing one being removed.
- A colour introduced without a meaning entered in the §4 table.
- An animated `width`, `height`, `top`, `left`, `margin`, or `padding`.
- A number shown without a sentence that makes it a decision.
- A lane hidden at a breakpoint.
- A stored field that duplicates something derivable.
- Two Syne moments on one screen.

## 11. The extension protocol

When a future change is proposed, run it through these gates in order. If it fails a gate,
the answer is not "override the gate", it is "find a different change".

**G1. Does it help a decision get made faster?**
If it only shows more, it belongs on a reading surface, not the board.

**G2. Does it fit the existing three weights and the existing radii?**
If it needs a new weight or a new radius, it is probably two components badly merged.

**G3. If it adds colour, what meaning does that colour take?**
Write the row into the §4 table in the same pull request, or drop the colour.

**G4. Does it hold in Arabic?**
Not "does it translate". Does the layout survive mirroring with logical properties, does the
weight mapping hold, do the numerals stay isolated, does the copy read as native Gulf MSA
rather than English wearing Arabic.

**G5. Does it survive at 390px without hiding anything?**
Scrolling is an acceptable answer. Hiding is not.

**G6. Does it store anything that could be derived?**
If yes, derive it.

**G7. Does it move a layout property?**
If yes, rebuild it with transform and opacity.

**G8. What happens on the twentieth use in one day?**
Anything that is charming once and slow forever fails here.

### Specific future cases, pre-decided

- **A new lane.** Only if a genuinely new state exists in the data, not a new filter over an
  existing one. Filters are Ring 2, not lanes. Adding a lane means adding a colour, which
  means G3 applies.
- **A new view.** It must replace a top-bar slot or live inside the board. The seven-door
  problem is exactly what this redesign fixed, and it will return by accretion if unguarded.
- **A third language.** Add it to the `I18N` object and the `dir` switch. Do not create a
  second stylesheet. If the language is RTL, §7 applies to it in full.
- **A mobile-first rebuild.** The board is already the mobile answer, scrolled horizontally.
  A separate mobile layout would be two designs to keep honest, and one of them would rot.
- **Charts.** Not on the board. Charts answer "how is it going", the board answers "what needs
  me". They belong on the Overview surface which is retained for exactly this reason.
- **Dark and light themes.** The console is dark by intent, not by fashion. It is used in the
  evening, and near-black surfaces let the lane colours carry meaning at low saturation. A
  light theme would need the entire §4 table re-derived for contrast, so it is a project, not
  a toggle.

## 12. When this document does not answer the question

Write the decision down here, in the section it belongs to, in the same pull request that
implements it. Include the reasoning, not only the rule. A rule without its reason gets
overridden by the next person who does not know why it existed.

Rules in this document may be changed. They may not be quietly ignored.
