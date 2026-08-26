/* P24: two explicit send paths — the plan is honest, and the chooser wires the ONE system (no new machinery).
 *
 *   node tools/send_paths_test.js
 *
 * Part A lifts the REAL campaignPlan + campaignSchedule from library/app.js and proves the plan the operator
 * sees matches what the scheduler will actually do: the jitter band is the stated base..base+spread, today's
 * capacity is min(daily budget, warm cap), the deferred count and the day-of-last-row agree with a real
 * schedule, and the plan writes nothing.
 * Part B is a source audit proving the P24 entry points add NO send machinery: openSendChooser only navigates
 * (window.thriveModal.open) and never calls relaySend / startCampaignQueue / compile; the campaign path never
 * bypasses the roster/preview/queue; and the one compile and one queue are still singular.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.dirname(__dirname);
const app = fs.readFileSync(path.join(ROOT, "library", "app.js"), "utf8");
let fails = 0;
function ck(name, cond, detail) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) { fails++; if (detail !== undefined) console.log("      " + String(detail).slice(0, 300)); }
}
function grabFn(name) {
  const start = app.indexOf("function " + name + "(");
  if (start < 0) throw new Error("not found: function " + name);
  const end = app.indexOf("\n}", start);
  return app.slice(start, end + 2);
}
function grabConst(re) { const m = app.match(re); if (!m) throw new Error("const not found: " + re); return m[0]; }

/* ============ Part A: the plan matches the scheduler, and writes nothing ============ */
{
  const src = [
    grabConst(/const DAY_MS=\d+/),
    grabConst(/var CAMPAIGN_JITTER=\{[^}]*\};/),
    grabConst(/var CAMPAIGN_WARM_CAP=\d+;/),
    grabFn("campaignJitterCfg"),
    grabFn("campaignSchedule"),
    grabFn("campaignPlan")
  ].join("\n");
  // Stub the two reads campaignPlan/Schedule make: the roster and the quota. Everything else is pure math.
  const sandbox = { Math, Number, Array, Date,
    campaignRecipients: (o) => o.__recips,
    quotaUsage: () => ({ dayLeft: sandbox.__dayLeft }) };
  sandbox.__dayLeft = 100;
  vm.createContext(sandbox);
  vm.runInContext(src + "\nthis.campaignPlan=campaignPlan; this.campaignSchedule=campaignSchedule; this.CAMPAIGN_WARM_CAP=CAMPAIGN_WARM_CAP;", sandbox);
  const WARM = sandbox.CAMPAIGN_WARM_CAP;
  const NOW = 1000000000000;
  const roster = (n) => ({ __recips: Array.from({ length: n }, (_, i) => ({ addr: "r" + i + "@x.co", name: "R" + i, lang: "en" })) });

  // 12 recipients, plenty of budget: the whole brief goes today.
  sandbox.__dayLeft = 100;
  const p12 = sandbox.campaignPlan(roster(12), NOW);
  ck("plan: the jitter band is the stated base..base+spread (seconds)", p12.jitterMinS === 45 && p12.jitterMaxS === 165, p12);
  ck("plan: 12 recipients under budget all send today (0 deferred, day 0)", p12.n === 12 && p12.deferred === 0 && p12.days === 0, p12);
  ck("plan: today's capacity is min(daily budget, warm cap)", p12.todayCap === Math.min(100, WARM), p12);

  // 50 recipients, warm cap 40: 40 today, 10 defer to tomorrow.
  const p50 = sandbox.campaignPlan(roster(50), NOW);
  ck("plan: past the warm cap, the overflow defers (50 → 40 today, 10 deferred)", p50.deferred === 50 - WARM && p50.days === 1, p50);

  // a tight daily budget clamps today's capacity below the warm cap.
  sandbox.__dayLeft = 5;
  const pTight = sandbox.campaignPlan(roster(12), NOW);
  ck("plan: a tight daily budget clamps today's capacity (budget 5 < warm cap)", pTight.todayCap === 5 && pTight.deferred === 12 - 5, pTight);

  // The plan's day-of-last-row must agree with a REAL schedule for the same inputs (the plan does not lie).
  sandbox.__dayLeft = 100;
  for (const n of [12, 40, 41, 95]) {
    const o = roster(n);
    const sched = sandbox.campaignSchedule(o, o.__recips, { dayLeft: 100 }, NOW);
    const maxDay = sched.rows.reduce((m, r) => Math.max(m, r.day), 0);
    const plan = sandbox.campaignPlan(o, NOW);
    ck("plan agrees with the real scheduler on the last-row day (n=" + n + ")", plan.days === maxDay, { planDays: plan.days, maxDay });
    ck("plan agrees with the real scheduler on deferred count (n=" + n + ")", plan.deferred === sched.deferred, { plan: plan.deferred, sched: sched.deferred });
  }

  // campaignPlan writes nothing: its source touches no persistence.
  const planSrc = grabFn("campaignPlan");
  ck("campaignPlan writes nothing (no saveDraft / logMail / pushOutbox / setMailLog)",
     !/saveDraft|logMail|pushOutbox|setMailLog|startCampaignQueue/.test(planSrc), "");
}

/* ============ Part B: the chooser adds NO send machinery; it wires the one system ============ */
{
  const chooser = grabFn("openSendChooser");
  ck("openSendChooser only navigates (window.thriveModal.open), it does not send",
     /thriveModal\.open/.test(chooser) && !/relaySend\(|startCampaignQueue\(|function compile\(|pushOutbox\(|logMail\(/.test(chooser), "");
  ck("the single path routes to the composer (outreach tab)", /data-mode/.test(chooser) && /"outreach"/.test(chooser), "");
  ck("the campaign path routes to the campaign screen when a roster exists, else the roster (overview)",
     /else if\(group\)/.test(chooser) && /"outreach"/.test(chooser) && /"overview"/.test(chooser), "");
  ck("a campaign with no roster is sent to build one first (send_campaign_needroster), never a bypass",
     /send_campaign_needroster/.test(chooser), "");

  // The one system stays singular: P24 added no second compile and no second queue.
  ck("exactly ONE compile function still (no second compile path)", app.split("function compile(").length - 1 === 1);
  ck("exactly ONE startCampaignQueue still (no second queue)", app.split("function startCampaignQueue(").length - 1 === 1);
  ck("exactly ONE relaySend still (the one hardened send path)", app.split("function relaySend(").length - 1 === 1);

  // The campaign screen restates the discipline: the plan panel is mounted beside Start campaign.
  ck("the campaign plan is filled on the campaign screen (initCompose → #cmpPlan)",
     /campaignPlanHtml\(oppObj\)/.test(app) && /el\("cmpPlan"\)/.test(app), "");
  const consoleHtml = fs.readFileSync(path.join(ROOT, "library", "console.html"), "utf8");
  const composeHtml = fs.readFileSync(path.join(ROOT, "library", "compose.html"), "utf8");
  ck("the campaign-plan host exists on the campaign screen in both mount contexts",
     /id="cmpPlan"/.test(consoleHtml) && /id="cmpPlan"/.test(composeHtml), "");
  // The top-bar Send (board + Insights toolbars) opens the chooser, not a slug-less compose link any more.
  const boardHtml = fs.readFileSync(path.join(ROOT, "library", "board.view.html"), "utf8");
  const indexHtml = fs.readFileSync(path.join(ROOT, "library", "index.html"), "utf8");
  ck("the top-bar Send buttons are class js-send-open (board + Insights), not compose.html links",
     /js-send-open/.test(boardHtml) && /js-send-open/.test(indexHtml)
     && !/href="compose\.html"[^>]*home_send/.test(boardHtml) && !/href="compose\.html"[^>]*home_send/.test(indexHtml), "");
  ck("every js-send-open opens the chooser (openSendChooser(null))",
     /querySelectorAll\("\.js-send-open"\)[\s\S]{0,120}openSendChooser\(null\)/.test(app), "");
  // The card overview offers the explicit Send.
  ck("the card overview offers an explicit Send (data-sendchoose → openSendChooser)",
     /data-sendchoose/.test(app) && /openSendChooser\(b\.getAttribute\("data-sendchoose"\)/.test(app), "");
}

console.log("\n" + fails + " failed");
process.exit(fails ? 1 : 0);
