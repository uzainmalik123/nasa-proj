// M-MODE+URL proof: both modes, the hazards table + cards per mode, and a URL
// round trip. usage: node proof.mjs <baseUrl> <outDir>
import { chromium } from "/home/uzi/.local/share/mise/installs/npm-playwright/latest/node_modules/playwright/index.mjs";
import fs from "node:fs";

const [base, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (page, name, opts = {}) => { await page.screenshot({ path: `${outDir}/${name}.png`, ...opts }); console.log(`shot ${name}`); };
const card = (page, re) => page.locator("aside > section").filter({ has: page.locator("h2", { hasText: re }) }).first();
const cardShot = async (page, re, name) => { const c = card(page, re); await c.scrollIntoViewIfNeeded(); await c.screenshot({ path: `${outDir}/${name}.png` }); console.log(`shot ${name}`); };
const waitData = async (page) => { await page.waitForSelector("text=places on watch ·", { timeout: 120000 }); await settle(9000); };
const legend = (page) => page.locator("div.pointer-events-none.absolute.bottom-3.left-3").innerText();
const state = async (page) => ({
  url: new URL(page.url()).search || "(bare)",
  mode: await page.locator("[role=radiogroup][aria-label=mode] [aria-checked=true]").innerText(),
  hazard: await page.locator("label:has-text('hazard') select").inputValue(),
  trend: await page.locator("label:has-text('trend') select").inputValue(),
  region: await page.locator("label:has-text('region') select").inputValue(),
  place: await page.locator("aside h2", { hasText: /selected place/i }).first().innerText(),
  legend: (await legend(page)).split("\n").slice(0, 2).join(" | "),
  hazardsTitle: await page.locator("aside h2", { hasText: /^hazards/i }).first().innerText(),
  headers: await card(page, /^hazards/i).locator("thead th").allInnerTexts(),
});

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

// ---- 1. mode = now, default hazard (wildfire): globe by category today
await page.goto(`${base}/?mode=now`, { waitUntil: "domcontentloaded" });
await waitData(page);
console.log("NOW:", JSON.stringify(await state(page), null, 1));
await shot(page, "mode-now-wildfire");
const firstRowsNow = await card(page, /^hazards/i).locator("tbody tr").allInnerTexts();
console.log("now top rows:", firstRowsNow.slice(0, 4));

// ---- 2. click the toggle → next 14 days: globe by probability, URL drops mode (default)
await page.locator("[role=radiogroup][aria-label=mode] button", { hasText: "Next 14 days" }).click();
await settle(1500);
console.log("NEXT14:", JSON.stringify(await state(page), null, 1));
await shot(page, "mode-next14-wildfire");
console.log("next14 top rows:", (await card(page, /^hazards/i).locator("tbody tr").allInnerTexts()).slice(0, 4));

// ---- 3. hazard cards per mode (select a place by search, tall viewport)
await page.keyboard.press("/");
await page.keyboard.type("lahore");
await settle(400);
await page.keyboard.press("Enter");
await settle(3000);
await page.setViewportSize({ width: 1600, height: 2600 });
await settle(1200);
await cardShot(page, /selected place/i, "cards-next14-lahore");
console.log("cards next14:", await card(page, /selected place/i).locator("button[aria-pressed]").allInnerTexts());
await page.locator("[role=radiogroup][aria-label=mode] button", { hasText: "Now" }).click();
await settle(800);
await cardShot(page, /selected place/i, "cards-now-lahore");
console.log("cards now:", await card(page, /selected place/i).locator("button[aria-pressed]").allInnerTexts());
await cardShot(page, /^hazards/i, "table-now-wildfire");
await page.locator("[role=radiogroup][aria-label=mode] button", { hasText: "Next 14 days" }).click();
await settle(600);
await cardShot(page, /^hazards/i, "table-next14-wildfire");
await page.setViewportSize({ width: 1600, height: 1000 });
await settle(600);

// ---- 4. build a shareable state through the UI: now · heat · trend tmax (chart only) · Asia · Lahore
await page.locator("[role=radiogroup][aria-label=mode] button", { hasText: "Now" }).click();
await page.locator("label:has-text('hazard') select").selectOption("heat");
await page.locator("label:has-text('trend') select").selectOption("tmax_c"); // lens → trend
await page.locator("label:has-text('hazard') select").selectOption("heat");  // lens back → hazard
await page.locator("label:has-text('region') select").selectOption("Asia");
await settle(1500);
const built = await state(page);
console.log("BUILT:", JSON.stringify(built, null, 1));
const share = page.url();
console.log("SHARE URL:", share);
await shot(page, "share-built");

// ---- 5. reload the shared URL in a fresh page: same state
const page2 = await ctx.newPage();
page2.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page2.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
await page2.goto(share, { waitUntil: "domcontentloaded" });
await waitData(page2);
await settle(3000); // fly-to on load
const reloaded = await state(page2);
console.log("RELOADED:", JSON.stringify(reloaded, null, 1));
const same = ["url", "mode", "hazard", "trend", "region", "place", "legend", "hazardsTitle"].every((k) => built[k] === reloaded[k]);
console.log("ROUND TRIP SAME STATE:", same);
await shot(page2, "share-reloaded");

// ---- 6. trend lens via URL (globe=trend) and legacy var= alias
await page2.goto(`${base}/?mode=now&globe=trend&trend=tmax_c`, { waitUntil: "domcontentloaded" });
await waitData(page2);
console.log("TREND LENS:", JSON.stringify(await state(page2), null, 1));
await shot(page2, "globe-trend-lens", { clip: { x: 0, y: 0, width: 1040, height: 1000 } });
await page2.goto(`${base}/?mode=now&var=tmax_c&selected=1`, { waitUntil: "domcontentloaded" });
await waitData(page2);
console.log("LEGACY var= selected=:", JSON.stringify(await state(page2), null, 1));

// ---- 7. drought in both modes (category in both; legend says so)
for (const mode of ["now", "next14"]) {
  await page2.goto(`${base}/?mode=${mode}&hazard=drought`, { waitUntil: "domcontentloaded" });
  await waitData(page2);
  console.log(`DROUGHT ${mode}:`, (await legend(page2)).split("\n").slice(0, 4).join(" | "));
  await shot(page2, `mode-${mode}-drought`, { clip: { x: 0, y: 0, width: 1040, height: 1000 } });
}

console.log("console errors:", JSON.stringify(errors, null, 1));
await browser.close();
