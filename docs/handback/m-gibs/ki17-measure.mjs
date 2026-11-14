import { chromium } from "/home/uzi/.local/share/mise/installs/npm-playwright/latest/node_modules/playwright/index.mjs";
const [base, outDir] = process.argv.slice(2);
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
for (const w of [1600, 1440, 1360, 1280, 1200, 1100, 1024]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${base}/?mode=next14&hazard=wildfire&gibs=rain`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=places on watch ·", { timeout: 120000 });
  await page.waitForFunction(() => !document.body.innerText.includes("checking NASA GIBS"), null, { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2500));
  const r = await page.evaluate(() => {
    const globe = document.querySelector("section").getBoundingClientRect();
    const leg = [...document.querySelectorAll("div")].find((d) => d.className.includes("bottom-3 left-3"))?.getBoundingClientRect();
    const panel = document.querySelector("[aria-label='NASA GIBS imagery layer']").closest(".rounded-2xl").getBoundingClientRect();
    const attr = document.querySelector(".maplibregl-ctrl-attrib")?.getBoundingClientRect();
    return { globeW: Math.round(globe.width), legendR: Math.round(leg.right), panelL: Math.round(panel.left), panelR: Math.round(panel.right), attrL: attr ? Math.round(attr.left) : null };
  });
  const gap = r.panelL - r.legendR;
  console.log(`viewport ${w}: globe ${r.globeW} px · legend right ${r.legendR} · panel ${r.panelL}–${r.panelR} · attribution left ${r.attrL} · legend/panel gap ${gap} px${gap < 0 ? "  OVERLAP" : ""}`);
  await page.screenshot({ path: `${outDir}/overlap-${w}.png`, clip: { x: 0, y: 600, width: r.globeW, height: 300 } });
  await ctx.close();
}
await browser.close();
