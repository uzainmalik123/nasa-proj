// Resolver for `npm test` (node --test on the pure TypeScript modules under src/):
// maps the tsconfig "@/": "./src/" alias and adds the .ts / .tsx extension that
// Node's ESM loader needs but the Next.js code omits. Type stripping is Node's own.
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const SRC = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src") + "/").href;
const EXT = ["", ".ts", ".tsx", "/index.ts"];

registerHooks({
  resolve(specifier, context, next) {
    let s = specifier;
    if (s.startsWith("@/")) s = SRC + s.slice(2);
    if (s.startsWith("./") || s.startsWith("../") || s.startsWith("file:")) {
      const base = s.startsWith("file:") ? s : new URL(s, context.parentURL).href;
      for (const ext of EXT) {
        const candidate = base + ext;
        if (existsSync(fileURLToPath(candidate)) && !candidate.endsWith("/")) return next(candidate, context);
      }
    }
    return next(s, context);
  },
});
