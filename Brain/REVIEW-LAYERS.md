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

### The shell and the opportunity window (`library/console.html`)

- **Purpose.** One document, eight views, four destinations in the bar. The console stopped
  being a set of pages and became an application, which is what makes it bearable on a phone.
- **Story.** A card opens the whole opportunity in one centred window, sorted into three tabs
  because there are three questions and mixing them is what made the earlier panel hard to
  use: what is this, what am I sending, and what does the page say.
- **Truth.** The window *moves* the existing editor and composer nodes rather than copying
  them, so the document holds exactly one of each and one set of listeners. Two copies would
  mean duplicate ids and a send button belonging to whichever loaded last. Its own Details
  panel is never borrowed, so `#modalBody` is empty whenever nothing is on loan and "did it
  give everything back" stays a question with a one-line answer.
- **Craft.** Centred, not against an edge: a side panel puts what you are reading in one half
  of the screen and what you are not in the other, and on a wide screen that pushes the message
  you are about to send to the edge of your own attention. On a phone it takes the screen,
  because a floating card there wastes the only space there is. The gates measure the centring
  rather than trusting it.
- **Resilience.** Escape closes it, the scrim closes it, focus moves to the close control on
  open and returns to the card on close. The single pages still work with no window at all:
  the layer stays dormant when `#modal` is absent.

### Off-channel sending, the batch, and moving a card

- **Purpose.** Most businesses in a day's batch have no public inbox: they are reached through
  the contact form on their own site or a direct message, by hand. That send was invisible to
  the console, so the board reported nothing had gone out when something had. The Details tab
  records it.
- **Story.** A day arrives as one drop. The brief that came with the pages is read, and every
  opportunity it names appears in the first lane with its own words attached, ready to review
  one at a time before anything goes out.
- **Truth.** The console cannot witness a hand send, and it does not pretend to. It records
  what happened, through which channel, on which day, and marks the row as your confirmation
  rather than a mail-server receipt. That is real evidence of a real event, correctly
  attributed, which is the only kind the board is allowed to move on. Nothing is invented
  from a brief: a field it did not carry stays empty and is named as missing on the card.
- **Craft.** Cards move by pointer, one code path for mouse, touch and pen, with a grip a
  finger can aim at and a press-and-hold for the rest of the card. A placeholder holds the gap
  so the lane never collapses under the card being carried.
- **Resilience.** A drag can reorder and it can make a decision, but it can never declare
  something that did not happen. Dropping on Sent opens the confirmation instead of writing
  one. Opened is recorded by the page itself and cannot be set by hand at all. Draft and Live
  are decided by whether the page is published, and the console says so rather than pretending
  the gesture worked.

## The audit of the new platform

Run it: `python3 tools/audit-five-layers.py`. It walks the shell the way a person does, at
390 with a finger, at 1024 and 1440 with a pointer, in both languages. 158 assertions, one per
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
The window declared itself modal, and a pointer was correctly held out by the scrim, but Tab
walked straight out of the dialog into a board the reader could not see. Focus is trapped
inside it now, and still returns to the card on close.

**4. The gate input tracked its Arabic placeholder. (Layer 4)**
Found by the checklist in phase 6. Letter-spacing on Arabic breaks the joins. Latin only.

---

## The lane truth pass

Found in use, not by the audit, which is the honest way to record it. The live board reported
one page as Sent and three as Opened. One message had gone out to two of them and none to the
other two. Every number on the screen was wrong, and the screen looked calm.

**Layer 3, the failure.** Two separate mistakes reinforcing each other.

1. `sent_on` was read as proof of a send. It is not. It is the day the page was made, it is
   filled in on every record the manifest carries, and it is filled in before anybody has been
   written to. The board asked "does this record have a date" and called the answer a send.
2. Any page view promoted a record to Opened. A page can be opened by the person who built it,
   by a colleague, by a link pasted into a chat. Before a message goes out there is nothing for
   a prospect to have opened, so an open before the first send is a view and nothing more.

**The rule now, in one place.** `effStage` in `library/app.js` is the only authority, and both
the opens count and the send evidence can be injected into it, so the board's derivation layer
reuses the rule instead of holding a copy that drifts.

1. What you declared stands. Replied, won and lost are decisions, not derivations.
2. With no send, a record is a live page or a draft. It is never "sent".
3. With a send, it is opened if somebody read it *after* that send, otherwise sent.

Send evidence is the mail ledger, or your own declaration on the record for a message sent
elsewhere. Nothing else. `sent_on` no longer touches lane assignment anywhere.

**What was gained, not just removed.** A view of an unsent page is real information and it is
now shown as what it is: the token says "no email yet, 3 views", the library card says
"Views: 3" beside "Page made", and the campaign table carries views and opens as two columns
with two tooltips. The Insights page counts opens the same way in all four tables, so the
sentence at the top and the tables under it can never report different numbers.

**Layer 1, the second failure.** The navigation reduction left Board, Library and Settings.
Campaign performance, per-message performance and per-person response were still built and
still correct, and were reachable only from inside another screen, which is indistinguishable
from deleted. Insights is a destination in the bar again. Four is still a bar you can read.

**Layer 4, one deliberate call.** A lane is 132px wide, so the lane reads "Ready" and the
pipeline pill reads "Ready to send". Short form and long form of one name, never two names.

**Layer 5.** The send index is invalidated whenever the ledger is written, including by a sync
round, so a send moves a token immediately rather than up to three seconds later.

The audit now locks all of it: no ledger send means no Sent lane and no Opened lane, an unsent
page keeps its views, follow-up is never asked for a message that was never sent, and the
numbers are one tap from the board.

---

## The ten gates

`python3 tools/gates.py`, or one at a time: `python3 tools/gates.py 3 7`.

Five layers ask whether a screen is any good. Ten gates ask whether the thing works, in a
browser, with real data, in both languages, at the widths people hold. The layers came first
and the gates exist because things got through them.

| # | Gate | The question | What it caught |
|---|---|---|---|
| 1 | **Boot** | Does every page and every view start, with nothing blank and nothing thrown? | |
| 2 | **Doors** | Does every link lead somewhere real, and do its parameters arrive? | Every parameter-carrying link in the console |
| 3 | **Round trip** | Does the window give back what it borrows? Is a view re-entered a view reloaded? | The blank composer |
| 4 | **Truth** | Do the lanes, the pills and the tables report the same facts, and only facts with evidence? | |
| 5 | **Bilingual** | Both languages complete, no key on screen, plural forms correct at 1, 2, 3, 11, 100 | |
| 6 | **Typography** | One Latin face and one Arabic face, everywhere, measured rather than assumed | Alyamama's serif Latin |
| 7 | **Layout** | Nothing scrolls sideways, everything a finger uses clears 40px, at six widths | Two heights in one bar; "Choose files" at 33px |
| 8 | **Forms** | Is every control labelled and reachable, and does sending actually send? | 35 labels pointing at nothing |
| 9 | **Resilience** | Relay down, relay old, no data, and does a backup round trip? | |
| 10 | **Build** | The verify gate passes, the shell is what its source produces, the offline file is whole | |

Gate 6 asks Chromium which font it actually drew, through `CSS.getPlatformFontsForNode`. No
computed style would have answered it: the stack said Alyamama and the stack was being honoured.

Gate 8 ends by sending a real message through a relay that answers and remembers what it was handed, then watching the opportunity move from Ready to Sent, the quota count it, and the message it went out with become measurable. Gate 9 takes that same session, exports a backup, wipes the device and restores it. Those two are the loops the console exists for, and until now neither had been proven end to end by anything but use.

### The eight defects the gates found

**1. The panel never gave back what it borrowed. (Gate 3)**
This is the one that was reported: tap "Send an email", get a blank page. The window hosts the
composer by moving `#view-compose` into itself, which is right, and on close it moved it
nowhere, which is not. The shell skips any view the window owns, so from the first time a card
was tapped, the composer and the editor were unreachable for the rest of the session. A panel
that takes a node out of the document owes the document that node back, and it now does,
immediately when a navigation needs it rather than after the closing transition.

**2. Parameters fell down the gap between two navigation models. (Gate 2)**
Links written in `app.js` said `compose.html?slug=x` and walked the reader out of the shell into
a second document. Links written in the pages were rewritten by the build into
`#compose?slug=x`, and every reader was asking `location.search`, where nothing had been put.
Two models, and everything that travels with a parameter fell between them: "use this template",
"compose with this", Email and Edit on every library card, and both board chips. One builder
(`viewHref`), one reader (`viewParams`), one mover (`goTo`).

**3. A view already started ignored its new parameters. (Gate 3)**
Even with the parameters arriving, the shell ran a view's init once and never again, so asking
for the same view with a different opportunity did nothing. It now restarts, and restores the
view's markup from a snapshot taken at boot first, because re-running an init over a wired DOM
is how one element ends up with two of the same listener.

**4. Alyamama's Latin is a serif. (Gate 6)**
`--font-ar` began with Alyamama, and a font stack resolves per character, so every Latin word on
an Arabic screen was drawn in Alyamama's Latin: business names on the board, on their cards, in
every table, in a different typeface from the rest of the console. Lato first, Alyamama second:
Latin finds Lato, Arabic falls through. One Latin face and one Arabic face, both directions.

**5. Thirty-five labels pointed at nothing, and the bar had two heights. (Gates 7 and 8)**
Every field was written as a `<label>` beside its input rather than for it, so nothing was
announced to a screen reader and tapping a label focused nothing. And the language switch stood
36px tall next to a 33px lock, because Arabic sets a taller line box than Latin and the two
identical controls were being sized by whichever script was inside them.

**6. The control that starts a working day was 33px. (Gate 7)**
"Choose files" is how a batch enters the console, and it is a small button, and the touch-target
rule covered the bar, the chips, the tray and the cards but never the buttons. Every `.btn`
clears 44 on a coarse pointer now, and so do a card's open area, its drag grip, and the rows in
the batch review. The gate measures those four selectors as well, so the next control put on
the board is measured rather than assumed.

**7. One click on Copy wrote two ledger rows. (Gate 3)**
The window re-runs a view's init every time its tab is entered, over a DOM that init had
already wired, so every control in the composer collected a second copy of its own listener.
Copy wrote two rows. Send would have sent the same message to the same prospect twice. The
shell already resets a view to its boot markup before re-initialising it, and the window now
asks the shell to do exactly that before it hands a borrowed view back to its init, then the
shell marks the view stale so navigating to it directly still gets a fresh start. Gate 3
counts the rows one click writes, because looking at a screen cannot see a duplicate listener.

**8. A renamed function passed every static check. (Gate 2, then `tools/verify.js`)**
`initDrag` became `initBoardDrag` and one call site kept the old name. It is valid JavaScript,
so `node --check` was happy, the build succeeded, all nineteen string checks passed, and the
board threw on every load. `verify.js` now asks whether every console function called is a
console function declared, and whether every icon asked for is an icon that exists. Both were
proven by breaking them on purpose.

---

## The mirror

A console that runs on four devices is one console or it is four, and it was four.

"The ledger is the only send evidence, so a device that has not synced reads Ready rather than
Sent" was the wrong answer, and it was mine. A message that went out went out. Which device it
left from is an implementation detail of no interest to anybody, and dressing an incomplete
sync as honesty is how a defect survives a review.

Four holes, and one bug that made a fifth:

1. **Removals never travelled.** Every merge was a union or a newest-wins-by-id, so deleting an
   opportunity on the phone left it alive on the iPad, the iPad pushed it back, and it returned.
   The console overruled a decision you had made. A removal is now a fact with a timestamp that
   travels like any other, and an item comes back only if it was re-created after it was removed.
2. **A tombstone was destroyed by `|0`.** The first version of the fix stored `Date.now()` and
   filtered it with a bitwise operator. Bitwise truncates to 32 bits, and a millisecond
   timestamp has not fitted in 32 bits since 25 January 1970, so every removal was wrapped into
   garbage and then discarded as ancient. Found by the two-device test, not by reading.
3. **Page templates never synced at all.** `thrive_templates_v1` was in neither the push list
   nor the snapshot. You could upload a page template on one device and no other device would
   ever know it existed.
4. **A draft's page was stripped from the snapshot.** Sensible for a published page, which the
   repository already holds. Wrong for one that was never published, which then existed on
   exactly one device.
5. **Stock messages re-seeded themselves.** Deleting one brought it back on the next load, on
   every device.

### The contract, now written down

Everything the console holds is in exactly one of three classes, and there is no fourth.

| Class | What | How it reaches every device |
|---|---|---|
| **Mirrored** | opportunities, the mail ledger, the activity log, send stamps, message templates, page template records, publishing credentials, settings, and the removals | the shared state, complete, deletions included |
| **Published** | live pages, and a page template once published | the repository, which every device can already read |
| **Local** | the collapsed tray, the language, the relay URL, the session key | never shared, on purpose |

Page HTML is the one thing that runs to hundreds of kilobytes against a shared store measured
in hundreds of kilobytes total. So it travels while it fits, newest first, and whatever did not
fit is **named in Settings** with the way to fix it. A mirror is allowed a physical limit. It is
not allowed a quiet one.

`python3 tools/mirror.py` holds it: two devices and then a third, creating, editing, removing,
re-creating, and comparing the whole state field by field. It is gate 4.

### And the attribution behind it

The composer keeps its slug for a whole session, so fifteen monthly newsletters written in one
sitting were all filed against one prospect's page, and that page reported fifteen sends it had
never received. A message belongs to an opportunity when it carries that opportunity's link,
which is now how it is decided. Old entries are not rewritten: the console does not know which
of them carried a link, and guessing would be the same defect wearing a repair.

An open rate also printed **200%**, because unique visitors were divided by people written to.
A rate is a share of something and cannot exceed the whole.

### The ceiling, and what happens at it

The relay refuses a state over **400,000 bytes** outright, and a refused push is not a smaller
mirror, it is no mirror at all. Carrying page html made that ceiling reachable, so the console
now knows it, measures what it is about to send, and sheds in a fixed order:

1. page html, because the repository is its real home;
2. the operations log, oldest first, because it is a log and not something facts are derived from;
3. and if that is still not enough, it says so instead of pretending.

Nothing that is evidence is ever shed: the mail ledger, the opportunities, the removals, the
message templates and the vault always travel. Settings reads back how full the store is and
what was left behind, so a store filling up is a number you watch rather than a sync that stops
one morning. `tools/mirror.py` fills a console past the ceiling and checks all of it.

### Correcting what the console cannot know

Fifteen conversations were filed against one page. Going forward that is fixed, and the console
cannot know which of the old ones carried a link. Guessing would be the same defect wearing a
repair, so it hands over the correction instead: every conversation on the Activity page names
the opportunity it belongs to, and moving it rewrites every message in that conversation at
once. A decision you make, never one the console makes for you.

### The second language, enforced

The screens said, in Arabic, «كتبتَ إلى 15 أشخاص» and «فُتحت صفحاتك 2 مرة». Neither is Arabic.
The rule was written down in `library/i18n.js` the day the board was built:

> Any future string that carries a number must be added as a form object.
> A flat "{n}" template holding a count is a defect.

Nothing enforced it, so fourteen sentences outside the board quietly broke the second language:
the whole Insights story, the whole Activity story, and five notices. They are form objects now,
with the Arabic dual and the 3 to 10 and 11 to 99 forms written out, and `tools/verify.js`
refuses any new flat string carrying a count, checks EN/AR parity in the counting dictionary
too, and requires all five Arabic categories wherever English varies at all. A rule that only
lives in a comment is a wish.

Found alongside it: **`sy_local_only` was declared twice**, once by an older message and once by
mine, in the same object. The later wins, so the mirror change had silently replaced "Saved on
this device only, so the other devices were NOT updated" with a note about page sizes. Verify
now refuses a duplicate key in either dictionary.

### And the correction nobody could find

I told you to move a run of newsletters off one page, and put the control three levels deep:
Library, then More, then Activity, then expand a conversation. A correction the console asks you
for has to be where you are looking. It is on the conversation row now, visible without opening
anything, with one line above the list saying what it does.

---

## The five that were queued, now done

1. **Compose** (layer 2 and 4). At rest the screen asks four things: which message, to whom,
   what it says, send. The sender address, the template management, and the two switches wait
   behind one disclosure that counts what is on inside it, so folding never hides state.
2. **Library** (layer 1). One primary path: search, the pills, New opportunity. Sorting, the
   template filter, the status list and the exports moved behind the same disclosure, which
   carries the number of filters currently applied.
3. **Editor** (layer 5). Publishing is two writes, and between them the repository is in a state
   that is neither published nor unpublished. If the second fails, the page is live and the
   library still calls it a draft, which looks exactly like nothing happened. The halves are
   named now: the card says "live, not listed" and offers to finish rather than to start again.
4. **Templates** (layer 2). Each message carries its own sent, opens, open rate, replies and
   reply rate, beside the message, which is the only place where the comparison is a decision.
   A template nobody has sent says so instead of claiming 0%.
5. **Activity** (layer 1). The week reads as a week: one line per day saying what went out, who
   answered, what was published and how often the pages were read. The table stays underneath
   for the moment you need the exact row.

Nothing here was cosmetic. Each one names the layer that failed, so the pass can be judged
rather than admired.
