// Error state (data requests aborted), phone safety line, keyboard proof.
// usage: node states.mjs <baseUrl> <outDir>
import { chromium } from "/home/uzi/.local/share/mise/installs/npm-playwright/latest/node_modules/playwright/index.mjs";
const [base, outDir] = process.argv.slice(2);
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });

// 1. error: every data file fails
{
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  await page.route(/raw\.githubusercontent\.com|\/data\//, (r) => r.abort());
  await page.goto(`${base}/`);
  await page.waitForSelector("text=Could not load the data", { timeout: 60000 });
  await settle(1500);
  await page.screenshot({ path: `${outDir}/after-07-error-state.png` });
  console.log("error pill:", await page.locator("header").innerText());
  await ctx.close();
}
// 2. phone: safety line at the end of the tab
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${base}/?view=panels`);
  await page.waitForSelector("text=places on watch ·", { timeout: 120000, state: "attached" });
  await settle(3000);
  const pane = page.locator(".tab-pane");
  await pane.evaluate((e) => e.scrollTo(0, e.scrollHeight)); await settle(400);
  await page.screenshot({ path: `${outDir}/after-08-phone-safety.png` });
  console.log("phone safety visible:", await page.getByText("Informational tool, not an official warning service").first().isVisible());
  await ctx.close();
}
await browser.close();
