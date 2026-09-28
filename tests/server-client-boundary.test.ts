import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A server component cannot call a function exported from a "use client" module: Next renders the page as
 * «Не удалось показать страницу». Components (capitalised) may cross the boundary, plain functions may not —
 * they belong in a plain module under src/lib.
 */
const isClient = (path: string) => /^\s*["']use client["']/.test(readFileSync(path, "utf8").slice(0, 200));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

function resolve(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? join("src", spec.slice(2)) : spec.startsWith(".") ? normalize(join(dirname(from), spec)) : null;
  if (!base) return null;
  for (const ext of [".tsx", ".ts", "/index.tsx", "/index.ts"]) if (existsSync(base + ext)) return base + ext;
  return null;
}

describe("server and client modules", () => {
  it("server files take only components, not functions, from client modules", () => {
    const wrong: string[] = [];
    for (const file of files("src")) {
      if (isClient(file)) continue;
      const source = readFileSync(file, "utf8");
      for (const m of source.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g)) {
        if (m[1]) continue;
        const target = resolve(file, m[3]);
        if (!target || !isClient(target)) continue;
        const names = m[2].split(",").map((n) => n.trim()).filter((n) => n && !n.startsWith("type "));
        for (const name of names.map((n) => n.split(/\s+as\s+/).pop()!.trim())) {
          if (/^[a-z]/.test(name)) wrong.push(`${file}: ${name} from ${target}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});
