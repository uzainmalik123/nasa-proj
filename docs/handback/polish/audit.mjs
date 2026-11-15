// Polish audit at 1920×1080: console/page errors, failed requests, layout
// shifts (CLS entries with their sources), every tab, a selected place, "/" and Esc.
// usage: node audit.mjs <baseUrl> <outDir> [prefix]
import { chromium } from "/home/uzi/.local/share/mise/installs/npm-playwright/latest/node_modules/playwright/index.mjs";
import fs from "node:fs";

const [base, outDir, prefix = ""] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (page, name, opts = {}) => { await page.screenshot({ path: `${outDir}/${prefix}${name}.png`, ...opts }); console.log(`shot ${prefix}${name}`); };

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const log = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") log.push(`${m.type()}: ${m.text()}`); });
page.on("pageerror", (e) => log.push(`pageerror: ${e.message}`));
page.on("requestfailed", (r) => log.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
page.on("response", (r) => { if (r.status() >= 400) log.push(`http ${r.status()}: ${r.url()}`); });
await page.addInitScript(() => {
  window.__shifts = [];
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      window.__shifts.push({ t: Math.round(e.startTime), v: +e.value.toFixed(4), input: e.hadRecentInput,
        src: (e.sources || []).map((s) => {
          const n = s.node; let d = "?";
          if (n && n.nodeType === 1) d = `${n.tagName.toLowerCase()}.${String(n.className).slice(0, 60)} "${(n.textContent || "").slice(0, 40)}"`;
          else if (n) d = `#text "${(n.textContent || "").slice(0, 40)}"`;
          return `${d} ${JSON.stringify(s.previousRect)}→${JSON.stringify(s.currentRect)}`;
        }) });
    }
  }).observe({ type: "layout-shift", buffered: true });
});

await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
await settle(300); await shot(page, "00-t0300ms");
await settle(1200); await shot(page, "01-t1500ms");
await page.waitForSelector("text=/live ·|stale ·/", { timeout: 120000 });
await settle(9000);
await shot(page, "02-loaded-risk");
for (const t of ["Trends", "Alerts", "Regions", "Sources"]) {
  await page.getByRole("tab", { name: t }).click(); await settle(900);
  await shot(page, `03-tab-${t.toLowerCase()}`);
  const pane = page.locator(".tab-pane");
  if (await pane.evaluate((e) => e.scrollHeight > e.clientHeight + 4)) {
    await pane.evaluate((e) => e.scrollTo(0, e.scrollHeight)); await settle(500);
    await shot(page, `03-tab-${t.toLowerCase()}-bottom`);
  }
}
await page.getByRole("tab", { name: "Risk" }).click(); await settle(500);
// keyboard: "/" focuses search
await page.mouse.click(1400, 600); await settle(300); await page.keyboard.press("Escape");
await page.keyboard.press("/");
const focused = await page.evaluate(() => document.activeElement?.tagName + ":" + (document.activeElement?.getAttribute("placeholder") ?? ""));
console.log("after '/': activeElement =", focused);
await page.keyboard.type("lahore"); await settle(400);
await page.keyboard.press("Enter"); await settle(4000);
await shot(page, "04-place-selected");
const panel = page.locator("[role=dialog][aria-label='selected place']");
console.log("place panel open:", await panel.count());
if (await panel.count()) {
  await panel.evaluate((e) => e.scrollTo(0, e.scrollHeight)); await settle(500);
  await shot(page, "05-place-panel-bottom");
  await panel.evaluate((e) => e.scrollTo(0, 0));
}
await page.keyboard.press("Escape"); await settle(200);
await page.keyboard.press("Escape"); await settle(600);
console.log("after Esc: panel open =", await panel.count(), "· url =", page.url());
await shot(page, "06-after-esc");

const shifts = await page.evaluate(() => window.__shifts);
const cls = shifts.filter((s) => !s.input).reduce((a, s) => a + s.v, 0);
console.log(`\nlayout shifts (no recent input): ${shifts.filter((s) => !s.input).length}, CLS sum ${cls.toFixed(4)}`);
for (const s of shifts) console.log(JSON.stringify(s));
console.log(`\nconsole/page/network problems: ${log.length}`);
for (const l of log) console.log("  " + l);
await browser.close();
