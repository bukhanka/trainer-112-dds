import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { isStoredName, mirrorMaterials, pruneMaterialMirror, removeMaterialFile, saveMaterialFile, storedPath } from "./storage";

const root = mkdtempSync(path.join(tmpdir(), "materials-storage-"));
const live = path.join(root, "materials");
const backups = path.join(root, "backups");
afterAll(() => rmSync(root, { recursive: true, force: true }));

const NAME = "0f8fad5b-d9cb-469f-a165-70867728950e.pdf";

describe("where a material file may live", () => {
  it("accepts only «<uuid>.<ext>» directly in the folder", () => {
    expect(storedPath(NAME, live)).toBe(path.join(live, NAME));
    for (const bad of [
      "../../etc/passwd",
      "../0f8fad5b-d9cb-469f-a165-70867728950e.pdf",
      "sub/0f8fad5b-d9cb-469f-a165-70867728950e.pdf",
      "/etc/passwd",
      "0F8FAD5B-D9CB-469F-A165-70867728950E.pdf",
      "0f8fad5b-d9cb-469f-a165-70867728950e.pdf/../../x",
      "0f8fad5b-d9cb-469f-a165-70867728950e.pdf\u0000.txt",
      "..",
      "",
    ]) {
      expect(isStoredName(bad)).toBe(false);
      expect(() => storedPath(bad, live)).toThrow();
    }
  });

  it("writes a new file under a fresh name, never over another, and removes it", async () => {
    const a = await saveMaterialFile(new TextEncoder().encode("one"), "txt", live);
    const b = await saveMaterialFile(new TextEncoder().encode("two"), "txt", live);
    expect(a).not.toBe(b);
    expect(isStoredName(a) && isStoredName(b)).toBe(true);
    expect(readFileSync(path.join(live, a), "utf8")).toBe("one");
    await removeMaterialFile(a, live);
    await removeMaterialFile(a, live); // already gone: fine
    expect(existsSync(path.join(live, a))).toBe(false);
    await expect(saveMaterialFile(new Uint8Array([1]), "../x", live)).rejects.toThrow();
    await expect(removeMaterialFile("../../etc/passwd", live)).rejects.toThrow();
  });
});

describe("files of the materials in the backups", () => {
  it("copies new files, marks the copies of live ones as seen and prunes only long-deleted ones", async () => {
    mkdirSync(live, { recursive: true });
    const keep = await saveMaterialFile(new TextEncoder().encode("keep"), "pdf", live);
    const gone = await saveMaterialFile(new TextEncoder().encode("gone"), "pdf", live);
    const fresh = await saveMaterialFile(new TextEncoder().encode("fresh"), "pdf", live);

    expect(await mirrorMaterials([keep, gone, fresh, "not-a-stored-name"], backups, live)).toEqual({ copied: 3, seen: 0, missing: 0 });
    const mirror = path.join(backups, "materials");
    expect(readdirSync(mirror).sort()).toEqual([keep, gone, fresh].sort());

    // «gone» is deleted from the library; all copies look old, then a backup sees the live ones again.
    await removeMaterialFile(gone, live);
    const old = new Date(Date.now() - 30 * 86_400_000);
    for (const f of [keep, gone, fresh]) utimesSync(path.join(mirror, f), old, old);
    expect(await mirrorMaterials([keep, fresh, "0f8fad5b-d9cb-469f-a165-000000000000.pdf"], backups, live)).toEqual({ copied: 0, seen: 2, missing: 1 });
    expect(statSync(path.join(mirror, keep)).mtimeMs).toBeGreaterThan(old.getTime());

    const cutoff = Date.now() - 14 * 86_400_000;
    expect(await pruneMaterialMirror(new Set([keep, fresh]), backups, cutoff)).toBe(1);
    expect(readdirSync(mirror).sort()).toEqual([keep, fresh].sort());
    // A live file is never pruned, however old its copy.
    utimesSync(path.join(mirror, keep), old, old);
    expect(await pruneMaterialMirror(new Set([keep, fresh]), backups, cutoff)).toBe(0);
    // Once no row lists them, old copies go; a foreign file in the mirror folder is left alone.
    utimesSync(path.join(mirror, fresh), old, old);
    writeFileSync(path.join(mirror, "notes.txt"), "admin notes");
    utimesSync(path.join(mirror, "notes.txt"), old, old);
    expect(await pruneMaterialMirror(new Set(), backups, cutoff)).toBe(2);
    expect(readdirSync(mirror)).toEqual(["notes.txt"]);
  });
});
