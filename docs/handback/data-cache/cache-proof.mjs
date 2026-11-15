// Run-id cache proof: counts the data requests the server actually sees per scenario.
// usage: node cache-proof.mjs <baseUrl> <serverLog> <outDataDir> <outDir>
// Serve dashboard/out with `python3 -m http.server 2> <serverLog>` and the live data-branch files in out/data/.
import { chromium } from "/home/uzi/.local/share/mise/installs/npm-playwright/latest/node_modules/playwright/index.mjs";
import fs from "node:fs";
import path from "node:path";

const [base, serverLog, dataDir, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const FILES = ["places", "trends", "risk", "series", "fires_24h", "feed", "freshness", "honesty", "run"];
const failures = [];
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures.push(msg); };
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const logLines = () => fs.readFileSync(serverLog, "utf8").split("\n").filter((l) => l.includes("GET /data/"));
const originals = Object.fromEntries(FILES.map((f) => [f, fs.readFileSync(path.join(dataDir, `${f}.json`), "utf8")]));
const RUN_A = JSON.parse(originals.run).run_id;
const RUN_B = RUN_A.replace(/T\d{4}Z/, "T2359Z"); // same day, later: sorts after RUN_A
const setRunId = (which, id) => {
  for (const f of which) {
    const d = JSON.parse(originals[f]);
    if (f === "run") d.run_id = id; else d.meta.run_id = id;
    fs.writeFileSync(path.join(dataDir, `${f}.json`), JSON.stringify(d));
  }
};
const restore = () => { for (const f of FILES) fs.writeFileSync(path.join(dataDir, `${f}.json`), originals[f]); };

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } }); // one context = one IndexedDB
let page = null;
const errors = [];

/** Open the dashboard in a fresh page; returns ms to the subtitle, the pill text + title, and the data requests the server saw. */
async function visit(label, q = "mode=next14&hazard=wildfire") {
  const before = logLines().length;
  if (page) await page.close();
  page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${label}: ${e.message}`));
  const t0 = Date.now();
  await page.goto(`${base}/?${q}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=places on watch ·", { timeout: 120000 });
  const ms = Date.now() - t0;
  // let the probe (and a refresh, if any) finish
  await page.waitForFunction(() => !document.body.innerText.includes("checking for a newer run"), null, { timeout: 60000 });
  await settle(1500);
  const pill = await page.evaluate(() => {
    const el = [...document.querySelectorAll("div")].find((d) => /^(live|stale) · updated/.test(d.textContent?.trim() ?? ""));
    return { text: el?.textContent?.trim() ?? null, title: el?.getAttribute("title") ?? null };
  });
  const reqs = logLines().slice(before).map((l) => l.match(/GET \/data\/([a-z0-9_]+)\.json/)?.[1]).filter(Boolean);
  console.log(`\n[${label}] ${ms} ms to first content · ${reqs.length} data requests: ${reqs.join(", ")}`);
  console.log(`  pill: ${pill.text}\n  title: ${pill.title}`);
  return { ms, pill, reqs };
}

// 1. first visit: nothing cached → probe + the nine files
const first = await visit("first visit");
check(first.reqs.length === 10 && first.reqs.filter((r) => r === "run").length === 2, "first visit fetches the probe and the nine files");
check(first.pill.title?.includes(RUN_A) && first.pill.title?.includes("from the network"), "first visit shows the live run from the network");
await page.screenshot({ path: `${outDir}/cache-first-visit.png`, clip: { x: 0, y: 0, width: 900, height: 140 } });

// 2. reload: the cached run renders, the probe says current → one request
const reload = await visit("reload");
check(reload.reqs.length === 1 && reload.reqs[0] === "run", "a reload fetches only run.json");
check(reload.pill.title?.includes(RUN_A) && reload.pill.title?.includes("from the browser cache"), "a reload shows the cached run");
check(reload.ms < first.ms, `cached first content (${reload.ms} ms) is faster than the first visit (${first.ms} ms)`);
await page.screenshot({ path: `${outDir}/cache-reload.png`, clip: { x: 0, y: 0, width: 900, height: 140 } });

// 3. the CDN mid-publish: run.json already says a new run, the other files still the old one → keep the cache
setRunId(["run"], RUN_B);
const half = await visit("half-published run");
check(half.reqs.length === 10, "a changed run id triggers the full fetch");
check(half.pill.title?.includes(RUN_A) && half.pill.title?.includes("from the browser cache"), "a set whose files disagree does not replace the cached run");

// 4. the whole run published → the new run replaces the cache
setRunId(FILES, RUN_B);
const fresh = await visit("new run published");
check(fresh.reqs.length === 10, "the new run is fetched in full");
check(fresh.pill.title?.includes(RUN_B) && fresh.pill.title?.includes("from the network"), `the new run ${RUN_B} is on screen`);
await page.screenshot({ path: `${outDir}/cache-new-run.png`, clip: { x: 0, y: 0, width: 900, height: 140 } });

// 5. reload again: the new run is now the cached one
const again = await visit("reload after the new run");
check(again.reqs.length === 1 && again.pill.title?.includes(RUN_B) && again.pill.title?.includes("from the browser cache"), "the new run is served from the cache on the next reload");

// 6. the data server goes away: the cached run stays up and the pill says so
setRunId(["run"], "");
fs.unlinkSync(path.join(dataDir, "run.json"));
const offline = await visit("probe fails");
check(offline.pill.text?.includes("offline, showing the cached run") && offline.pill.title?.includes(RUN_B), "a failed probe keeps the cached run and says offline");
await page.screenshot({ path: `${outDir}/cache-offline.png`, clip: { x: 0, y: 0, width: 900, height: 140 } });

restore();
console.log("\npage errors:", errors.length, errors.slice(0, 3));
check(errors.length === 0, "no page errors");
await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
