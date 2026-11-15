// KI-1 proof: hover a FIRMS fire cell at the global view and zoomed in, and shoot the legend.
// usage: node ki1-proof.mjs <baseUrl> <outDir>
// Serve dashboard/out (python3 -m http.server) with the live fires_24h.json from the data branch copied over out/data/.
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
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

const tipText = () => page.evaluate(() => {
  const t = document.querySelector("[role=tooltip]");
  return t && t.style.display === "block" ? Array.from(t.children).map((c) => c.textContent).join(" | ") : null;
});

/** Walk a square spiral of mouse positions out from (cx, cy) until the tooltip shows a fire cell. */
async function findFire(cx, cy, maxR, step = 3, label = "") {
  const pts = [];
  for (let dx = -maxR; dx <= maxR; dx += step) for (let dy = -maxR; dy <= maxR; dy += step) pts.push([dx, dy]);
  pts.sort((a, b) => a[0] * a[0] + a[1] * a[1] - b[0] * b[0] - b[1] * b[1]);
  let placeHits = 0;
  for (const [dx, dy] of pts) {
    await page.mouse.move(cx + dx, cy + dy);
    const t = await tipText();
    if (!t) continue;
    if (t.includes("active fire")) return { x: cx + dx, y: cy + dy, text: t, placeHits };
    placeHits++;
  }
  throw new Error(`no fire cell found around ${cx},${cy} r=${maxR} ${label}`);
}

const shotAround = async (name, x, y) => {
  await page.screenshot({
    path: `${outDir}/${name}.png`,
    clip: { x: Math.max(0, x - 220), y: Math.max(0, y - 140), width: 560, height: 280 },
  });
  console.log("shot", name);
};

// ---- global view ----------------------------------------------------------
await page.goto(`${base}/?mode=next14&hazard=wildfire`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("text=places on watch ·", { timeout: 120000 });
await settle(7000);
await page.screenshot({ path: `${outDir}/ki1-globe-global.png`, clip: { x: 0, y: 0, width: 1040, height: 1000 } });
console.log("shot ki1-globe-global");

const legend = page.locator("text=active fire detections (FIRMS)").first().locator("xpath=ancestor::div[contains(@class,'rounded-xl')]");
console.log("legend:", (await legend.innerText()).replace(/\n/g, " | "));
await legend.screenshot({ path: `${outDir}/ki1-legend.png` });
console.log("shot ki1-legend");

// southern Africa's burning belt sits ~220 px below the globe centre (520, 500) at zoom 1.6
const g = await findFire(525, 700, 160, 3, "global");
console.log("global hover:", g.text, `@ ${g.x},${g.y}`, `(skipped ${g.placeHits} place hovers)`);
console.log("cursor on fire cell:", await page.evaluate(() => document.querySelector(".maplibregl-canvas").style.cursor || "(default)"));
await shotAround("ki1-hover-global", g.x, g.y);

// ---- a place still wins, and hover off hides ------------------------------
await page.mouse.move(5, 5);
await settle(200);
console.log("tooltip after moving off:", await tipText());

// ---- zoomed in (fly to Lagos; bins in the Gulf of Guinea belt) ------------
await page.goto(`${base}/?mode=next14&hazard=wildfire&place=lagos-ng`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("text=places on watch ·", { timeout: 120000 });
await settle(9000);
await page.mouse.move(520, 500);
await settle(200);
console.log("hover on the selected place:", await tipText());
const z = await findFire(520, 500, 260, 3, "zoomed");
console.log("zoomed hover:", z.text, `@ ${z.x},${z.y}`, `(skipped ${z.placeHits} place hovers)`);
await shotAround("ki1-hover-zoomed", z.x, z.y);
await page.screenshot({ path: `${outDir}/ki1-globe-zoomed.png`, clip: { x: 0, y: 0, width: 1040, height: 1000 } });
console.log("shot ki1-globe-zoomed");

console.log("console errors:", errors.length); for (const e of errors.slice(0, 10)) console.log("  ", e.slice(0, 200));
await browser.close();
