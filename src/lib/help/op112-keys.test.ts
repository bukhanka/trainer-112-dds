import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OP112_KEYS } from "./op112-keys";

const source = (file: string) => readFileSync(path.join(__dirname, "../../app/op112/ui", file), "utf8");

describe("memo of the 112 place", () => {
  it("lists exactly the Alt and Shift shortcuts the workstation handles", () => {
    const card = source("CardScreen.tsx");
    const handled = new Set([...card.matchAll(/case "([A-Za-z0-9+]+)":/g)].map((m) => m[1]));
    if (/e\.ctrlKey && \/\^Digit/.test(card)) handled.add("Ctrl+Digit");
    if (/else if \(\/\^Digit/.test(card)) handled.add("Digit");
    const listed = new Set(OP112_KEYS.flatMap((k) => k.codes ?? []));
    expect([...listed].sort()).toEqual([...handled].sort());
  });

  it("has the keys of a saved card from the instruction: Alt+O, Alt+N, Alt+Y, Shift+F1, Shift+F2", () => {
    const codes = OP112_KEYS.flatMap((k) => k.codes ?? []);
    for (const c of ["KeyO", "KeyN", "KeyY", "Shift+F1", "Shift+F2"]) expect(codes).toContain(c);
    expect(OP112_KEYS.find((k) => k.codes?.includes("KeyO"))?.what).toMatch(/отработок/);
    expect(OP112_KEYS.find((k) => k.codes?.includes("KeyN"))?.what).toMatch(/Вернуть на доработку/);
  });

  it("names the keys that pick up a call", () => {
    expect(source("WaitingScreen.tsx")).toContain('e.code === "Insert"');
    expect(OP112_KEYS[0].keys).toContain("Insert");
  });
});
