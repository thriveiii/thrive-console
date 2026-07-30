# Thrive Opportunity Library

A self-hosted, static library for the daily prospect pages. Each prospect gets a clean link:

```
https://console.thriveiii.com/opp/<business-slug>
```

No Netlify, no per-deploy credits. Just a GitHub repo served by GitHub Pages, with a bilingual (AR/EN) dashboard and editor.

---

## What is inside

```
/                      redirect to the library
/library/              the dashboard, editor, and approved-templates gallery
/library/manifest.json the classified list of every opportunity (name, date, location, phone)
/templates/en-opp1/    the approved "Signal Brief" template (tokenized)
/opp/<slug>/index.html one live page per prospect  ->  console.thriveiii.com/opp/<slug>
/assets/               the Thrive logo
CNAME                  thriveiii.com
```

Approved templates today: **en-opp1** (English, Lato) and **ar-opp1** (Arabic RTL, Alyamama). Both fonts are embedded inside each page as base64, so the pages render identically on Windows, macOS, iOS and Android with nothing to install.

---

## One-time setup (about 10 minutes)

### 1. Create the repository and push
```bash
cd opp-site
git init
git add -A
git commit -m "Thrive Opportunity Library"
git branch -M main
# create an empty repo on github.com first (any name, e.g. thrive-opp), then:
git remote add origin https://github.com/<YOUR_GITHUB_USERNAME>/<REPO>.git
git push -u origin main
```

### 2. Turn on GitHub Pages
GitHub repo → **Settings → Pages** → Build and deployment → Source: **Deploy from a branch** → Branch: **main**, folder: **/ (root)** → Save.

Within a minute the site is live at `https://<username>.github.io/<repo>/`.

### 3. Point the domain thriveiii.com at it
The `CNAME` file already contains `thriveiii.com`. At your domain registrar (where you manage thriveiii.com DNS), add:

- Four **A** records for the apex `@` → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
- One **CNAME** record for `www` → `<username>.github.io`

Then in **Settings → Pages → Custom domain** enter `thriveiii.com`, Save, and tick **Enforce HTTPS** once it is available. DNS can take a little while to propagate.

> If you serve from a repo named exactly `thriveiii.com` or from `<username>.github.io`, the paths stay `/opp/<slug>` as shown. If you use a project repo with a custom domain (recommended), the custom domain makes the root `/`, so links remain `console.thriveiii.com/opp/<slug>`.

---

## The daily routine

Each working day you receive **3 finished pages** (and their manifest entries). To publish each one:

1. In the repo, create the folder `opp/<slug>/` and put the page there as `index.html`.
2. Add the opportunity to `library/manifest.json` under `opportunities` (or use the dashboard's **Export manifest.json** to regenerate the whole file).
3. Commit and push. The page is live at `console.thriveiii.com/opp/<slug>` in about a minute.
4. Copy that link into your outreach email.

### Doing it yourself in the browser
Open `/library/editor.html`:

- **Fill a template**: choose `en-opp1`, type the business name (the slug and link fill in automatically), add the date, location, phone, an optional real quote, the three "what you built" lines, and the busier-pair. Watch the live preview. Then **Download page** (an `index.html`), **Save to library** (keeps it in this browser's dashboard), and **Copy manifest entry**.
- **Upload HTML**: drop a finished `.html` page, set the metadata, and export the same way.

The **Library** page classifies everything by business, send date, location, phone and template, with search, sorting and a language toggle.

> Rule that never bends: never invent a quote, an email, a number, or a claim. Leave the quote empty if there is no real one.
