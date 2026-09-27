import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Inventory of the administrator's area: every page checks the role itself (a layout does not guard a page's
 * data under partial rendering), every API route answers only an administrator. A new file without the
 * check fails here.
 */
const root = path.resolve(__dirname, "..", "src", "app");

function files(dir: string, name: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? files(full, name) : e.name === name ? [full] : [];
  });
}

describe("administrator area guard", () => {
  const pages = files(path.join(root, "admin"), "page.tsx");
  const routes = files(path.join(root, "api", "admin"), "route.ts");

  it("finds the pages and routes", () => {
    expect(pages.length).toBeGreaterThanOrEqual(8);
    expect(routes.length).toBeGreaterThanOrEqual(4);
  });

  it.each(pages.map((p) => [path.relative(root, p), p]))("page %s calls requireUser([\"ADMIN\"])", (_rel, file) => {
    expect(readFileSync(file, "utf8")).toContain('requireUser(["ADMIN"])');
  });

  it.each(routes.map((p) => [path.relative(root, p), p]))("route %s answers only an administrator", (_rel, file) => {
    const source = readFileSync(file, "utf8");
    const handlers = source.match(/export async function (GET|POST|PUT|PATCH|DELETE)/g) ?? [];
    const guards = source.match(/apiUser\(\["ADMIN"\]\)/g) ?? [];
    expect(handlers.length).toBeGreaterThan(0);
    expect(guards.length).toBe(handlers.length);
  });
});
