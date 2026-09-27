import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AUDIT_LABELS } from "@/lib/admin/audit-query";

/**
 * Every event the code writes to the journal has a Russian name in AUDIT_LABELS. The test reads the code:
 * each audit(…), auditBy(…), auditInTx(…) and auditLog.create(…) call, the string codes of its `action`
 * (a ternary gives several), and the `auditAction: "…"` plans of the review. A new event without a name —
 * or an action built from a template, which cannot be checked — fails here.
 */
const root = path.resolve(__dirname, "..");
const CALL = /\b(auditBy|auditInTx|audit|auditLog\.create)\(/g;
/** An event code is dotted: «lesson.stop». Other strings in the expression («manual» in a comparison) are not codes. */
const CODE = /"([a-z0-9_]+(?:\.[a-z0-9_]+)+)"/g;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : sources(full);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
  });
}

/** The text of a call from its opening parenthesis to the matching closing one, strings skipped. */
function callBody(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === "\\") i++;
    } else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c) && --depth === 0) return text.slice(open, i + 1);
  }
  return text.slice(open);
}

type Found = { file: string; codes: string[]; expression: string };

function scan(): Found[] {
  const found: Found[] = [];
  for (const file of [...sources(path.join(root, "src")), ...sources(path.join(root, "prisma"))]) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(CALL)) {
      const before = text.slice(Math.max(0, m.index - 40), m.index);
      if (/function\s*\w*\s*$/.test(before)) continue; // the definitions themselves
      const body = callBody(text, m.index + m[0].length - 1);
      const action = body.match(/\baction\s*:\s*([^,\n}]+)/);
      if (!action) continue; // audit(input) passing the object through
      const expression = action[1].trim();
      found.push({ file: path.relative(root, file), expression, codes: [...expression.matchAll(CODE)].map((x) => x[1]) });
    }
    for (const m of text.matchAll(/\bauditAction\s*:\s*"([a-z0-9_]+(?:\.[a-z0-9_]+)+)"/g)) found.push({ file: path.relative(root, file), expression: m[0], codes: [m[1]] });
  }
  return found;
}

describe("audit journal: every event has a Russian name", () => {
  const found = scan();
  const codes = [...new Set(found.flatMap((f) => f.codes))].sort();

  it("reads the events from the code", () => {
    expect(codes.length).toBeGreaterThanOrEqual(55);
    expect(codes).toEqual(expect.arrayContaining(["auth.login.ok", "lesson.stop", "attempt.confirm", "dds.status", "op112.training.start", "backup.manual"]));
  });

  it("finds no action built from a template or an unknown variable", () => {
    // plan.auditAction of the review is read above from its `auditAction: "…"` literals (src/lib/review/review.ts).
    const opaque = found.filter((f) => !f.codes.length && f.expression !== "plan.auditAction");
    expect(opaque.map((f) => `${f.file}: ${f.expression}`)).toEqual([]);
  });

  it.each(codes)("%s has a name", (code) => {
    expect(AUDIT_LABELS[code], `add «${code}» to AUDIT_LABELS in src/lib/admin/audit-query.ts`).toBeTruthy();
    expect(AUDIT_LABELS[code]).not.toMatch(/^[a-z]/);
  });
});
