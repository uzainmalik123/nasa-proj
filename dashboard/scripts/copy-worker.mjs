// Copies MapLibre's web worker into public/ so Next serves it as a static
// file (prep.md §9). MapLibre 6 resolves the worker from import.meta.url,
// which bundlers rewrite, so Globe.tsx must point it at the copy:
//
//   import { setWorkerUrl } from "maplibre-gl";
//   setWorkerUrl(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/${WORKER_FILE}`);
//
// Runs on postinstall, predev and prebuild. The copy is gitignored.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const WORKER_FILE = "maplibre-gl-worker.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "maplibre-gl", "dist", WORKER_FILE);
const dst = join(root, "public", WORKER_FILE);

if (!existsSync(src)) {
  console.warn(`[copy-worker] ${src} not found (maplibre-gl not installed yet?)`);
  process.exit(0);
}
mkdirSync(dirname(dst), { recursive: true });
copyFileSync(src, dst);
console.log(`[copy-worker] public/${WORKER_FILE}`);
