// M-PAKISTAN proof: open the dashboard with ?region=pk and screenshot it.
//   node docs/handback/m-pakistan/pk-proof.mjs http://127.0.0.1:8123 docs/handback/m-pakistan
import { chromium } from "/home/uzi/.local/share/mise/installs/npm-playwright/latest/node_modules/playwright/index.mjs";

const [base, outDir] = process.argv.slice(2);
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto(`${base}/?region=pk`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("text=places on watch ·", { timeout: 120000 });
console.log("subtitle:", await page.locator("text=places on watch").first().innerText());
await settle(12000); // fly-to (speed 0.9) + tiles
await page.screenshot({ path: `${outDir}/region-pk.png` });
// the globe's own view state, read through the MapLibre canvas container
const view = await page.evaluate(() => {
  const el = document.querySelector(".maplibregl-map");
  return el ? el.getBoundingClientRect().width : null;
});
console.log("map width:", view, "errors:", errors.length ? errors : "none");
await browser.close();
