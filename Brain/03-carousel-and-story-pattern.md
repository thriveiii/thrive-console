# THRIVE · Carousel & Story Pattern Reference

**Version**: 1.0
**Date**: May 2026
**Purpose**: Master reference for designing Instagram carousels, posts, and stories for Thrive Digital Solutions. Any session opening this file should be able to produce production-grade posts on the first pass without rebuilding from scratch.

-----

## 0. How To Use This File

This is a **living reference**, not a tutorial. Open it at the start of any design session. The structure follows the order of decisions a session needs to make:

1. **Format & size** → §1
1. **Brand truth** → §2
1. **Identity vs chrome distinction** → §3
1. **Typography system** → §4
1. **Color system** → §5
1. **Narrative architectures (the templates)** → §6
1. **Visual motifs (the textures)** → §7
1. **Slide-by-slide construction** → §8
1. **Caption writing** → §9
1. **The technical foundation (CSS, rendering)** → §10
1. **Future patterns / open questions** → §11

When in doubt, default to §2 (brand truth). Everything else serves it.

-----

## 1. Formats & Sizes

|Format                  |Pixels         |Ratio|Notes                                  |
|------------------------|---------------|-----|---------------------------------------|
|Instagram post (default)|1080 × 1350    |4:5  |Always ask if not specified            |
|Instagram square        |1080 × 1080    |1:1  |Avoid unless asked                     |
|Stories                 |1080 × 1920    |9:16 |Whole vertical canvas                  |
|Reels cover             |1080 × 1920    |9:16 |Same as stories                        |
|Carousel                |1080 × 1350 × N|4:5  |3–4 slides preferred, never more than 6|

**Render at 2× scale** (e.g., 2160 × 2700 for a 4:5) for Retina sharpness.

**Default carousel length**: 3 slides. Use 4 only when the narrative genuinely needs the fourth beat. Never pad. Never use 4 slides when 3 deliver the idea.

-----

## 2. Brand Truth (Non-Negotiable)

These are the philosophical anchors. Every design decision answers to them.

### Voice of the brand

- **Reserved, intelligent, understated**. No marketing-aggressive language. No “AMAZING!” energy.
- **Calm confidence**. The brand does not need to shout because the work speaks.
- **Honest, never performative**. If a sentence sounds like a slogan, cut it.

### What Thrive is NOT

- ❌ Thrive does not replace humans with AI. We empower humans through tools. Any messaging that frames AI as “team replacement” or “headcount reduction” violates the brand’s soul.
- ❌ Thrive is not a roboticized agency. The teams are real, the work is human.
- ❌ Thrive is not a generic agency selling “services.” It is an operating system for serious operators.

### What Thrive IS

- ✅ AI extends human capability, removes friction, gives humans time for the thinking work that matters.
- ✅ Bilingual by design. English and Arabic at native level.
- ✅ Built for the long arc, not the launch week. Month after month.
- ✅ A studio that intervenes where most others stop: at strategy, not at idea.

### Absolute writing rules

- **Never use em dash** (—) in any output, any language, any artifact. Use commas, periods, parentheses, or colons. The en dash (–) is allowed sparingly.
- **English quotation marks**: straight double quotes `"..."` only. No curly/smart quotes in source. (Instagram may auto-convert in caption editor; that’s beyond our control.)
- **Arabic quotation marks**: Arabic guillemets `«...»` only. Never `"..."` in Arabic text.
- **Numerals**: Western Arabic (1, 2, 3) regardless of language. Never ١، ٢، ٣ in deliverables.

-----

## 3. Identity vs Chrome (The Critical Distinction)

This was the hardest lesson of the design system. Internalize it.

**Identity elements** signal who made this. They must always be present:

- Space-atmosphere background (`#07070b` + a single colored orb per slide)
- Asterisk signature in bottom-right corner (the 12-point asterisk logo, dim, small)
- Architectural number in bottom-left (oversized Syne, with a colored dot)
- Progress bar at top (hairline + colored segment that grows across slides)
- Subtle grain layer over everything

**Chrome elements** explain how to use this. They are forbidden:

- Magazine masthead (“Field Notes / Vol. 02”) — looks like a website header
- Side trail / index of all slide titles — feels like UI navigation
- “Swipe →” / “Keep going →” / “It gets sharper →” prompts — the user knows how to swipe
- Logo + handle + slide number repeated in every corner — clutter

**The test**: If you can remove the element and the post still signals “Thrive,” it’s chrome. Cut it. If removing it makes the post anonymous, it’s identity. Keep it.

-----

## 4. Typography System

### Fonts

- **Display / Headlines**: Syne (weights 600, 700, 800). The brand’s signature voice in type.
- **Body / Annotations**: Lato (weights 300, 400, 700, 900). Quiet, classical, legible.
- **Arabic** (when needed): itfGhroob (Regular, Medium, Bold). Same role as Syne in English.
- **Never use**: Inter, Roboto, Arial, system fonts, or Plus Jakarta Sans (despite the website using it). Lato + Syne is the post system.

### Hierarchy

|Element                 |Font|Weight |Size (4:5)|Letter-spacing|Line-height|
|------------------------|----|-------|----------|--------------|-----------|
|Hero word (centered)    |Syne|800    |180–200px |-0.055em      |0.9–0.95   |
|Hero word (left-aligned)|Syne|800    |175–200px |-0.055em      |0.9        |
|Verdict line            |Syne|600    |32–36px   |-0.018em      |1.25       |
|Architectural number    |Syne|800    |84–96px   |-0.05em       |1.0        |
|Annotation kicker       |Lato|700    |11–14px   |0.32–0.42em   |n/a        |
|Body paragraph          |Lato|300/400|18–22px   |0.005em       |1.45–1.55  |
|Footnote                |Lato|700    |10–12px   |0.3em         |n/a        |

### Type rules

- **Same role = same style**. All big words use one system. All annotations use another. Don’t randomly mix sizes “for variety.”
- **Variation must be intentional**. If you make one word smaller or change its color, it must serve the meaning (a strike-through, a reveal, an emphasis). Never decorative.
- **Left-aligned is default**. Centered alignment makes posts feel like advertising posters. Left alignment makes them feel like edited pages.
- **Negative space is a layer, not a void**. When the headline is on the left, the right side hosts the visual motif. Treat it as canvas, not as “empty.”

-----

## 5. Color System

### The palette (locked)

|Token           |Hex                     |Role                                                                    |
|----------------|------------------------|------------------------------------------------------------------------|
|`--bg`          |`#07070b`               |Background. Not pure black — has 7-unit warmth toward the deep blue end.|
|`--ink`         |`#f4f4f6`               |Primary text. Not pure white — softens the bg-fg contrast.              |
|`--muted`       |`#6e6e76`               |Secondary text. Gray with cool tint.                                    |
|`--hairline`    |`rgba(255,255,255,0.10)`|Dividers, borders, rules.                                               |
|`--c-cyan-light`|`#72BECE`               |Brand accent (cool)                                                     |
|`--c-blue-muted`|`#5D7FB7`               |Brand accent (deep)                                                     |
|`--c-pink-soft` |`#EE8C9D`               |Brand accent (warm)                                                     |
|`--c-purple`    |`#9685CA`               |Brand accent (electric)                                                 |
|`--c-teal`      |`#71BFCC`               |Brand accent (calm)                                                     |
|`--c-mauve`     |`#A78CA7`               |Brand accent (muted warm)                                               |

### Color discipline (most important)

1. **One accent color per slide**, never the full gradient as decoration.
1. **The full gradient is sacred**. It appears only at *crowning moments* — usually the final slide’s hero word, or rarely as a celebration text-fill on a single transformative word. Used twice or more in one carousel, it loses meaning.
1. **Across a carousel**, the per-slide accent should follow a logical color progression. Examples:
- Cool warming up: mauve → purple → blue → cyan
- Warm cooling down: pink → mauve → purple → blue
- Match the narrative arc, not random.
1. **The orb (background atmosphere)** uses the slide’s accent at low opacity (0.10–0.20). Position it asymmetrically — top-right on slide 1, bottom-left on slide 2, etc., so the eye moves across slides.

### Gradient definition

```css
--brand-gradient: linear-gradient(120deg,
  var(--c-cyan-light), var(--c-blue-muted), var(--c-purple),
  var(--c-pink-soft), var(--c-mauve), var(--c-teal));
```

Apply via `background-clip: text` for gradient-filled type.

-----

## 6. Narrative Architectures (Templates)

Three proven structures. Each carousel should fit one of these — or extend the library with a documented new one.

### 6A. Resolution Sequence

**Mechanic**: A word resolves from blur to sharp across slides. The reader’s finger keeps moving because they want to see the word clearly.

**Use when**: Comparing concepts in a hierarchy (Idea → Vision → Plan → Strategy), or showing transformation (Confusion → Clarity), or progressive reveal (Question → Hint → Answer).

**Pattern**:

- Slide 1: blur 11–14px, opacity 0.72–0.78
- Slide 2: blur 3–5px, opacity 0.86–0.95
- Slide 3 (final): blur 0, full clarity, often with gradient fill or echo trail

**Built example**: The 3-slide “Resolution Sequence” — Idea / Plan / Strategy, with Strategy on slide 3 showing ghost echoes of Idea/Vision/Plan behind it and a colored path connecting them.

### 6B. Hook-Myth-Truth-Payoff

**Mechanic**: Curiosity gap. Slide 1 makes an assumption. Slide 2 shows the lie. Slide 3 reveals the truth. Slide 4 delivers the consequence.

**Use when**: Challenging a common belief, reframing how the reader thinks about something.

**Pattern**:

- Slide 1: An assumption stated boldly (“You think you’re hiring an agency.”)
- Slide 2: The myth most people believe (“Better work needs a bigger team.”)
- Slide 3: The truth (the brand’s perspective)
- Slide 4: The payoff (what this means for the reader)

### 6C. The Iceberg

**Mechanic**: A visual line drops lower with each slide, revealing more of what was hidden beneath.

**Use when**: Showing the depth behind something (a price, a piece of work, a decision).

**Pattern**:

- Slide 1: Surface (“What you see”) — a small visible element above a horizon line
- Slide 2: Layer 1 (“What it took”) — the line drops, hours/research appear
- Slide 3: Layer 2 (“What stands behind it”) — deeper layers
- Slide 4: Full iceberg (“You hire the tip. The mountain comes with it.”)

### 6D. The Translation

**Mechanic**: A common phrase, then its honest translation. Light comedy with bite.

**Use when**: Building personality and shareability. High virality potential.

**Pattern**:

- Slides 1–3: A meeting phrase (“Let’s circle back”) and its real meaning
- Slide 4: The brand’s contrasting position (“We say what we mean.”)

### 6E. The Convergence (advanced)

**Mechanic**: The final slide collapses the whole journey into a single image. Uses echo/ghost trails to show “where we’ve been.”

**Use when**: The narrative has clear stages and the closing thought needs the prior slides to make sense.

**Pattern**:

- Slides 1–N-1: One concept per slide, each with its own motif
- Final slide: The crowning concept in foreground (full gradient, full clarity), with the prior concepts visible as ghost echoes behind it (decreasing opacity, increasing blur), connected by a traced path

This is the technique used in the “Resolution Sequence” final slide.

-----

## 7. Visual Motifs Library

Each motif is a metaphor rendered as a background texture. Lives on the side opposite to the text (usually right side, when text is left-aligned). Drawn in SVG. Must be **clearly visible** but never dominate.

### Idea motif → Drifting sparks

Random scattered glowing points, varied sizes. Says: unstable, flickering, undefined, fragmented.

```svg
<radialGradient id="spark"><stop offset="0%" stop-color="ACCENT" stop-opacity="0.9"/><stop offset="100%" stop-opacity="0"/></radialGradient>
<!-- 12–15 circles, mixed r=2–6, mixed opacity 0.4–0.9, in the right-side area -->
```

### Vision motif → Horizon line

Solid horizontal line with 3 receding parallel lines fading upward. A bright point on the main line = the destination.

```svg
<line x1="500" y1="1100" x2="1060" y2="1100" stroke="ACCENT" opacity="0.55" stroke-width="2"/>
<line x1="580" y1="1010" stroke="ACCENT" opacity="0.35"/>
<!-- ...3 more receding lines, decreasing opacity 0.35 → 0.22 → 0.13 -->
<circle cx="850" cy="1100" r="6" fill="#fff"/> <!-- the destination -->
```

### Plan motif → Geometric grid

Right-side grid (5 vertical × 9 horizontal lines) with 5 intersection points highlighted. One bright center milestone.

```svg
<g stroke="ACCENT" stroke-width="1" opacity="0.32">
  <!-- 5 verticals × 9 horizontals -->
</g>
<g fill="ACCENT"><circle/></g> <!-- intersection points -->
<circle cx="870" cy="570" r="6" fill="#fff"/> <!-- key milestone -->
```

### Strategy / Decision motif → Branching path

Three paths from one origin point. One bright (chosen), two dashed/faint (rejected).

```svg
<circle cx="200" cy="1140" r="6" fill="#fff"/> <!-- origin -->
<path d="M 206 1140 Q 500 1130, 1000 1100" stroke="ACCENT" stroke-width="2.2"/> <!-- chosen -->
<path d="M 206 1138 ..." stroke="ACCENT" stroke-dasharray="4 8"/> <!-- rejected up -->
<path d="M 206 1142 ..." stroke="ACCENT" stroke-dasharray="4 8"/> <!-- rejected down -->
<circle cx="1000" cy="1100" r="5" fill="#fff"/> <!-- destination -->
```

### Network / System motif → Connected nodes

Six colored nodes around a central white core, with thin colored threads from center to each node. Used for showing systems, teams, or networks of intelligence.

### Iceberg motif → Horizon with depth

A horizontal divider line. Above it: a small visible element. Below it: layers fading darker into depth.

### Echo / Ghost trail motif → Layered history

Multiple copies of a word or shape, each one farther = smaller, fainter, more blurred. Used on convergence slides to show “where we’ve been.”

```css
.ghost-far { font-size: 56px; opacity: 0.10; filter: blur(6px); }
.ghost-mid { font-size: 76px; opacity: 0.14; filter: blur(4px); }
.ghost-close { font-size: 100px; opacity: 0.20; filter: blur(2.5px); }
.foreground { font-size: 148px; opacity: 1; filter: blur(0); /* + gradient */ }
```

### When to invent a new motif

When the concept doesn’t fit any of the above. Document it here when used. New motifs should:

- Use ≤3 SVG primitives (circles, lines, paths)
- Reuse the slide’s accent color and white as the only fills
- Live in the negative space, not over the text
- Have one “brighter point” that draws the eye

-----

## 8. Slide-by-Slide Construction

### Layout zones (4:5)

```
┌────────────────────────────────────────┐
│  [progress bar]                        │ <- top: pad-y (84px from top)
│                                        │
│                                        │
│                          [motif zone]  │ <- right side, behind/aside text
│  [headline word]                       │
│                                        │
│  [verdict line]                        │
│                                        │
│                                        │
│  [01.]              [asterisk sig]     │ <- bottom: pad-y (84px)
└────────────────────────────────────────┘
   ↑ 84px padding-x on both sides
```

### The fixed elements (every slide)

1. **Top progress bar** at `y = pad-y` (84px), 1px hairline base, accent-colored growing segment, percentage label below at the segment’s end.
1. **Motif SVG** filling the slide (`inset: 0`), drawn first, sitting at z-index 1. The text overlays on top.
1. **Stage** containing word + verdict, left-aligned, vertically centered, z-index 3.
1. **Architectural number** bottom-left: Syne 800, 96px, with accent-colored dot after the digit, followed by “/ 03” in Lato 12px muted.
1. **Asterisk signature** bottom-right: 38×38px, the 12-point asterisk logo (transparent PNG).

### The headline

- Left-aligned, large (175–200px for the hero word)
- Syne 800
- Apply blur progression if using Resolution Sequence
- The next slide’s headline should follow the same visual axis (same baseline if possible)

### The verdict

- One line, maximum two
- Syne 600, 32–36px
- “Where X people Y.” format works well: states a behavior pattern of a group
- Highlight one keyword with the accent color
- This is the line the reader actually remembers — write it last, and ruthlessly

### The final slide

This is the slide that earns the journey. It must satisfy one of:

- **Convergence**: Bring all prior elements together visually (the echo trail technique)
- **Reveal**: The thought that was impossible to say before, now lands with weight
- **Position**: Where the brand quietly steps in (“That is where we usually come in.”)

**Test**: If slides 1 to N-1 are removed, does the final slide still make sense? If yes, it’s a poster, not a final slide. Rebuild it. The final slide must depend on the journey.

-----

## 9. Caption Writing

Captions are the **fifth slide** that lives outside the visual. They have three jobs:

1. Receive the reader who arrived from the final slide
1. Add a dimension the carousel didn’t say
1. Open a conversation without sales pressure

### Anatomy

```
[Opening sentence — describes a scene the reader recognizes]

[Middle — names the tension or problem]

[Position — where Thrive quietly stands relative to that tension]

—

@thriveiii
```

3 to 5 short paragraphs. No hashtags in the body. Hashtags (max 3) go in a first comment beneath the post, never in the caption itself.

### Three voices to choose from

**Philosophical**: Builds a scene, then quietly inserts the brand. Best for serious topics, B2B audiences.

> *“Most of the meetings we sit in begin and end at ‘idea.’ Someone says ‘we need a vision.’ The room nods. Then everyone goes back to their inbox. Strategy is rare because it asks a harder question: not what we’ll do, but why this and not something else. That’s the work, and that’s where we usually come in.”*

**Question-bridge**: Opens with a question, normalizes a problem, points toward the solution without naming it.

> *“Where do most of your meetings end? If they end at ‘great idea, let’s circle back,’ that’s normal. It’s also where the work doesn’t get done. The question isn’t whether you have ideas. The question is whether you have a reason to choose one over the others. That reason has a name.”*

**Editor’s note**: Concise, almost journalistic. A series of declaratives.

> *“Idea is cheap. Vision is borrowed. Plan is honest work. Strategy is the only one of the four that asks: why this, and not the other three? If you’ve been stuck at one of the first three for too long, that’s usually a signal. Not of failure, but of needing the fourth.”*

### Caption rules

- Straight quotes only `"..."` in the source
- No em dashes — use commas, periods, parentheses
- “Usually” is more brand-true than “always”
- Don’t close with a question unless it’s strategic (asking opens dialogue, but only if you’ll answer)
- Sign with `@thriveiii` on its own line, sometimes after a `—` separator

-----

## 10. Technical Foundation

### Working directory layout

```
/home/claude/[project]/
├── carousel.html              # The slide deck (all slides in one HTML file)
├── fonts_inline.css           # Base64-embedded fonts
├── thrive_logo_transparent.png # The asterisk signature (transparent PNG)
└── render.py                  # Playwright screenshot script
```

### Font embedding (critical)

Network access is restricted; Google Fonts is blocked. Fonts must be embedded as base64 in CSS. The font files come from npm packages `@fontsource/syne` and `@fontsource/lato`. Build `fonts_inline.css` with `@font-face` rules using `src: url(data:font/woff2;base64,...)`.

### Rendering script template

```python
import asyncio, base64
from pathlib import Path
from playwright.async_api import async_playwright

WORK_DIR = Path("/home/claude/[project]")
HTML_FILE = WORK_DIR / "carousel.html"
FONT_CSS = WORK_DIR / "fonts_inline.css"
LOGO = WORK_DIR / "thrive_logo_transparent.png"

# Inline logo as data URI
logo_b64 = base64.b64encode(LOGO.read_bytes()).decode()
logo_data_uri = f"data:image/png;base64,{logo_b64}"

html = HTML_FILE.read_text()
html = html.replace("url('thrive_logo_transparent.png')", f"url('{logo_data_uri}')")
# Inline fonts CSS
html = html.replace('<link rel="stylesheet" href="fonts_inline.css">',
                    f"<style>{FONT_CSS.read_text()}</style>")
inline = WORK_DIR / "carousel_inline.html"
inline.write_text(html)

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        # CHANGE viewport for size: 1080×1350 for 4:5, 1080×1920 for stories
        context = await browser.new_context(
            viewport={"width": 1080, "height": 1350},
            device_scale_factor=2,
        )
        page = await context.new_page()
        await page.goto(f"file://{inline.resolve()}")
        await page.wait_for_load_state("networkidle")
        # Force font load before screenshot
        await page.evaluate("""async () => {
            await document.fonts.ready;
            await Promise.all([
                document.fonts.load('800 200px Syne'),
                document.fonts.load('700 30px Syne'),
                document.fonts.load('600 36px Syne'),
                document.fonts.load('300 18px Lato'),
                document.fonts.load('700 12px Lato'),
            ]);
        }""")
        await page.wait_for_timeout(2500)
        # CHANGE the range to match slide count
        for i in range(1, 4):
            slide = page.locator(f".s{i}")
            await slide.scroll_into_view_if_needed()
            await page.wait_for_timeout(500)
            out = WORK_DIR / f"slide_{i}.png"
            await slide.screenshot(path=str(out))
            print(f"Saved {out}")
        await browser.close()

asyncio.run(main())
```

### Removing white background from logo PNG

If logo.PNG has a white background, strip it:

```python
from PIL import Image
img = Image.open('logo.PNG').convert('RGBA')
data = []
for px in img.getdata():
    if px[0] > 235 and px[1] > 235 and px[2] > 235:
        data.append((255, 255, 255, 0))
    else:
        data.append(px)
img.putdata(data)
img.save('thrive_logo_transparent.png')
```

### Complete HTML/CSS scaffold (copy-paste, edit per project)

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Thrive · [Project Name]</title>
<link rel="stylesheet" href="fonts_inline.css">
<style>
  :root {
    --bg: #07070b;
    --ink: #f4f4f6;
    --muted: #6e6e76;
    --hairline: rgba(255,255,255,0.10);

    --c-cyan-light: #72BECE;
    --c-blue-muted: #5D7FB7;
    --c-pink-soft:  #EE8C9D;
    --c-purple:     #9685CA;
    --c-teal:       #71BFCC;
    --c-mauve:      #A78CA7;

    --brand-gradient: linear-gradient(120deg,
      var(--c-cyan-light), var(--c-blue-muted), var(--c-purple),
      var(--c-pink-soft), var(--c-mauve), var(--c-teal));

    --w: 1080px;
    --h: 1350px;   /* 1920px for stories */
    --pad-x: 84px;
    --pad-y: 84px;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    background: #18181b;
    font-family: 'Lato', sans-serif;
    color: var(--ink);
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
  }

  .deck { display: flex; flex-direction: column; align-items: center; gap: 48px; padding: 48px 24px; }

  .slide {
    width: var(--w);
    height: var(--h);
    background: var(--bg);
    position: relative;
    overflow: hidden;
  }

  /* Atmosphere orb (one per slide, set per .sN below) */
  .slide::before {
    content: '';
    position: absolute;
    width: 1100px; height: 1100px;
    border-radius: 50%;
    filter: blur(180px);
    pointer-events: none;
    z-index: 0;
  }

  /* Grain */
  .slide::after {
    content: '';
    position: absolute; inset: 0;
    background-image: radial-gradient(rgba(255,255,255,0.012) 1px, transparent 1px);
    background-size: 3px 3px;
    pointer-events: none;
    z-index: 8;
  }

  /* Progress bar */
  .progress {
    position: absolute;
    top: var(--pad-y);
    left: var(--pad-x); right: var(--pad-x);
    height: 1px;
    background: var(--hairline);
    z-index: 4;
  }
  .progress::before {
    content: '';
    position: absolute; top: 0; left: 0; height: 1px;
    background: var(--accent);
  }
  .progress::after {
    content: attr(data-progress);
    position: absolute; top: 16px;
    font-family: 'Lato', sans-serif;
    font-size: 10px; letter-spacing: 0.3em;
    color: var(--muted); font-weight: 700;
  }
  /* Per-slide widths: .s1 33% .s2 66% .s3 100% (for 3 slides) */
  /* For 4 slides: 25/50/75/100. Adjust as needed. */

  /* Motif layer */
  .motif {
    position: absolute; inset: 0;
    z-index: 1;
    pointer-events: none;
  }
  .motif svg { width: 100%; height: 100%; }

  /* Stage: left-aligned content */
  .stage {
    position: absolute;
    top: 0; bottom: 0;
    left: var(--pad-x); right: var(--pad-x);
    display: flex; flex-direction: column;
    justify-content: center; align-items: flex-start;
    z-index: 3;
  }

  .word {
    font-family: 'Syne', sans-serif;
    font-weight: 800;
    font-size: 200px;
    line-height: 0.9;
    letter-spacing: -0.055em;
    color: var(--ink);
    text-align: left;
    margin-bottom: 28px;
  }

  .verdict {
    font-family: 'Syne', sans-serif;
    font-weight: 600;
    font-size: 36px;
    line-height: 1.25;
    letter-spacing: -0.018em;
    color: var(--ink);
    text-align: left;
    max-width: 720px;
  }
  .verdict .accent { color: var(--accent); }

  /* Architectural number */
  .num {
    position: absolute;
    bottom: calc(var(--pad-y) - 18px);
    left: var(--pad-x);
    font-family: 'Syne', sans-serif;
    font-weight: 800;
    font-size: 96px;
    line-height: 1;
    letter-spacing: -0.05em;
    color: var(--ink);
    z-index: 4;
  }
  .num .dot { color: var(--accent); }
  .num .of {
    font-family: 'Lato', sans-serif;
    font-size: 12px; font-weight: 400;
    letter-spacing: 0.3em;
    color: var(--muted);
    vertical-align: top;
    margin-left: 14px; margin-top: 8px;
    display: inline-block;
  }

  /* Asterisk signature */
  .signature {
    position: absolute;
    bottom: var(--pad-y);
    right: var(--pad-x);
    width: 38px; height: 38px;
    background-image: url('thrive_logo_transparent.png');
    background-size: contain;
    background-repeat: no-repeat;
    background-position: center;
    z-index: 4;
  }

  /* === SLIDE-SPECIFIC: set --accent and orb position/color per slide === */
  .s1 { --accent: var(--c-mauve); }
  .s1::before { background: radial-gradient(circle, var(--c-mauve), transparent 65%); top: -200px; right: -200px; opacity: 0.14; }
  .s1 .progress::before { width: 33%; }
  .s1 .progress::after { left: 33%; transform: translateX(-50%); }

  .s2 { --accent: var(--c-blue-muted); }
  .s2::before { background: radial-gradient(circle, var(--c-blue-muted), transparent 65%); top: -250px; left: -150px; opacity: 0.13; }
  .s2 .progress::before { width: 66%; }
  .s2 .progress::after { left: 66%; transform: translateX(-50%); }

  .s3 { --accent: var(--c-cyan-light); }
  .s3::before { background: radial-gradient(circle, var(--c-cyan-light), transparent 65%); bottom: -250px; right: -200px; opacity: 0.18; }
  .s3 .progress::before { width: 100%; }
  .s3 .progress::after { left: 100%; transform: translateX(-100%); }

  /* === RESOLUTION SEQUENCE blur progression (if using template 6A) === */
  .s1 .word { filter: blur(11px); opacity: 0.78; }
  .s2 .word { filter: blur(3.5px); opacity: 0.95; }
  .s3 .word { filter: blur(0); opacity: 1; }

</style>
</head>
<body>
<div class="deck">

  <section class="slide s1">
    <div class="progress" data-progress="33%"></div>
    <div class="motif">
      <svg viewBox="0 0 1080 1350" preserveAspectRatio="none">
        <!-- MOTIF SVG GOES HERE -->
      </svg>
    </div>
    <div class="stage">
      <h1 class="word">[WORD]</h1>
      <p class="verdict">[Verdict line with <span class="accent">accent</span> word.]</p>
    </div>
    <div class="num">01<span class="dot">.</span><span class="of">/ 03</span></div>
    <div class="signature"></div>
  </section>

  <!-- Repeat .s2, .s3 with their content -->

</div>
</body>
</html>
```

-----

## 11. Open Questions & Future Work

### To document next

- **Story-specific pattern**: We built one story (the network/system one) but didn’t finalize a full story system. Stories may benefit from a different rhythm than carousels.
- **Arabic version of the pattern**: All current patterns are English. Arabic posts need: itfGhroob font, RTL layout, guillemets `«...»`, right-aligned default. Same color and motif logic should still apply.
- **Reels covers**: 9:16 vertical, but designed to be the first frame of a moving video. May want a “freeze frame” subset of the pattern.

### Series identifiers

Decision to make: do carousels carry a series name in the file system (e.g., “Field Notes / Vol. 02 / The Climb”)? In v1.0 we removed this from the visible design (because it felt like website chrome), but kept the internal naming for organization. Each carousel still has a working title (e.g., “Resolution Sequence: Idea → Strategy”). When publishing, this name does not appear on the slides themselves, but lives in the caption or in the post’s working title.

### When this file is updated

- Each completed design session that introduces a new motif, pattern, or rule
- Brand-level changes (new color, new font, new philosophy point)
- After 5 published carousels, review what’s working and what’s been ignored — prune accordingly

-----

## 12. Quick Reference Card

When you start a session, scan this:

```
□ Size confirmed? (default 4:5 / 1080×1350)
□ Narrative architecture chosen? (see §6)
□ Color progression chosen across slides?
□ Motif per slide chosen? (see §7)
□ Left-aligned headline at 175–200px Syne 800
□ Identity elements all present (orb, progress, num, signature, grain)
□ Zero em dashes, straight quotes only
□ Final slide tests as a convergence, not a summary
□ Caption drafted in the chosen voice (philosophical / question-bridge / editor's note)
```

If all 9 boxes check, the post is publication-grade.

-----

*End of THRIVE_CAROUSEL_PATTERN.md v1.0*