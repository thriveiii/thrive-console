/* P25 · The Library, mission-aware. Proves the R16 mission model and the one-editor law in Node
 * (no browser; the sandbox browser is unreliable and this logic needs none).
 *
 *   node tools/library_missions_test.js
 *
 * Part A lifts the REAL mission model (getMissions / getMission / addMission / removeMission / missionOf /
 * missionName + the two seeds) from library/app.js and proves: two missions ship seeded in order; every page
 * resolves to exactly one mission (en-opp1/ar-opp1 -> prospect-offer, a bare custom upload -> the default,
 * an explicit o.mission wins, an unknown o.mission falls back); a flat page list partitions across the
 * shelves with NONE lost and NONE duplicated (count before == count after); a custom mission appends a third
 * shelf and can be removed, while a seed can never be removed.
 * Part B is a source audit proving the one-editor law: there is exactly one editor (function initEditor), no
 * second/report editor fork; the editor asks the mission (#f_mission) and record() stamps a mission on every
 * page it builds, so nothing is filed unfiled.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.dirname(__dirname);
const app = fs.readFileSync(path.join(ROOT, "library", "app.js"), "utf8");
const editorHtml = fs.readFileSync(path.join(ROOT, "library", "editor.html"), "utf8");
let fails = 0;
function ck(name, cond, detail) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) { fails++; if (detail !== undefined) console.log("      " + String(detail).slice(0, 300)); }
}
function slice(fromMarker, toMarker) {
  const a = app.indexOf(fromMarker);
  const b = app.indexOf(toMarker, a);
  if (a < 0 || b < 0) throw new Error("markers not found: " + fromMarker + " .. " + toMarker);
  return app.slice(a, b);
}

/* ============ Part A: the mission model, lifted verbatim and exercised ============ */
{
  // The whole mission-model block, verbatim, up to (not including) initTemplates.
  const src = slice('const MISSIONS_KEY = "thrive_missions_v1";', "function initTemplates(){");

  // A fresh in-memory localStorage + lsSet, the only host reads/writes the block makes.
  function makeSandbox() {
    const store = {};
    const localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    };
    const sandbox = {
      Math, Number, Array, JSON, Date, Object, String,
      localStorage,
      lsSet: (k, v) => localStorage.setItem(k, v),
      window: {},
      console
    };
    vm.createContext(sandbox);
    vm.runInContext(src +
      "\nthis.getMissions=getMissions; this.getMission=getMission; this.addMission=addMission;" +
      "\nthis.removeMission=removeMission; this.missionOf=missionOf; this.missionName=missionName;" +
      "\nthis.MISSION_SEED=MISSION_SEED; this.MISSION_DEFAULT=MISSION_DEFAULT;", sandbox);
    return sandbox;
  }
  const S = makeSandbox();

  // ---- two seeded missions, in order ----
  const seeded = S.getMissions();
  ck("seeds: exactly the two ratified missions ship", seeded.length === 2, seeded.map(m => m.id));
  ck("seeds: prospect-offer first, monthly-report second (seed order)",
    seeded[0].id === "prospect-offer" && seeded[1].id === "monthly-report", seeded.map(m => m.id));
  ck("seeds: the Prospect Offer carries the Signal Brief templates",
    JSON.stringify(seeded[0].templates) === JSON.stringify(["en-opp1", "ar-opp1"]), seeded[0].templates);
  ck("seeds: the Monthly Report is an upload mission (no fill-template)",
    Array.isArray(seeded[1].templates) && seeded[1].templates.length === 0, seeded[1].templates);
  ck("seeds: each seeded mission renders a non-empty requirements manifest",
    (seeded[0].manifest || []).length > 0 && (seeded[1].manifest || []).length > 0,
    [seeded[0].manifest && seeded[0].manifest.length, seeded[1].manifest && seeded[1].manifest.length]);
  ck("seeds: missionName gives EN and AR names",
    S.missionName(seeded[0], "en") === "Prospect Offer" && S.missionName(seeded[0], "ar") === "عرض للعميل",
    [S.missionName(seeded[0], "en"), S.missionName(seeded[0], "ar")]);

  // ---- missionOf: every page resolves to exactly one mission ----
  ck("missionOf: en-opp1 -> prospect-offer", S.missionOf({ template: "en-opp1" }) === "prospect-offer");
  ck("missionOf: ar-opp1 -> prospect-offer", S.missionOf({ template: "ar-opp1" }) === "prospect-offer");
  ck("missionOf: a bare custom upload -> the default shelf (prospect-offer)",
    S.missionOf({ template: "custom" }) === S.MISSION_DEFAULT);
  ck("missionOf: no template at all -> the default shelf",
    S.missionOf({}) === S.MISSION_DEFAULT && S.missionOf(null) === S.MISSION_DEFAULT);
  ck("missionOf: an explicit mission wins over template origin",
    S.missionOf({ template: "en-opp1", mission: "monthly-report" }) === "monthly-report");
  ck("missionOf: an explicit but unknown mission falls back to template/default",
    S.missionOf({ template: "en-opp1", mission: "ghost-xyz" }) === "prospect-offer" &&
    S.missionOf({ template: "custom", mission: "ghost-xyz" }) === S.MISSION_DEFAULT);

  // ---- migration: a flat page list partitions across shelves, nothing lost or duplicated ----
  const pages = [
    { slug: "a", template: "en-opp1" }, { slug: "b", template: "ar-opp1" },
    { slug: "c", template: "custom" }, { slug: "d", template: "custom" },
    { slug: "e", template: "custom" }, { slug: "f", template: "" },
    { slug: "g", template: "en-opp1" }, { slug: "h", template: "custom", mission: "monthly-report" }
  ];
  const missions = S.getMissions();
  const byMission = {}; missions.forEach(m => byMission[m.id] = []);
  pages.forEach(o => { const mid = S.missionOf(o); (byMission[mid] = byMission[mid] || []).push(o); });
  const total = Object.keys(byMission).reduce((n, k) => n + byMission[k].length, 0);
  ck("migration: count before == count after (no page lost, no page duplicated)", total === pages.length,
    { before: pages.length, after: total });
  const allSlugs = [].concat.apply([], Object.keys(byMission).map(k => byMission[k].map(o => o.slug))).sort();
  ck("migration: every original page appears exactly once across the shelves",
    JSON.stringify(allSlugs) === JSON.stringify(pages.map(o => o.slug).sort()), allSlugs);
  ck("migration: the explicit-mission page lands on the Monthly Report shelf",
    byMission["monthly-report"].some(o => o.slug === "h"), byMission["monthly-report"].map(o => o.slug));
  ck("migration: the custom uploads with no mission land on the default shelf",
    ["c", "d", "e", "f"].every(s => byMission["prospect-offer"].some(o => o.slug === s)),
    byMission["prospect-offer"].map(o => o.slug));

  // ---- a custom mission appends a third shelf; a seed is permanent ----
  const S2 = makeSandbox();
  S2.addMission({ id: "welcome-kit", name_en: "Welcome Kit", name_ar: "حزمة ترحيب", manifest: [{ id: "x", en: "one thing", ar: "شيء" }] });
  const three = S2.getMissions();
  ck("new mission: opening one appends a third shelf", three.length === 3 && three[2].id === "welcome-kit", three.map(m => m.id));
  ck("new mission: it persists to the store and comes back on re-read",
    !!S2.getMission("welcome-kit"), S2.getMission("welcome-kit"));
  ck("new mission: removeMission takes the third shelf away",
    S2.removeMission("welcome-kit") === true && S2.getMissions().length === 2, S2.getMissions().map(m => m.id));
  ck("seed guard: a seeded mission can never be removed",
    S2.removeMission("prospect-offer") === false && S2.getMissions().some(m => m.id === "prospect-offer"));
  ck("seed guard: addMission never shadows a seed id",
    (function () { S2.addMission({ id: "prospect-offer", name_en: "HIJACK" }); return S2.getMission("prospect-offer").name_en === "Prospect Offer"; })());
}

/* ============ Part B: the one-editor law + upload-asks-mission (source audit) ============ */
{
  const initEditorCount = (app.match(/function initEditor\s*\(/g) || []).length;
  ck("one editor: exactly one initEditor exists", initEditorCount === 1, initEditorCount);
  ck("one editor: no per-mission editor fork (no initReportEditor / initMonthlyEditor / second editor)",
    !/function\s+init(Report|Monthly|Offer)\w*Editor\s*\(/.test(app) && !/function\s+initEditor2\s*\(/.test(app));

  // The editor asks the mission, and shows the manifest, in the ONE editor markup.
  ck("asks the mission: the editor has a #f_mission select", /id="f_mission"/.test(editorHtml), true);
  ck("asks the mission: the editor has a requirements-manifest slot", /id="missionManifest"/.test(editorHtml), true);
  ck("asks the mission: the mission field is data-i18n bound (EN + AR)", /data-i18n="f_mission"/.test(editorHtml), true);

  // record() stamps a mission on every page the editor builds, so nothing is filed unfiled.
  const recIdx = app.indexOf("function record(){");
  const recEnd = app.indexOf("\n  }", recIdx);
  const recSrc = app.slice(recIdx, recEnd);
  ck("nothing unfiled: record() stamps a mission field", /\bmission:\s*\(/.test(recSrc), recSrc.slice(0, 260));
  ck("nothing unfiled: record()'s mission defaults to MISSION_DEFAULT when unset",
    /mission:[^\n]*MISSION_DEFAULT/.test(recSrc), recSrc.slice(0, 400));

  // The new-mission flow always resolves the sentinel before it can be filed.
  ck("new-mission flow: choosing '+ New mission' opens a prompt, never files the sentinel",
    /openNewMissionPrompt/.test(app) && /value!=="__new__"/.test(app));

  // The synced store key is registered so custom missions travel with the operator.
  ck("sync: the missions store key is a synced key", /thrive_missions_v1\s*:/.test(app));
}

console.log(fails === 0 ? "\n0 failed" : "\n" + fails + " failed");
process.exit(fails === 0 ? 0 : 1);
