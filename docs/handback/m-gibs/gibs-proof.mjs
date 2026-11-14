// M-GIBS proof: toggle each GIBS layer, scrub the slider, show the 404 step-back.
// usage: node gibs-proof.mjs <baseUrl> <outDir>
import { chromium } from "/home/uzi/.local/share/mise/installs/npm-playwright/latest/node_modules/playwright/index.mjs";
import fs from "node:fs";

const [base, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
const gibs = { tiles200: 0, tiles404: 0, probes: [] };
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("response", (r) => {
  const u = r.url();
  if (!u.includes("gibs.earthdata.nasa.gov/wmts")) return;
  if (r.request().method() === "HEAD") gibs.probes.push(`${r.status()} ${u.replace(/.*best\//, "")}`);
  else if (r.status() === 200) gibs.tiles200++;
  else if (r.status() === 404) gibs.tiles404++;
});
const shot = async (name, opts = {}) => { await page.screenshot({ path: `${outDir}/${name}.png`, ...opts }); console.log("shot", name); };
const control = () => page.locator("[aria-label='NASA GIBS imagery layer']").locator("xpath=ancestor::div[contains(@class,'rounded-2xl')]").first();
const caption = async () => (await control().innerText()).replace(/\n/g, " | ");
const legend = async () => (await page.locator("text=observation · NASA GIBS").first().locator("xpath=ancestor::div[contains(@class,'rounded-xl')]").innerText()).replace(/\n/g, " | ");
const globeClip = { clip: { x: 0, y: 0, width: 1040, height: 1000 } };

await page.goto(`${base}/?mode=next14&hazard=wildfire`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("text=places on watch ·", { timeout: 120000 });
await settle(6000);
console.log("control (off):", await caption());
await shot("gibs-off", globeClip);

// ---- rain / IMERG on, via the chip
await page.getByRole("button", { name: /^rain$/i }).click();
await page.waitForSelector("text=/valid \\d{4}-\\d{2}-\\d{2}/", { timeout: 30000 });
await settle(9000); // tiles
console.log("control (rain):", await caption());
console.log("legend (rain):", await legend());
await shot("gibs-imerg-on");
await shot("gibs-imerg-on-globe", globeClip);
await control().screenshot({ path: `${outDir}/gibs-imerg-control.png` });
await page.locator("text=observation · NASA GIBS").first().locator("xpath=ancestor::div[contains(@class,'rounded-xl')]").screenshot({ path: `${outDir}/gibs-imerg-legend.png` });

// ---- scrub the slider back 12 days with the keyboard
const slider = page.getByRole("slider");
await slider.focus();
for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowLeft");
await settle(400);
await page.waitForFunction(() => !document.body.innerText.includes("checking NASA GIBS"), null, { timeout: 30000 });
await settle(8000);
console.log("control (rain −12 d):", await caption());
console.log("url after scrub:", page.url());
await shot("gibs-imerg-minus12", globeClip);

// ---- NDVI and LST
for (const [name, re] of [["ndvi", /^vegetation$/i], ["lst", /^surface temp$/i]]) {
  await page.getByRole("button", { name: re }).click();
  await settle(400);
  await page.waitForFunction(() => !document.body.innerText.includes("checking NASA GIBS"), null, { timeout: 30000 });
  await settle(9000);
  console.log(`control (${name}):`, await caption());
  console.log(`legend (${name}):`, await legend());
  await shot(`gibs-${name}-on`, globeClip);
}

// ---- off again by clicking the active chip
await page.getByRole("button", { name: /^surface temp$/i }).click();
await settle(1500);
console.log("control (off again):", await caption());
console.log("gibs layer present after off:", await page.evaluate(() => !!document.querySelector(".maplibregl-canvas")) , "(canvas)");

// ---- 404 fallback by URL: today for rain (IMERG usually lags a day)
const today = new Date().toISOString().slice(0, 10);
await page.goto(`${base}/?mode=next14&hazard=wildfire&gibs=rain&date=${today}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("text=places on watch ·", { timeout: 120000 });
await page.waitForFunction(() => !document.body.innerText.includes("checking NASA GIBS"), null, { timeout: 30000 });
await settle(6000);
console.log(`control (rain, ?date=${today}):`, await caption());
await control().screenshot({ path: `${outDir}/gibs-404-stepback.png` });

console.log("GIBS tile responses:", gibs.tiles200, "× 200,", gibs.tiles404, "× 404");
console.log("probes (HEAD):"); for (const p of gibs.probes) console.log("  ", p);
console.log("console errors:", errors.length); for (const e of errors.slice(0, 10)) console.log("  ", e.slice(0, 200));
await browser.close();
