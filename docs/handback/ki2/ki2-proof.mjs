// KI-2 proof: low-risk places are a visible off-white dot at the world zoom and a ring zoomed in;
// the legend names the mark and swaps it with the zoom.
// usage: node ki2-proof.mjs <baseUrl> <outDir>
// Serve dashboard/out (python3 -m http.server) with the live data-branch files copied over out/data/.
import { chromium } from "/home/uzi/.local/share/mise/installs/npm-playwright/latest/node_modules/playwright/index.mjs";
import fs from "node:fs";
import zlib from "node:zlib";

const [base, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures.push(msg); };

// ---- tiny PNG reader (8-bit RGB/RGBA, non-interlaced) so the proof can sample pixels ----
function decodePng(buf) {
  let pos = 8, w = 0, h = 0, bpp = 0; const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString("ascii", pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bpp = data[9] === 6 ? 4 : 3; }
    else if (type === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, px = Buffer.alloc(h * stride);
  for (let y = 0, i = 0; y < h; y++) {
    const f = raw[i++], row = y * stride, prev = row - stride;
    for (let x = 0; x < stride; x++, i++) {
      const a = x >= bpp ? px[row + x - bpp] : 0, b = y > 0 ? px[prev + x] : 0, c = x >= bpp && y > 0 ? px[prev + x - bpp] : 0;
      let v = raw[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[row + x] = v & 255;
    }
  }
  return { w, h, bpp, px };
}
const lum = (img, x, y) => { const o = (Math.round(y) * img.w + Math.round(x)) * img.bpp; return 0.2126 * img.px[o] + 0.7152 * img.px[o + 1] + 0.0722 * img.px[o + 2]; };
/** max luminance over a disc / annulus of radii [r0, r1] around (x, y). */
function maxLum(img, x, y, r0, r1) {
  let m = 0;
  for (let dx = -r1; dx <= r1; dx += 0.5) for (let dy = -r1; dy <= r1; dy += 0.5) {
    const d = Math.hypot(dx, dy); if (d < r0 || d > r1) continue;
    m = Math.max(m, lum(img, x + dx, y + dy));
  }
  return m;
}
function minLum(img, x, y, r) {
  let m = 255;
  for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) m = Math.min(m, lum(img, x + dx, y + dy));
  return m;
}

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
let page = await ctx.newPage();
const errors = [];
const watch = (pg) => {
  pg.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  pg.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
};
watch(page);

const tipText = () => page.evaluate(() => {
  const t = document.querySelector("[role=tooltip]");
  return t && t.style.display === "block" ? Array.from(t.children).map((c) => c.textContent).join(" | ") : null;
});
const legendBox = () => page.locator("text=active fire detections (FIRMS)").first().locator("xpath=ancestor::div[contains(@class,'rounded-xl')]");
const lowMark = () => page.evaluate(() => document.querySelector("[data-low-mark]")?.getAttribute("data-low-mark") ?? null);
const canvasCentre = () => page.evaluate(() => {
  const r = document.querySelector(".maplibregl-canvas").getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
const shot = async (name, clip) => { await page.screenshot({ path: `${outDir}/${name}.png`, clip }); console.log("shot", name); };
// clip by box rather than locator.screenshot: the latter waits for a "stable" page, and the globe never is under swiftshader
const shotLegend = async (name) => { const b = await legendBox().boundingBox(); await shot(name, { x: b.x - 2, y: b.y - 2, width: b.width + 4, height: b.height + 4 }); };
const grab = async () => decodePng(await page.screenshot({ fullPage: false }));
// a fresh page per scenario: a third navigation in one page stalled under swiftshader (WebGL contexts pile up)
const open = async (q) => {
  await page.close();
  page = await ctx.newPage();
  watch(page);
  await page.goto(`${base}/?${q}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=places on watch ·", { timeout: 120000 });
  await settle(8000);
};

/** Spiral out from (cx, cy) until a place tooltip ends in "· low"; returns its position. */
async function findLowPlace(cx, cy, maxR, step = 3) {
  const pts = [];
  for (let dx = -maxR; dx <= maxR; dx += step) for (let dy = -maxR; dy <= maxR; dy += step) pts.push([dx, dy]);
  pts.sort((a, b) => a[0] * a[0] + a[1] * a[1] - b[0] * b[0] - b[1] * b[1]);
  for (const [dx, dy] of pts) {
    await page.mouse.move(cx + dx, cy + dy);
    const t = await tipText();
    const m = t && /^[^|]+\| (\d+)% · low$/.exec(t);
    if (m && Number(m[1]) < 15) return { x: cx + dx, y: cy + dy, text: t };
  }
  throw new Error(`no low place found around ${cx},${cy} r=${maxR}`);
}

// ---- 1. world zoom, next 14 days: legend names the mark as a dot, a low place is visible --------
await open("mode=next14&hazard=wildfire");
await shot("ki2-globe-global", { x: 0, y: 0, width: 1040, height: 1000 });
const legendText = (await legendBox().innerText()).replace(/\n/g, " | ");
console.log("legend:", legendText);
check(/low · under 15 %/.test(legendText), "legend has 'low · under 15 %'");
check((await lowMark()) === "dot", `legend low mark at the world zoom is a dot (got ${await lowMark()})`);
await shotLegend("ki2-legend-global");

const c = await canvasCentre();
const lowAtWorld = await findLowPlace(c.x, c.y, 260, 3);
console.log("world hover:", lowAtWorld.text, "@", lowAtWorld.x, lowAtWorld.y);
await page.mouse.move(5, 5); await settle(300);
let img = await grab();
const dotLum = maxLum(img, lowAtWorld.x, lowAtWorld.y, 0, 3);
check(dotLum >= 140, `low place at the world zoom is a visible mark (max luminance ${dotLum.toFixed(0)} within 3 px, need ≥ 140)`);
await page.mouse.move(lowAtWorld.x, lowAtWorld.y); await settle(200);
await shot("ki2-hover-global", { x: Math.max(0, lowAtWorld.x - 220), y: Math.max(0, lowAtWorld.y - 140), width: 560, height: 280 });

// ---- 2. category today: the legend's low swatch is the same mark ----------------------------------
await open("mode=now&hazard=wildfire");
const legendNow = (await legendBox().innerText()).replace(/\n/g, " | ");
console.log("legend (category today):", legendNow);
check((await lowMark()) === "dot", "category legend's low swatch is the low mark");
await shotLegend("ki2-legend-category");

// ---- 3. fly-to a low place (São Tomé, p = 2 %, an island so the ring sits on dark ocean): the mark is a hollow ring, the legend says ring ------------------------
await open("mode=next14&hazard=wildfire&place=sao-tome-st");
await settle(4000);
check((await lowMark()) === "ring", `legend low mark after the fly-to is a ring (got ${await lowMark()})`);
await shotLegend("ki2-legend-zoomed");
const z = await canvasCentre();
await page.mouse.move(5, 5); await settle(300);
img = await grab();
const centre = minLum(img, z.x, z.y, 1), ring = maxLum(img, z.x, z.y, 2.5, 4.5);
check(centre < 90, `ring is hollow: centre luminance ${centre.toFixed(0)} (need < 90)`);
check(ring >= 140, `ring is visible: max luminance ${ring.toFixed(0)} at 2.5–4.5 px (need ≥ 140)`);
await page.mouse.move(z.x, z.y); await settle(300);
console.log("zoomed hover:", await tipText());
await shot("ki2-hover-zoomed", { x: z.x - 220, y: z.y - 140, width: 560, height: 280 });
await shot("ki2-globe-zoomed", { x: 0, y: 0, width: 1040, height: 1000 });

// ---- 4. the dense Pakistan tier at its region zoom (4.5, the ring end of the crossfade) -----------
await open("mode=next14&hazard=wildfire&region=pk");
await settle(4000);
await shot("ki2-globe-pakistan", { x: 0, y: 0, width: 1040, height: 1000 });

console.log("console errors:", errors.length, errors.slice(0, 3));
check(errors.length === 0, "no console errors");
await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
