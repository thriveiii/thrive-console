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

**Law 3.6.** Opening an opportunity opens one centred window, never an edge panel.

It is `min(920px, 92vw)` wide, capped at `88vh`, with equal margins on all four sides, over a
dimmed and blurred backdrop. Its header and its tab strip are fixed; only its body scrolls.
Below `720px` it becomes a full height sheet on the bottom edge with the same header and the
same tabs. That is one component with two sets of values, not two components.

The tabs are Overview, Text, Page, Outreach, History. They are nouns, because a tab strip is a
place you are, and a verb reads as a button you press.

A row on 02 Tasks opens this window on the tab that matches its reason: a waiting reply opens
Outreach, a card that cannot send opens Text, a page not yet live opens Page, and an approval
or a stall opens Overview. The reason carried the operator here, so the window opens where the
work is, not at a landing tab they must then leave. See section 13.

**Law 3.7.** The window BORROWS the editor and the composer by moving their nodes into itself.
It never copies their markup, and it returns them the moment anything else needs them.

Two copies of the composer means two elements carrying the same ids and a send button belonging
to whichever loaded last. This is not theoretical: re-running a view's init over a DOM that init
had already wired gave every control in it a second listener, and one click on Copy wrote two
ledger rows. A view handed to a borrower is reset to its boot markup before its init runs again.

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
- **Object.** Tokens, cards, the opportunity window. One border, one radius, and elevation
  only while moving or while raised by interaction.
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
- **A surface that grows a second tab.** Ask what it has become. An edge panel is for one
  action; a centred window is for a workspace. This is the rule the opportunity drawer produced
  on 2 August 2026, and the reason is worth keeping: the drawer was correct when opening an
  opportunity meant one action, because an edge panel sits close to the card you came from and
  leaves the board visible. Once the view carried several tabs it was a workspace, and a 580px
  column pinned to the edge of a 1440px screen pushes the eye sideways while the board sits idle
  behind it. The failure compounds: the column cannot widen without becoming the screen, and the
  content cannot narrow without becoming a phone layout on a desktop. Do not wait for the third
  tab to notice.
- **Dark and light themes.** The console is dark by intent, not by fashion. It is used in the
  evening, and near-black surfaces let the lane colours carry meaning at low saturation. A
  light theme would need the entire §4 table re-derived for contrast, so it is a project, not
  a toggle.

## 12. When this document does not answer the question

Write the decision down here, in the section it belongs to, in the same pull request that
implements it. Include the reasoning, not only the rule. A rule without its reason gets
overridden by the next person who does not know why it existed.

Rules in this document may be changed. They may not be quietly ignored.


## 13. Three surfaces and one window

Written under the section 12 protocol: the decision with its reasoning, in the same pull request
that implements it. Nothing here overrides a law; every law is cited where it binds.

Author: Claude for Thyab. Date: September 2, 2026. Status: settled. Decisions A and B are closed
(section 11).

### 0. The one sentence

The console has exactly three surfaces and one window. A surface answers one question. The window
is where an opportunity is worked, and it opens from any surface without leaving it.

- **01 Operations and Access** answers: where is everything, and who may act on it. The ruling surface.
- **02 Tasks** answers: what needs me now. The deciding surface.
- **03 Library** answers: what do I have, and what did I do. The reading surface.
- **The window** (law 3.6) is the workspace for one opportunity: Overview, Text, Page, Outreach, History, Discussion.

Anything that is not one of these is a section inside one of them, or an item in the demoted account
menu. A fourth surface requires rewriting section 2 diagnosis 1, and that is the guard.

### 1. Why three is the cure of seven, not its return

Section 2 names the disease precisely: seven destinations of **equal weight**, configuration beside
daily work as an equal, and every action a view change that reset context. The disease was flatness
and accretion, not the number.

Three surfaces cure it because they are not equal:

| Surface | Weight | Kind | Question | Configuration allowed? |
|---|---|---|---|---|
| 01 Operations and Access | primary | ruling | where is everything, who may act | no |
| 02 Tasks | primary, badged | deciding | what needs me now | no |
| 03 Library | secondary | reading | what do I have, what did I do | no |
| account menu | demoted | configuration | Profile, Admin, Sign out | yes, only here |

Law 3.5 already grants a second surface for the question the board is weak at. Law 3.6 already defines
the window. This section names the whole set and closes it.

Context never breaks (diagnosis 4): switching surfaces is a crossfade of opacity and transform (law 8,
gate G7), each surface keeps its scroll position, and the window opens over whichever surface you are
on and returns you to it. The URL hash carries the surface (`#ops`, `#tasks`, `#library`) so refresh,
back, and a deep link land where you were.

### 2. The data every surface reads (one store, three projections)

There is one truth and three views of it. No surface stores anything of its own (law 3.4, gate G6).

| Truth | Source | Read by |
|---|---|---|
| Opportunities and their lane | `console_board` (server-derived from `console_opps`) | 01 board, 02 queue, 03 archive |
| Sends | `console_mail` (written by the relay on Resend acceptance; the browser merges by the same Resend id) | 01 quota and feed, 02 queue, window Outreach and History |
| Replies and bounces | `console_inbound` (relay inbox scan) | 01 feed, 02 queue, window History |
| Opens | `console_hits` (relay pixel and beacon, self views excluded) | window History, 01 feed |
| People and roles | `console_members` | 01 Access, action gating everywhere |
| Templates | the kit templates in the repo, usage derived from `console_opps` | 03 Library |
| Actor of an action | `console_mail.actor`, `console_opps.created_by`, the activity log | every signed row |

Tasks is a filter and a sort over this store. The archive is the `archived` flag over the same
opportunities. Access is `console_members`. None of them is a new lane (section 11, "a new lane only
for a genuinely new state"); they are Ring 2 projections, which is exactly what section 11 says a
filter is.

### 3. Surface 01, Operations and Access

**Question.** Where is everything, and who may act on it.

**Layout, top to bottom.**

1. **The ruling strip.** One line of today's numbers that are decisions, not reports: sends today of
   100, sends this month of 1000, replies waiting, stalled. Each number is a link into 02 Tasks
   filtered to that reason. This is the answer to diagnosis 2: the home rules. It is small, and it is
   the only reporting on this surface.
2. **The board.** Unchanged in law: lanes Under Review, Live, Sent, Opened, Replied; horizontal
   position is state (law 3.1); no lane hidden, the board scrolls horizontally on narrow screens
   (law 3.2); won and lost in the collapsed tray (law 3.3). Two primary actions live here and nowhere
   in the top bar: **Upload** and **New message**, the crowning gradient (law 4.2, one primary action
   per screen, so Upload is primary and New message is secondary weight).
3. **Access.** The people and their reach: each member with role and what the role may do (owner:
   approve, publish, archive, delete; member: upload, activate, write, request approval), and their
   count of actions today. This is where the approval gate becomes visible as policy, not as a
   surprise on a button.
4. **The signed operations feed.** The last actions across the pipeline, each with its actor and its
   opportunity, as prose rows that wrap at spaces. This is the accountability trail: no operation is
   anonymous.

**Every card is signed.** The actor appears on the card as an avatar initial and a name. Colour is not
used for the actor (see section 6, the colour decision); position and the lane carry state, the
signature carries who.

**Why Access lives here and not in Admin.** Access is not configuration, it is the daily fact of who is
allowed to move what. Putting it beside the board makes the gate legible before it is enforced.
Editing roles stays in Admin (the account menu), which is configuration.

### 4. Surface 02, Tasks

**Question.** What needs me now.

**The queue, derived and ordered by cost of delay.**

| Priority | Reason | Derived from | Primary action |
|---|---|---|---|
| 1 | Reply waiting | Replied lane, reply not yet answered | Reply (window, Outreach) |
| 2 | Approval requested | member requested, owner not yet approved | Approve or return (window, Overview) |
| 3 | Cannot send | recipient or subject missing on a Ready card | Fix (window, Text) |
| 4 | Stalled | idle beyond `--stall-days` | Follow up or archive (window) |
| 5 | Awaiting activation | draft uploaded, page not live | Activate (window, Page) |

**Role-aware, same data.** The owner's queue is approvals, replies, stalled across everything. A
member's queue is their own drafts needing a recipient or activation, and replies on cards they
operate. Same rows, filtered by role and ownership. This is law 3.4 in practice: the queue is never
stored, so it can never disagree with the board.

**Each row.** Business, the reason in one phrase, the actor who created it, the age, one primary
action. Selecting a row opens the window on the tab that matches the reason (Reply opens Outreach,
Fix opens Text, Activate opens Page). Completing the action changes state, and the row disappears
because it was derived; nothing is marked done.

**Badge.** The Tasks segment in the top bar carries the queue count. It is the only badge in the top
bar, so it is readable (law 4.1's logic applied to attention).

**Empty state.** One sentence: nothing needs you. Diagnosis 2 again: the surface rules; it does not
fill silence with reports.

**Why a surface and not a lane.** A lane is a state. Needs-me cuts across states. Section 11 calls that
a filter, Ring 2, and a filter with its own question and its own order is a surface.

### 5. Surface 03, Library

**Question.** What do I have, and what did I do.

Two sub-views under one control, never mixed, because templates are things you use again and the
archive is things you did.

**Templates.** Each kit template (en-opp1, ar-opp1, later offer-v1) as a card: name, language and
direction, a live thumbnail preview, usage count derived from `console_opps`, and three actions:
Preview (a wide in-place preview), Open full (the standalone page in a new tab), Use (starts Upload
with that template). The owner adds and retires templates; members use them.

**Operations archive.** The finished work, promoted from the collapsed tray (law 3.3) into a surface
that can be read: won, lost, archived, bounced. A dense list (law 9), searchable by business, person,
outcome, and date. Each row: business, operated by (actor), outcome (replied, no reply, bounced,
archived), signals (sends, opens, replies), closed date. Opening a row opens the window read-only on
History. Restore is the one write allowed here (it un-archives, which returns the card to the board;
it is an operation, so it is signed).

**Reading, not deciding.** No sends from the Library. If a row needs a decision it belongs to Tasks,
and Tasks will already have it, because both are derived from the same truth.

### 6. The three together: the spine, and the two decisions

**The spine is the window.** From 01 (a card), from 02 (a row), from 03 (an archive row), the same
window opens: law 3.6's centred window, law 3.7's borrowed editor and composer, tabs Overview, Text,
Page, Outreach, History, Discussion. Reply first when a reply is waiting, quoted history folded, a wide page
preview with Open full page, realistic email render, role-gated actions (owner: Send, Approve,
Archive, Delete; member: Activate, Request approval, Add justification, Archive), and a signed
activity line. One component, opened from three doors, closing back to the door you used, at the
scroll you left.

**The sixth tab, Discussion.** Discussion is the team's own conversation about an opportunity, kept
apart from Outreach and from History. Outreach is the exchange with the recipient; History is the
signed record of what was done; Discussion is where the people working the card talk to each other.
It is the home of a member's justification for a send and the owner's response to it: the reasoning
the approval gate turns on lives with the card, in the open, and is never lost to a channel
elsewhere. It carries no send and no external address; it is internal by construction, and like
every other tab its lines are signed with their actor.

**One action, three views move.** The owner approves in the window: the card moves to Ready on 01, the
approval row leaves 02, nothing changes on 03. The owner archives: the card leaves 01, any row leaves
02, the archive on 03 gains a row. This happens because every view derives from one store, not because
views message each other.

**The top bar collapses.** Logo, the segmented three (01, 02, 03) with a sliding indicator and the
Tasks badge, the quota pill, the language switch, and the account menu (Profile, Admin, Sign out).
Seven equal doors become three weighted surfaces and one demoted menu. Upload and New message move
onto 01 as actions, not doors.

**Decision A, actor colour: A1.** No actor colour. The signature is an avatar initial and a name. Law
4.1 forbids a colour without a meaning, and the three proposed hues collided with the lane table (teal
is Draft, violet is Sent, coral is near Opened). Colour stays with state, so it stays readable
everywhere (law 4.1, 4.4).

**Decision B, where performance lives: on 01.** Law 3.5 keeps "how is the messaging performing" off the
board. Today's four numbers live in the ruling strip on 01 (decisions), and a collapsed Performance
section at the bottom of 01 carries the charts (reading, opened on demand, never crowding the board).
A fourth surface for it is not needed and would be diagnosis 1 returning.

### 7. Visual logic, entirely on the existing tokens

No second stylesheet (section 11). Everything maps to `styles.css`.

| Element | Token or law |
|---|---|
| Surfaces | `--bg`, `--panel`, `--panel-2` (law 4.5) |
| Lane colour on tokens and reason chips | `--lane-draft`, `--lane-live`, `--lane-sent`, `--lane-opened`, `--lane-replied`, `--state-stall` (section 4 table) |
| Segmented control | `--panel-2` track, `--panel` indicator, three weights only (law 5), existing radii (gate G2) |
| Crossfade between surfaces | `--t-base` with `--e-standard`, opacity and transform only (law 8, gate G7) |
| The window | law 3.6 verbatim: `min(920px, 92vw)`, `88vh`, fixed header and tab strip, bottom sheet below 720px |
| Type | `--font` and `--font-ar`, the weight map that steps down in Arabic (`html[dir="rtl"]`), `--fs-*` scale |
| Numerals | Western, isolated, `--font-lat`; never Eastern (law 7) |
| Direction | `--dir` and logical properties only; the segmented control mirrors; directional glyphs flip (law 7, gate G4) |
| Density | law 9; the archive is a dense list, Tasks is a list, the board is the board |
| Primary action | the gradient on Upload only, per screen (law 4.2) |

Card signatures use no new colour; reason chips in Tasks use the lane colour of the state they point
to, so a "reply waiting" chip is `--lane-replied` green and a "stalled" chip is `--state-stall` amber,
which means the chips are already readable by a user who knows the board. Nothing new to learn (law 4.3).

Side strips on cards are retired everywhere. State is position (law 3.1), so a coloured edge was
redundant on the board and is forbidden as a device.

### 8. Closing every gap, through the section 11 gates

- **G1, faster decisions.** 02 exists for exactly this; 01's ruling strip links into it; the window
  opens on the tab the reason needs. Pass.
- **G2, weights and radii.** Nothing new. Pass.
- **G3, colour.** No new colour under A1. Pass.
- **G4, Arabic.** Logical properties, `--dir`, mirrored control, weight map, isolated numerals, Gulf
  MSA copy («سنرسل» not «بنرسل»). Pass.
- **G5, 390px, nothing hidden.** 01 scrolls the board horizontally (law 3.2); 02 is a list; 03 stacks
  to one column; the window is a bottom sheet (law 3.6). Nothing hidden, scrolling is the answer. Pass.
- **G6, derived, never stored.** Queue, archive, counts, badge, access reach: all derived. Pass.
- **G7, transform and opacity.** Crossfade, indicator slide, window rise. Pass.
- **G8, the twentieth use.** A crossfade is instant, the window is one component, the queue is a list.
  Nothing charming once and slow forever. Pass.
- **The relapse guard.** Three surfaces, one window, anything else is a section or a menu item; a
  fourth surface requires rewriting diagnosis 1.
- **The seven-door residue.** New message and Upload become actions on 01. Library becomes 03. Admin,
  Profile, Sign out go to the account menu. Refresh becomes automatic (the store already syncs) or an
  item in the menu. The top bar is done.

### 9. What is built, in order

1. **The window** (law 3.6 and 3.7). The centred window with the six tabs; borrowed editor and
   composer; reply-first Outreach; wide Page preview with Open full; role-gated actions.
2. **The top bar and the segmented three.** Seven doors to three surfaces plus the account menu;
   Upload and New message onto 01; the Tasks badge; the URL hash.
3. **02 Tasks.** The derived queue, role-aware, opening the window on the matching tab.
4. **01 Access and the signed feed.** Members, roles, reach; the operations feed; signatures on cards.
5. **03 Library.** Templates with preview and Use; the operations archive with search and Restore.
6. **The ruling strip and the collapsed Performance section on 01** (Decision B).

Each is one PR, one concern, on the existing tokens, both languages together, the Arabic gate run on
device.

### 10. Decisions, settled September 2, 2026

- **A. Actor colour: A1.** No actor colour. The signature is an avatar initial and a name (law 4.1, 4.4).
- **B. Performance: on 01.** The ruling strip for today's four numbers, a collapsed Performance section
  for charts. No fourth surface (law 3.5, section 2 diagnosis 1).

Changes to this section follow section 12: written down, with the reasoning, in the pull request that
makes them.
