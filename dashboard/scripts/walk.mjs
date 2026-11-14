// Walk PRD §8 H1–H12 against a running dashboard and screenshot each.
// usage: node walk.mjs <baseUrl> <outDir>
import { chromium } from "/home/uzi/.local/share/mise/installs/npm-playwright/latest/node_modules/playwright/index.mjs";
import fs from "node:fs";

const [base, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const shot = async (page, name, opts = {}) => {
  const p = `${outDir}/${name}.png`;
  await page.screenshot({ path: p, ...opts });
  console.log(`shot ${name}`);
};
const card = (page, re) => page.locator("aside > section").filter({ has: page.locator("h2", { hasText: re }) }).first();
const cardShot = async (page, re, name) => {
  const c = card(page, re);
  if ((await c.count()) === 0) { console.log(`NO CARD ${re}`); return; }
  await c.scrollIntoViewIfNeeded();
  await c.screenshot({ path: `${outDir}/${name}.png` });
  console.log(`shot ${name}`);
};
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("requestfailed", (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));

// ---- load + timing
const t0 = Date.now();
await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
await settle(1500);
console.log("pill while loading:", await page.locator("text=/loading \\d+ of \\d+ files|connecting/").first().innerText().catch(() => "?"));
await shot(page, "ki7-loading-pill", { clip: { x: 0, y: 0, width: 700, height: 100 } });
await page.waitForSelector("text=places on watch ·", { timeout: 120000 });
const tData = (Date.now() - t0) / 1000;
await settle(9000); // tiles
console.log(`data visible after ${tData.toFixed(1)} s`);
console.log("h2s:", await page.locator("aside h2").allInnerTexts());
console.log("subtitle:", await page.locator("text=places on watch").first().innerText().catch(() => "?"));
console.log("pill:", await page.locator("text=/live|stale|connecting/").first().innerText().catch(() => "?"));

// ---- H1 globe coloured by hazard (default next14 wildfire) ; H2 fires
await shot(page, "h1-globe-wildfire-next14");
await shot(page, "h2-fires-globe", { clip: { x: 0, y: 0, width: 1040, height: 1000 } });

// ---- H12 search → select + fly ; H1 hover
await page.keyboard.press("/");
await page.keyboard.type("lahore");
await settle(400);
await shot(page, "h12-search-typing", { clip: { x: 0, y: 0, width: 700, height: 400 } });
console.log("search options:", await page.locator("[role=option]").allInnerTexts());
await page.keyboard.press("Enter");
await settle(3500);
await shot(page, "h12-search-selected-flown");
// hover the globe centre: flyTo centres the picked place
const canvas = page.locator("canvas").first();
const box = await canvas.boundingBox();
let hovered = false;
for (const [dx, dy] of [[0, 0], [1, 1], [-1, -1], [2, 0], [0, 2], [-2, 0], [0, -2], [3, 3], [-3, -3]]) {
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
  await settle(250);
  const vis = await page.locator("div.pointer-events-none.absolute.z-10").first().isVisible().catch(() => false);
  if (vis) { hovered = true; break; }
}
console.log("hover tooltip visible:", hovered, hovered ? await page.locator("div.pointer-events-none.absolute.z-10").first().innerText() : "");
await shot(page, "h1-hover-tooltip", { clip: { x: box.x + box.width / 2 - 300, y: box.y + box.height / 2 - 200, width: 600, height: 400 } });
await page.mouse.move(5, 995);

// ---- H6 + H8 place panel (tall viewport so the aside does not clip)
await page.setViewportSize({ width: 1600, height: 2600 });
await settle(1500);
await cardShot(page, /selected place/i, "h8-place-panel");
console.log("hazard cards:", await card(page, /selected place/i).locator("h3, [data-hazard]").allInnerTexts().catch(() => []));
await page.setViewportSize({ width: 1600, height: 1000 });
await settle(800);

// ---- H7 tables: click a row flies the globe; sort header
await page.keyboard.press("Escape");
await settle(500);
const hz = card(page, /hazard/i);
await hz.locator("tbody tr").nth(2).click();
await settle(3500);
await shot(page, "h7-hazards-row-click-flies");
await hz.locator("thead button", { hasText: "place" }).first().click();
await settle(400);
await page.setViewportSize({ width: 1600, height: 2600 });
await settle(800);
await cardShot(page, /hazard/i, "h7-hazards-table-sorted-by-place");
await page.setViewportSize({ width: 1600, height: 1000 });

// ---- H4 trends table in now mode with a trend variable on the globe (H1 trend colouring)
await page.goto(`${base}/?mode=now&var=tmax_c`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("text=places on watch ·", { timeout: 120000 });
await settle(9000);
await shot(page, "h1-globe-trend-tmax-now");
await page.setViewportSize({ width: 1600, height: 2600 });
await settle(800);
await cardShot(page, /trend/i, "h4-trends-table");
const tr = card(page, /trend/i);
await tr.locator("tbody tr").nth(0).click();
await settle(3500);
await page.setViewportSize({ width: 1600, height: 1000 });
await settle(500);
await shot(page, "h7-trends-row-click-flies");

// ---- H9 feed, H10 freshness + sources (H5 model row), H3/H11 run gates
await page.setViewportSize({ width: 1600, height: 3200 });
await settle(800);
await cardShot(page, /feed|alert/i, "h9-feed");
await cardShot(page, /fresh/i, "h10-freshness");
await cardShot(page, /source/i, "h10-sources-h5-model");
await cardShot(page, /hazard/i, "h6-hazards-table-drought");
console.log("feed rows:", await card(page, /feed|alert/i).locator("button, li").count());
await page.setViewportSize({ width: 1600, height: 1000 });

// ---- hazard switch: drought, heat, rain on the globe (H6)
for (const h of ["drought", "heat", "rain"]) {
  await page.goto(`${base}/?hazard=${h}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=places on watch ·", { timeout: 120000 });
  await settle(8000);
  await shot(page, `h6-globe-${h}`, { clip: { x: 0, y: 0, width: 1040, height: 1000 } });
}

console.log("console errors:", JSON.stringify(errors, null, 1));
await browser.close();
