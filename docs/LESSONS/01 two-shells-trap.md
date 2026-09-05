# Two shells trap

**Symptom.** A send or transit bug is reported on the live console, but the obvious source
file (library/app.js) does not contain the UI strings the operator sees.

**Root.** The console has two independent front ends. The served default (index.html to
library/console.html) loads the modular app.js shell. A second, self-contained shell,
library/board.html (title "Thrive Board", inline JS bundled from tools/board-*.src.js by
tools/bundle.js), is what the operator actually uses. Send, stage and relay logic is
duplicated as an "L5 clone" in board-send.src.js, separate from app.js relaySend. Editing
app.js does nothing for a board.html user.

**How we proved it.** Grepped the live app.js for the exact labels on screen ("Send email",
"HOSTED PAGE", "1 failed"): zero matches. Found them all in board.html.

**Fix.** Identify which shell serves the live path before touching code. The board shell's
source is tools/board-*.src.js, bundled into library/board.html.

**Guard.** For any transit, stage or relay defect, step 0 is: grep the on-screen string
across all shells and edit the shell that serves the user. Never assume one shell.
